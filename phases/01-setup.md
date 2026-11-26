# 01 Setup: repo, Supabase, scaffold, smoke tests

Read: plan/01-overview.md, plan/07-audio.md, plan/08-architecture.md, plan/09-findings.md, plan/11-milestones.md (step 1).

## Do
1. **Environment.** Confirm `node -v` (18+), `git`, and `gh auth status`. If `gh` is unusable, mark blocked with the exact commands Nathan should run (`gh auth login`).
2. **Supabase.** Read `.env` (SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_DB_URL). If any is missing: if the `supabase` CLI is installed and logged in you may create the project with it and fill `.env`; otherwise mark blocked with these steps for Nathan: create a project at supabase.com/dashboard (any name, a database password he saves), then copy the Project URL, the publishable key (Project Settings > API) and the Postgres connection string (Connect button) into `.env` using `.env.example` as the template.
3. **GitHub repo.** Create it with `gh repo create jukebox --public --source=. --remote=origin` (public is needed for free GitHub Pages; Nathan accepts a public song file) and push. If a repo already exists, reuse it.
4. **Scaffold the web app** in `app/` (static build that works on phone browsers; your choice of a small stack, for example Vite with TypeScript). Set the base path for GitHub Pages (`/jukebox/`). Add a basic CI or deploy workflow stub for Pages (the full deploy happens in phase 13). Put the publishable key and URL in `app/.env` style variables read at build time; keep `.env` out of git.
5. **Realtime smoke test.** Write `tools/smoke-realtime.mjs`: two Node clients join one Supabase Realtime channel and exchange a message each way. Run it. Also confirm you can apply a SQL migration with `SUPABASE_DB_URL` (use `psql` or a Node `pg` script; run a harmless `select 1`).
6. **Apple preview smoke test.** Write `tools/smoke-itunes.mjs` that searches the iTunes Search API for 20 well-known songs from different decades (hard-code them; this is a technical test), waits 3.2 seconds between calls (Apple allows about 20 per minute), and checks each returned `previewUrl` answers HTTP 200 with an audio content type. Print only counts. If iTunes is unreachable from this machine, mark blocked.
7. **README.** Create the root `README.md` with a "Decisions" section (stack, hosting, host-authoritative or not is decided later in 08a) and how to run things.
8. Note in `.build/NOTES.md`: repo URL, app layout, how to run the dev server and tests, and the smoke test results (counts).

## Gate (all must hold)
- GitHub repo exists and is pushed. Supabase vars present. Realtime message exchange works. A migration can be applied. At least 18 of 20 iTunes previews returned audio.
- Nothing secret is committed.
