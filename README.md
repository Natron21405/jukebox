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
- **Host-authoritative or not:** decided later, in phase 08a.
- **Game logic is pure TypeScript in `app/src/logic/`, with all tunables in one `CONFIG` object and randomness passed in.** No network or DOM imports, so rules, scoring, tie-breaks, the artist matcher and song selection are tested in isolation and can run on host or phone alike.
- **Artist matcher: typo tolerance by name length, strict about partial names.** Edits allowed grow with length (none up to 4 letters, 1 up to 10, 2 beyond). A strict subset of a name's words ("Lil Nas" for a three-word name) never counts. The surname rule applies to multi-word names unless the name starts with "The", contains "and", or is listed in an optional `groupArtists` song field; the song data has no solo/band flag, so this keeps the schema unchanged while letting the data phase mark bands.
- **Sudden death is one shared function for both modes.** Only tied players answer, the closest year wins, and a repeat tie (or nobody answering) plays another song.
