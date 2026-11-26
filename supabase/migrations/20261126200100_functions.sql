-- Jukebox RPC layer. Every write the browser can make goes through one of these functions.
-- They are SECURITY DEFINER (they bypass RLS) and check a secret token themselves:
--   host_*                      need the room's host token
--   join_room/seat_ping/
--   get_my_state/submit_answer  need a seat token (join_room by name needs none: it is how a seat is obtained)
-- Game rules (scoring, matching, timelines) are NOT computed here: the host browser computes them with the pure
-- functions in app/src/logic and writes the results (host-authoritative, see README "Decisions").

-- ---------------------------------------------------------------- helpers (private schema, not callable by anon)
create or replace function private.assert_host(p_room uuid, p_token text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_token is null or not exists (
    select 1 from public.room_secrets s where s.room_id = p_room and s.host_token = p_token
  ) then
    raise exception 'not_host' using errcode = '42501';
  end if;
end $$;

create or replace function private.new_token()
returns text language sql volatile set search_path = '' as $$
  select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
$$;

-- A seat counts as connected only if the flag is set AND its heartbeat is recent. The flag is flipped to false by
-- the host when presence says the phone left; the heartbeat covers the case where the host screen is not running.
create or replace function private.seat_is_live(p_connected boolean, p_last_seen timestamptz)
returns boolean language sql stable set search_path = '' as $$
  select p_connected and p_last_seen > now() - interval '60 seconds'
$$;

create or replace function private.latest_round(p_room uuid)
returns public.rounds language sql stable security definer set search_path = '' as $$
  select r.* from public.rounds r where r.room_id = p_room order by r.game_no desc, r.round_no desc limit 1
$$;

-- ---------------------------------------------------------------- rooms
create or replace function public.create_room(p_mode text default 'timeline', p_settings jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_alpha constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ';  -- no I/O look-alikes needed beyond this; digits omitted
  v_code text;
  v_id uuid;
  v_token text := private.new_token();
  v_tries int := 0;
  i int;
begin
  -- Tidy up rooms nobody has touched for 3 days (frees codes and keeps the free-tier database small).
  delete from public.rooms where updated_at < now() - interval '3 days';

  loop
    v_code := '';
    for i in 1..4 loop
      v_code := v_code || substr(v_alpha, 1 + floor(random() * length(v_alpha))::int, 1);
    end loop;
    exit when not exists (select 1 from public.rooms where code = v_code);
    v_tries := v_tries + 1;
    if v_tries > 50 then raise exception 'no_free_code'; end if;
  end loop;

  insert into public.rooms (code, mode, settings)
  values (v_code, coalesce(p_mode, 'timeline'), coalesce(p_settings, '{}'::jsonb))
  returning id into v_id;
  insert into public.room_secrets (room_id, host_token) values (v_id, v_token);
  return jsonb_build_object('room_id', v_id, 'code', v_code, 'host_token', v_token);
end $$;

-- ---------------------------------------------------------------- phones
-- Join, resume or reclaim a seat. Returns {ok:true, kind:'new'|'resumed'|'reclaimed', ...} or {ok:false, reason}.
-- Same rules as decideJoin() in app/src/logic/names.ts (the in-memory fake uses that function directly).
create or replace function public.join_room(
  p_code text, p_name text, p_seat_token text default null,
  p_max_players int default 12, p_max_name int default 20
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_room public.rooms;
  v_player public.players;
  v_seen timestamptz;
  v_token text;
  v_name text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_key text := lower(v_name);
begin
  select * into v_room from public.rooms where code = upper(btrim(coalesce(p_code, '')));
  if not found then return jsonb_build_object('ok', false, 'reason', 'no-room'); end if;

  -- 1. This browser remembered its seat: take it straight back, whatever the connected flag says.
  if p_seat_token is not null and p_seat_token <> '' then
    select p.* into v_player
    from public.players p join public.player_secrets s on s.player_id = p.id
    where p.room_id = v_room.id and s.seat_token = p_seat_token;
    if found then
      update public.player_secrets set last_seen = now() where player_id = v_player.id;
      if not v_player.connected then
        update public.players set connected = true where id = v_player.id returning * into v_player;
      end if;
      return jsonb_build_object('ok', true, 'kind', 'resumed', 'room_id', v_room.id,
                                'player_id', v_player.id, 'seat_token', p_seat_token, 'name', v_player.name);
    end if;
  end if;

  -- 2. By name.
  if v_key = '' then return jsonb_build_object('ok', false, 'reason', 'empty'); end if;
  if char_length(v_key) > p_max_name then return jsonb_build_object('ok', false, 'reason', 'too-long'); end if;

  select p.* into v_player from public.players p
  where p.room_id = v_room.id and p.name_key = v_key
  for update;
  if found then
    select s.last_seen into v_seen from public.player_secrets s where s.player_id = v_player.id;
    if private.seat_is_live(v_player.connected, v_seen) then
      return jsonb_build_object('ok', false, 'reason', 'taken');
    end if;
    -- Not connected: take the seat back. A fresh token replaces the old one (the old browser lost its claim).
    v_token := private.new_token();
    update public.player_secrets set seat_token = v_token, last_seen = now() where player_id = v_player.id;
    update public.players set connected = true where id = v_player.id;
    return jsonb_build_object('ok', true, 'kind', 'reclaimed', 'room_id', v_room.id,
                              'player_id', v_player.id, 'seat_token', v_token, 'name', v_player.name);
  end if;

  if (select count(*) from public.players where room_id = v_room.id) >= p_max_players then
    return jsonb_build_object('ok', false, 'reason', 'full');
  end if;

  begin
    insert into public.players (room_id, name) values (v_room.id, v_name) returning * into v_player;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'reason', 'taken');  -- lost a race with the same name
  end;
  v_token := private.new_token();
  insert into public.player_secrets (player_id, seat_token) values (v_player.id, v_token);
  return jsonb_build_object('ok', true, 'kind', 'new', 'room_id', v_room.id,
                            'player_id', v_player.id, 'seat_token', v_token, 'name', v_player.name);
end $$;

-- Heartbeat / goodbye from a phone. Returns false if the token is unknown.
create or replace function public.seat_ping(p_seat_token text, p_connected boolean default true)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  update public.player_secrets set last_seen = now() where seat_token = p_seat_token returning player_id into v_id;
  if v_id is null then return false; end if;
  update public.players set connected = p_connected where id = v_id and connected is distinct from p_connected;
  return true;
end $$;

-- Everything a phone needs to rebuild itself after a refresh. Never includes the song or other players' answers.
create or replace function public.get_my_state(p_seat_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_player public.players;
  v_room public.rooms;
  v_round public.rounds;
  v_answer public.answers;
begin
  select p.* into v_player
  from public.players p join public.player_secrets s on s.player_id = p.id
  where s.seat_token = p_seat_token;
  if not found then return null; end if;
  select * into v_room from public.rooms where id = v_player.room_id;
  v_round := private.latest_round(v_room.id);
  if v_round.id is not null then
    select * into v_answer from public.answers where round_id = v_round.id and player_id = v_player.id;
  end if;
  return jsonb_build_object(
    'player', to_jsonb(v_player),
    'room', to_jsonb(v_room),
    'round', case when v_round.id is null then null else to_jsonb(v_round) end,
    'answer', case when v_answer.id is null then null else to_jsonb(v_answer) - 'id' end
  );
end $$;

-- Save or lock in this phone's answer. Answers can change until locked.
create or replace function public.submit_answer(
  p_seat_token text, p_round uuid, p_slot int default null, p_year int default null,
  p_artist text default '', p_lock boolean default false
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_player public.players;
  v_round public.rounds;
  v_locked boolean;
begin
  select p.* into v_player
  from public.players p join public.player_secrets s on s.player_id = p.id
  where s.seat_token = p_seat_token;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no-seat'); end if;

  select * into v_round from public.rounds where id = p_round and room_id = v_player.room_id;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no-round'); end if;
  if v_round.status <> 'open' then return jsonb_build_object('ok', false, 'reason', 'round-closed'); end if;

  select locked into v_locked from public.answers where round_id = p_round and player_id = v_player.id;
  if coalesce(v_locked, false) then return jsonb_build_object('ok', false, 'reason', 'already-locked'); end if;

  insert into public.answers (round_id, player_id, slot, year, artist_guess, locked, updated_at)
  values (p_round, v_player.id, p_slot, p_year, left(coalesce(p_artist, ''), 100), coalesce(p_lock, false), now())
  on conflict (round_id, player_id) do update
    set slot = excluded.slot, year = excluded.year, artist_guess = excluded.artist_guess,
        locked = excluded.locked, updated_at = now();

  if coalesce(p_lock, false) then
    insert into public.round_locks (round_id, player_id, room_id)
    values (p_round, v_player.id, v_player.room_id) on conflict do nothing;
  end if;
  return jsonb_build_object('ok', true, 'locked', coalesce(p_lock, false));
end $$;

-- ---------------------------------------------------------------- host
-- Full state for rebuilding the host screen after a refresh (includes the secret current song and all answers).
create or replace function public.host_get_state(p_room uuid, p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_room public.rooms;
  v_round public.rounds;
  v_song text;
begin
  perform private.assert_host(p_room, p_token);
  select * into v_room from public.rooms where id = p_room;
  v_round := private.latest_round(p_room);
  if v_round.id is not null then
    select song_id into v_song from public.round_secrets where round_id = v_round.id;
  end if;
  return jsonb_build_object(
    'room', to_jsonb(v_room),
    'players', coalesce((select jsonb_agg(to_jsonb(p) order by p.joined_at) from public.players p where p.room_id = p_room), '[]'::jsonb),
    'round', case when v_round.id is null then null else to_jsonb(v_round) || jsonb_build_object('song_id', v_song) end,
    'answers', case when v_round.id is null then '[]'::jsonb else coalesce(
      (select jsonb_agg(to_jsonb(a) - 'id') from public.answers a where a.round_id = v_round.id), '[]'::jsonb) end,
    'locked_player_ids', case when v_round.id is null then '[]'::jsonb else coalesce(
      (select jsonb_agg(l.player_id) from public.round_locks l where l.round_id = v_round.id), '[]'::jsonb) end,
    'played_this_game', coalesce((select jsonb_agg(distinct h.song_id) from public.play_history h
      where h.room_id = p_room and h.game_no = v_room.game_no), '[]'::jsonb),
    'played_earlier', coalesce((select jsonb_agg(distinct h.song_id) from public.play_history h
      where h.room_id is distinct from p_room or h.game_no is distinct from v_room.game_no), '[]'::jsonb),
    'blocked', coalesce((select jsonb_agg(b.song_id order by b.blocked_at) from public.blocklist b), '[]'::jsonb)
  );
end $$;

create or replace function public.host_get_answers(p_room uuid, p_token text, p_round uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_host(p_room, p_token);
  return coalesce((
    select jsonb_agg(to_jsonb(a) - 'id')
    from public.answers a join public.rounds r on r.id = a.round_id
    where a.round_id = p_round and r.room_id = p_room), '[]'::jsonb);
end $$;

create or replace function public.host_update_room(
  p_room uuid, p_token text, p_mode text default null, p_status text default null, p_settings jsonb default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_room public.rooms;
begin
  perform private.assert_host(p_room, p_token);
  update public.rooms set
    mode = coalesce(p_mode, mode),
    status = coalesce(p_status, status),
    settings = case when p_settings is null then settings else settings || p_settings end,
    updated_at = now()
  where id = p_room returning * into v_room;
  return to_jsonb(v_room);
end $$;

-- Start the next round: records the song in the secret table and in play history, in one transaction.
create or replace function public.host_start_round(
  p_room uuid, p_token text, p_song_id text, p_kind text default 'normal', p_seconds int default 40
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_room public.rooms;
  v_round public.rounds;
begin
  perform private.assert_host(p_room, p_token);
  -- Anything still open or closed-but-unrevealed is abandoned.
  update public.rounds set status = 'skipped' where room_id = p_room and status in ('open', 'closed');
  update public.rooms set round_no = round_no + 1, status = 'playing', updated_at = now()
    where id = p_room returning * into v_room;
  insert into public.rounds (room_id, game_no, round_no, kind, ends_at)
  values (p_room, v_room.game_no, v_room.round_no, coalesce(p_kind, 'normal'), now() + make_interval(secs => greatest(coalesce(p_seconds, 40), 1)))
  returning * into v_round;
  insert into public.round_secrets (round_id, song_id) values (v_round.id, p_song_id);
  insert into public.play_history (song_id, room_id, game_no) values (p_song_id, p_room, v_room.game_no);
  return to_jsonb(v_round) || jsonb_build_object('song_id', p_song_id);
end $$;

-- Close answering (timer ended / everyone locked in) or mark the round skipped (clip would not load).
create or replace function public.host_close_round(p_room uuid, p_token text, p_round uuid, p_status text default 'closed')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_round public.rounds;
begin
  perform private.assert_host(p_room, p_token);
  if p_status not in ('closed', 'skipped') then raise exception 'bad_status'; end if;
  update public.rounds set status = p_status where id = p_round and room_id = p_room and status in ('open', 'closed')
    returning * into v_round;
  update public.rooms set updated_at = now() where id = p_room;
  return case when v_round.id is null then null else to_jsonb(v_round) end;
end $$;

-- Apply per-player results from the host: [{id, score, artist_hits, timeline}] (missing keys leave a value unchanged).
create or replace function private.apply_players(p_room uuid, p_players jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_players is null then return; end if;
  update public.players p set
    score = coalesce(x.score, p.score),
    artist_hits = coalesce(x.artist_hits, p.artist_hits),
    timeline = coalesce(x.timeline, p.timeline)
  from jsonb_to_recordset(p_players) as x(id uuid, score int, artist_hits int, timeline jsonb)
  where p.id = x.id and p.room_id = p_room;
end $$;

create or replace function public.host_update_players(p_room uuid, p_token text, p_players jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_host(p_room, p_token);
  perform private.apply_players(p_room, p_players);
  update public.rooms set updated_at = now() where id = p_room;
end $$;

-- Reveal: publishes the song details (p_reveal) and writes the new scores/timelines atomically.
-- Also usable again after a host override to republish corrected results.
create or replace function public.host_reveal_round(p_room uuid, p_token text, p_round uuid, p_reveal jsonb, p_players jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_round public.rounds;
begin
  perform private.assert_host(p_room, p_token);
  update public.rounds set status = 'revealed', reveal = p_reveal
    where id = p_round and room_id = p_room and status in ('open', 'closed', 'revealed')
    returning * into v_round;
  if v_round.id is null then raise exception 'no_such_round'; end if;
  perform private.apply_players(p_room, p_players);
  update public.rooms set updated_at = now() where id = p_room;
  return to_jsonb(v_round);
end $$;

create or replace function public.host_set_override(p_room uuid, p_token text, p_round uuid, p_player uuid, p_value boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  perform private.assert_host(p_room, p_token);
  update public.answers a set artist_override = p_value
  from public.rounds r where r.id = a.round_id and r.room_id = p_room and a.round_id = p_round and a.player_id = p_player;
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;

-- Mirror Realtime presence into the connected flag. Seats missing from presence are only marked disconnected if
-- their heartbeat is older than 10 s, so a phone that has just joined is not flipped before presence catches up.
create or replace function public.host_set_connected(p_room uuid, p_token text, p_connected_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_host(p_room, p_token);
  update public.players p set connected = true
    where p.room_id = p_room and p.id = any(coalesce(p_connected_ids, '{}')) and not p.connected;
  update public.players p set connected = false
    from public.player_secrets s
    where s.player_id = p.id and p.room_id = p_room and p.connected
      and not (p.id = any(coalesce(p_connected_ids, '{}')))
      and s.last_seen < now() - interval '10 seconds';
end $$;

create or replace function public.host_block_song(p_room uuid, p_token text, p_song_id text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_host(p_room, p_token);
  insert into public.blocklist (song_id, room_id) values (p_song_id, p_room) on conflict do nothing;
end $$;

create or replace function public.host_unblock_song(p_room uuid, p_token text, p_song_id text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_host(p_room, p_token);
  delete from public.blocklist where song_id = p_song_id;
end $$;

-- "Reset played songs": forgets everything except this room's current game (so it cannot repeat mid-game).
create or replace function public.host_reset_played(p_room uuid, p_token text)
returns int language plpgsql security definer set search_path = '' as $$
declare v_game int; v_n int;
begin
  perform private.assert_host(p_room, p_token);
  select game_no into v_game from public.rooms where id = p_room;
  delete from public.play_history where room_id is distinct from p_room or game_no is distinct from v_game;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Play Again with the same players: new game number, scores and timelines cleared, back to the lobby.
create or replace function public.host_new_game(p_room uuid, p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_room public.rooms;
begin
  perform private.assert_host(p_room, p_token);
  update public.rooms set game_no = game_no + 1, round_no = 0, status = 'lobby', updated_at = now()
    where id = p_room returning * into v_room;
  update public.players set score = 0, artist_hits = 0, timeline = '[]'::jsonb where room_id = p_room;
  return to_jsonb(v_room);
end $$;

-- Remove a room (used by tests and "end for good"). Play history is forgotten too unless p_keep_history.
create or replace function public.host_delete_room(p_room uuid, p_token text, p_keep_history boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_host(p_room, p_token);
  if not p_keep_history then
    delete from public.play_history where room_id = p_room;
    delete from public.blocklist where room_id = p_room;
  end if;
  delete from public.rooms where id = p_room;
end $$;

-- ---------------------------------------------------------------- grants
-- Postgres grants EXECUTE to PUBLIC by default; take that away, then grant exactly the callable surface.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'create_room', 'join_room', 'seat_ping', 'get_my_state', 'submit_answer',
      'host_get_state', 'host_get_answers', 'host_update_room', 'host_start_round', 'host_close_round',
      'host_update_players', 'host_reveal_round', 'host_set_override', 'host_set_connected',
      'host_block_song', 'host_unblock_song', 'host_reset_played', 'host_new_game', 'host_delete_room')
  loop
    execute format('revoke all on function %s from public', r.sig);
    execute format('grant execute on function %s to anon, authenticated', r.sig);
  end loop;
end $$;
