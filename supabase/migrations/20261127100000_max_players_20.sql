-- Player limit raised from 12 to 20 (CONFIG.maxPlayers). The only server-side limit is in join_room: the default and a hard
-- ceiling of 20, so a modified client cannot ask for more. No table check or RLS policy depends on the player count.
create or replace function public.join_room(
  p_code text, p_name text, p_seat_token text default null,
  p_max_players int default 20, p_max_name int default 20
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

  if (select count(*) from public.players where room_id = v_room.id) >= least(coalesce(p_max_players, 20), 20) then
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
