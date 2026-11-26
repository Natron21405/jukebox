-- Jukebox core schema.
-- Model: the browser only ever holds the publishable (anon) key and there is no sign-in, so row ownership cannot
-- be expressed in RLS. Instead:
--   * Public tables (rooms, players, rounds, round_locks) are readable by everyone and writable by no one directly.
--   * Everything secret or answer-bearing lives in private tables that anon cannot touch at all.
--   * All writes go through SECURITY DEFINER functions (next migration) that check a host token or a seat token.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------- public tables
create table public.rooms (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique check (code = upper(code) and char_length(code) between 3 and 8),
  mode       text not null default 'timeline' check (mode in ('timeline', 'closest_year')),
  status     text not null default 'lobby' check (status in ('lobby', 'playing', 'over')),
  game_no    int  not null default 1,   -- bumped by Play Again
  round_no   int  not null default 0,   -- last round number started in this game
  settings   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.players (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references public.rooms (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 40),
  -- case-insensitive, whitespace-collapsed key; mirrors nameKey() in app/src/logic/names.ts
  name_key    text generated always as (lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))) stored,
  connected   boolean not null default true,   -- mirrored from Realtime presence (see host_set_connected, seat_ping)
  score       int  not null default 0,
  artist_hits int  not null default 0,
  timeline    jsonb not null default '[]'::jsonb,  -- array of cards {year, songId?, starter?}
  joined_at   timestamptz not null default now(),
  unique (room_id, name_key)
);
create index players_room_idx on public.players (room_id);

create table public.rounds (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references public.rooms (id) on delete cascade,
  game_no    int  not null,
  round_no   int  not null,
  kind       text not null default 'normal' check (kind in ('normal', 'sudden_death')),
  status     text not null default 'open' check (status in ('open', 'closed', 'revealed', 'skipped')),
  started_at timestamptz not null default now(),
  ends_at    timestamptz,
  -- NULL until the host reveals the round: this is the only place song details ever appear on a public table.
  reveal     jsonb,
  unique (room_id, game_no, round_no)
);
create index rounds_room_idx on public.rounds (room_id);

-- Who has locked in (no content), so the host can show a count without exposing answers.
create table public.round_locks (
  round_id  uuid not null references public.rounds (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  room_id   uuid not null references public.rooms (id) on delete cascade,
  locked_at timestamptz not null default now(),
  primary key (round_id, player_id)
);
create index round_locks_room_idx on public.round_locks (room_id);

-- ---------------------------------------------------------------- private tables (no anon access)
create table public.room_secrets (
  room_id    uuid primary key references public.rooms (id) on delete cascade,
  host_token text not null
);

create table public.player_secrets (
  player_id  uuid primary key references public.players (id) on delete cascade,
  seat_token text not null unique,
  last_seen  timestamptz not null default now()   -- heartbeat; kept off `players` so it does not spam Realtime
);

-- The current song for a round. Phones must not see it before reveal (even an id like 1980s-014 leaks the decade).
create table public.round_secrets (
  round_id uuid primary key references public.rounds (id) on delete cascade,
  song_id  text not null
);

create table public.answers (
  id              uuid primary key default gen_random_uuid(),
  round_id        uuid not null references public.rounds (id) on delete cascade,
  player_id       uuid not null references public.players (id) on delete cascade,
  slot            int check (slot is null or slot >= 0),          -- Timeline mode: insert-before index
  year            int check (year is null or year between 1000 and 3000),  -- Closest Year mode
  artist_guess    text not null default '' check (char_length(artist_guess) <= 100),
  locked          boolean not null default false,
  artist_override boolean,                                          -- host override: true counts, false rejects, null = matcher decides
  updated_at      timestamptz not null default now(),
  unique (round_id, player_id)
);
create index answers_round_idx on public.answers (round_id);

-- Songs ever played, across games and rooms. Cleared by host_reset_played.
create table public.play_history (
  id        bigint generated always as identity primary key,
  song_id   text not null,
  room_id   uuid references public.rooms (id) on delete set null,
  game_no   int,
  played_at timestamptz not null default now()
);
create index play_history_song_idx on public.play_history (song_id);
create index play_history_room_idx on public.play_history (room_id, game_no);

-- Songs the host removed from future games.
create table public.blocklist (
  song_id    text primary key,
  room_id    uuid references public.rooms (id) on delete set null,
  blocked_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- privileges and RLS
revoke all on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
grant select on public.rooms, public.players, public.rounds, public.round_locks to anon, authenticated;

alter table public.rooms          enable row level security;
alter table public.players        enable row level security;
alter table public.rounds         enable row level security;
alter table public.round_locks    enable row level security;
alter table public.room_secrets   enable row level security;
alter table public.player_secrets enable row level security;
alter table public.round_secrets  enable row level security;
alter table public.answers        enable row level security;
alter table public.play_history   enable row level security;
alter table public.blocklist      enable row level security;

-- Public, read-only. There are deliberately no insert/update/delete policies: writes happen only inside the
-- SECURITY DEFINER functions, which verify the host token or seat token.
create policy rooms_read       on public.rooms       for select to anon, authenticated using (true);
create policy players_read     on public.players     for select to anon, authenticated using (true);
create policy rounds_read      on public.rounds      for select to anon, authenticated using (true);
create policy round_locks_read on public.round_locks for select to anon, authenticated using (true);

-- Private tables: an explicit deny-all so the intent is visible (SECURITY DEFINER functions bypass RLS).
create policy deny_all on public.room_secrets   for all to anon, authenticated using (false) with check (false);
create policy deny_all on public.player_secrets for all to anon, authenticated using (false) with check (false);
create policy deny_all on public.round_secrets  for all to anon, authenticated using (false) with check (false);
create policy deny_all on public.answers        for all to anon, authenticated using (false) with check (false);
create policy deny_all on public.play_history   for all to anon, authenticated using (false) with check (false);
create policy deny_all on public.blocklist      for all to anon, authenticated using (false) with check (false);

-- ---------------------------------------------------------------- realtime
-- Only the public tables are published, so Realtime never carries answers, tokens or song ids.
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['rooms', 'players', 'rounds', 'round_locks'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
