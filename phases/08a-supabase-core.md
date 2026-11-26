# 08a Supabase schema, security and client layer

Read: plan/08-architecture.md, plan/02-core-loop.md (rejoin and rooms), plan/06-song-data.md (play history, blocklist), plan/04-guessing-artist.md (host override).

## Do
1. **Decide and record** (README "Decisions") whether game logic runs host-authoritative (the host browser computes rounds and writes results) or in database functions/edge functions. Constraint: a host refresh must not end the game, so all state lives in Postgres and the host screen can rebuild from it. Players may be able to read the pool answer key only through the host path; phones must never receive the current song's year or artist before reveal.
2. Migrations in `supabase/migrations/`: rooms (code, mode, status, settings, host token), players (name unique per room case-insensitively, seat token, connected flag via presence, score, timeline), rounds, answers, play history (song ids ever played, across games, with reset), blocklist (song ids). Enable Row Level Security on every table with simple, explicit policies (phones can insert their own answer and read what they need; host-only operations require the host token). Apply them with `SUPABASE_DB_URL`.
3. Client layer in `app/src/net/`: create room, join (reject a name used by a currently connected player with a friendly message; reclaim a seat by room code and old name when not connected; remember seat in localStorage), presence, subscribe to room state, submit answer, host actions. Pure and testable; Supabase calls behind a thin interface so tests can use an in-memory fake.
4. Tests: join, duplicate-name rejection, seat retake, host reload rebuilds state from the database (use the fake and one integration test against the real project with throwaway room codes, cleaned up afterwards).
5. Check free-tier limits and project pausing; add the finding to README.

## Gate
- Migrations applied, RLS enabled on all tables (verify with a query and print counts), tests pass, decisions recorded.
