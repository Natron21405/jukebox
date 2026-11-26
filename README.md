# Party Hitster: phased build kit

This kit builds the game by running about 30 small Claude Code sessions in a row. Each session starts fresh (so it never nears your 130k context limit), does one job, marks itself done, and the driver starts the next. Progress is saved in files, so you can stop and resume any time.

## Run it
1. Install Claude Code and sign in. Install Node 18+, git, and the GitHub CLI (`gh auth login`).
2. Unzip this folder, open a terminal in it, and copy the env file: `cp .env.example .env`.
3. (Optional) create your Supabase project now and fill in `.env`. If you skip this, step 01 stops and tells you exactly what to click.
4. Start: `node run_phases.mjs`
5. If it stops with "this step needs you", do what it says, then run the same command again. It resumes where it stopped.

Other commands: `--status` (progress), `--dry-run`, `--only 04`, `--from 08a`, `--reset 09a` (redo a phase), `--render <phase>` (write that phase's prompt so you can paste it into an interactive `claude` session yourself).

Options (environment variables): `PARALLEL=3` (song checkers at once), `SONG_MULTIPLIER=2` (about 4,100 songs instead of 2,050), `MAX_ATTEMPTS=3`, `MAX_TURNS=200`, `MODEL_A` / `MODEL_B` (use different models for the two year verifiers), `CLAUDE_FLAGS`.

## What happens, in order
Preflight, repo and Supabase setup, game logic with tests, song curation (8 decade sessions), two blind year verifications in chunks of 40, reconciliation and research of disagreements, Apple preview matching (runs for hours on your machine; resumable), then Supabase layer, lobby, Closest Year, Timeline, blocklist, a 12-bot simulation, and deploy to GitHub Pages. At the end, read `.build/PLAYTEST.md`.

## Keeping the surprise
Song details are never printed by the tools or the agents. The files in `data/work/` and `app/public/songs.json` contain the answers, so don't open them. Don't read `.build/logs/` either.

## Heads up
- The agents run unattended with permission to edit files and run shell commands (`--permission-mode acceptEdits`, Bash allowed). Run it only inside this folder. Change `CLAUDE_FLAGS` for stricter settings (the run will then stop at prompts).
- The blind verifiers are blocked from reading the curator's answers by tool rules; this is best effort.
- Cost: many sessions with a lot of web research. Watch your plan limits; the driver prints per-session cost when available.
- The plan is in `PLAN.md` (split into `plan/`). Edit those files to change the game before the relevant phase runs.

---

# Jukebox: how to run things

Repo layout: `app/` (web app, Vite + TypeScript), `supabase/migrations/` (SQL), `tools/` (scripts), `phases/` (phase prompts), `data/work/` (song pipeline, git-ignored), `.build/` (build notes and state).

| Task | Command |
| --- | --- |
| Install app deps | `cd app && npm install` |
| Install tool deps (smoke tests) | `npm install` (repo root) |
| Copy Supabase URL + publishable key into `app/.env` | `node tools/sync-app-env.mjs` |
| Dev server (phones on the same Wi-Fi can use the printed network URL) | `cd app && npm run dev` (open `/jukebox/`) |
| App tests | `cd app && npm test` |
| Production build | `cd app && npm run build` (output in `app/dist`) |
| Realtime + database smoke test | `node tools/smoke-realtime.mjs` |
| Apple preview smoke test (about 70 s, counts only) | `node tools/smoke-itunes.mjs` |

Secrets live in the root `.env` (git-ignored). Only `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` go to the browser (as `VITE_*` variables in `app/.env` or GitHub Actions secrets). `SUPABASE_DB_URL` is used locally only, to apply migrations.

# Decisions

Each architecture decision and the reason for it. Add to this list as phases make more.

- **Frontend stack: Vite + TypeScript, no UI framework (yet).** Builds to plain static files, loads fast on phones, tiny toolchain. A framework can be added later if the screens need it; the game logic stays framework-free.
- **Hosting: GitHub Pages from a public repo named `jukebox`, base path `/jukebox/`.** Free Pages needs a public repo; Nathan accepts the song file being publicly readable. Deployed by a GitHub Actions workflow (`.github/workflows/deploy.yml`, finished in phase 13).
- **Backend: Supabase (Postgres + Realtime), no custom server.** Chosen by Nathan. Browser gets only the publishable key; Row Level Security is applied to every table (phase 08+).
- **Build-time config:** `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `app/.env` (git-ignored) locally, and as Actions secrets in CI.
- **Tests: Vitest** for pure game logic, because it shares Vite's config and needs no extra setup.
- **Tool scripts are plain Node ESM in `tools/`** with their own root `package.json` (`@supabase/supabase-js`, `pg`), so the web app's dependencies stay minimal.
- **Audio: Apple iTunes Search API previews, streamed from Apple's URLs, never downloaded or re-hosted** (see plan/07-audio.md). Smoke test: 20 of 20 previews returned audio.
- **Host-authoritative: the host browser runs the game, Postgres holds the state.** The host loads the static song file, computes rounds, scores and timelines with the pure functions in `app/src/logic/`, and writes the results through RPCs. Nothing about the rules is duplicated in SQL (one implementation, one set of tests). Every piece of state lives in the database (room, players with score and timeline, rounds, answers, play history, blocklist), so a host refresh calls `host_get_state` and rebuilds the screen; the game does not end. The alternative (rules in database or edge functions) would mean porting the matcher, scoring and tie-breaks to a second language. Cost: a modified host browser could cheat, which is accepted for a friends-only party game.
- **No sign-in, so security is by token, and all writes go through functions.** Creating a room returns a long random host token; joining returns a long random seat token. Both are kept in `localStorage`. Four tables (`rooms`, `players`, `rounds`, `round_locks`) are readable by anyone and have no write policy at all. The six others (`room_secrets`, `player_secrets`, `round_secrets`, `answers`, `play_history`, `blocklist`) have an explicit deny-all policy. The 19 `SECURITY DEFINER` functions (`search_path` empty, `EXECUTE` revoked from `PUBLIC`) check the right token themselves. RLS is on for all 10 tables (`node tools/apply-migrations.mjs --verify` prints the counts).
- **Phones never get the current song before reveal.** The song id sits in private `round_secrets` (even an id such as `1980s-014` leaks the decade). The public `rounds.reveal` column is null until the host reveals; answers are private, and the public `round_locks` only says who has locked in. Only the four public tables are in the Realtime publication, so no answer, token or song id travels over Realtime. The host path (`host_get_state`) is the only way to read the current song id, and the pool answer key is the static song file the host already holds.
- **Joining:** by room code and name. A browser that remembers its seat resumes it by token, whatever the connected flag says. Otherwise a name held by a *live* seat is rejected ("That name is already taken, please choose another.") and a name whose player has dropped is taken over, which rotates the seat token so the old browser loses its claim. Names are unique per room, case and spacing ignored (a generated `name_key` column plus a unique constraint, so two simultaneous joins cannot both win). The same rules are in `decideJoin` (pure, tested) and in `join_room` (SQL); the shared contract suite runs against both.
- **Presence: Realtime presence plus a heartbeat.** The host watches presence and mirrors it into `players.connected` (a seat missing from presence is flipped only if its last heartbeat is over 10 s old, so a phone that just joined is not dropped before presence catches up). Phones also ping every 20 s into `player_secrets.last_seen`, which is deliberately not a `players` column so heartbeats do not fan out through Realtime. A seat counts as live only if `connected` and the heartbeat is under 60 s old, so a phone that died silently becomes reclaimable even if no host screen is open.
- **Client layer: a `Backend` interface with two implementations.** `app/src/net/` holds the game-facing code (join, resume, phone session, host session, room watcher with a pure `applyChange` reducer). The Supabase calls sit behind `Backend` (`supabaseBackend.ts`); `fakeBackend.ts` is an in-memory version with a controllable clock. One contract suite (`contract.ts`) runs on both, so the fake cannot drift from the database. The real-project run uses throwaway rooms and deletes them; it is skipped when the `VITE_*` variables are missing.
- **Housekeeping:** `create_room` deletes rooms untouched for 3 days (cascades to players, rounds and answers). `host_reset_played` clears play history except the current room's current game. `host_delete_room` also removes that room's history and blocklist rows.
- **Supabase free tier (checked 2026-11-26 against the docs):** a Free project is **paused after 1 week without enough database activity** (a warning email goes out about a week before; opening the dashboard or a few requests a day count as activity). Paused projects keep their data and can be restored from the dashboard (the docs say up to 1 year; a 2024 changelog said 90 days); only 2 active free projects per account. Before a party after a quiet spell, open the dashboard or run `node tools/apply-migrations.mjs --verify` to wake it, and do it a day ahead in case a restore takes a few minutes. Realtime on Free: 200 concurrent connections, 100 messages/s, 20 presence events/s, 2 million messages/month. One game (about 13 connections, a few dozen changes fanned out to each) is far below all of these; it would take hundreds of games a month to reach the message cap. Sources: https://supabase.com/docs/guides/platform/free-project-pausing and https://supabase.com/docs/guides/realtime/limits.
- **Game logic is pure TypeScript in `app/src/logic/`, with all tunables in one `CONFIG` object and randomness passed in.** No network or DOM imports, so rules, scoring, tie-breaks, the artist matcher and song selection are tested in isolation and can run on host or phone alike.
- **Artist matcher: typo tolerance by name length, strict about partial names.** Edits allowed grow with length (none up to 4 letters, 1 up to 10, 2 beyond). A strict subset of a name's words ("Lil Nas" for a three-word name) never counts. The surname rule applies to multi-word names unless the name starts with "The", contains "and", or is listed in an optional `groupArtists` song field; the song data has no solo/band flag, so this keeps the schema unchanged while letting the data phase mark bands.
- **Sudden death is one shared function for both modes.** Only tied players answer, the closest year wins, and a repeat tie (or nobody answering) plays another song.
- **Preview resolver is a standalone, resumable Node script (`tools/resolve-previews.mjs`).** One iTunes search per song, at least 3.2 s apart, with a 60 s back-off on HTTP 403/429. A result is accepted only if its title and artist match (remaster/feat suffixes ignored; live, karaoke, tribute and remix versions rejected). The earliest-released match wins, and `releaseDate` is used only for ordering, never as a song's year. Each clip URL is checked with HEAD or a 2-byte ranged GET, so no audio is downloaded. Progress goes to `data/work/previews.json` after every song. Offline test: `node --test tools/resolve-previews.test.mjs`.
