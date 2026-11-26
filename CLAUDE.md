# Jukebox (party music game): standing rules for every session

A Jackbox-style web game (host screen plus phones) where about 10 friends play a music-timeline guessing game simultaneously. The full plan is in `PLAN.md`; `plan/` has the same content split by section. This repo is built by an automated sequence of small phases, each in a fresh session.

## Every session
- Read `.build/NOTES.md` first. It holds decisions, file locations and commands from earlier phases.
- Read only the plan sections your phase prompt names. Do not load `PLAN.md` whole unless asked.
- Keep context small: never print or cat large files (`songs.json`, anything in `data/work/`). Use `head`, `wc`, `jq`, or scripts that print counts.
- Do only your phase's work, then mark it done or blocked with `node tools/phase.mjs` (the prompt explains).

## Spoilers (important)
Nathan must not see song titles, artists or years outside the running game, because he wants the game to stay a surprise.
- Never print song details in your final message, notes, commit messages, test output or logs. Counts and opaque ids only (ids look like `1980s-014`).
- Never open or summarise `data/work/` or `app/public/songs.json` for the user. Scripts that touch them print counts only.
- Test fixtures must use made-up songs, not real ones.

## Code and repo
- Layout: web app in `app/`, SQL in `supabase/migrations/`, song pipeline files in `data/work/` (git-ignored), tools in `tools/`, phase prompts in `phases/`.
- Game rules, scoring, tie-breaks and the artist matcher are pure functions with tests, separate from network and UI code. Every tunable number lives in one config object.
- Secrets: `.env` is git-ignored. Only the Supabase publishable (anon) key may be shipped to the browser. Never commit the database URL or any service key.
- Never download or re-host Apple preview audio. Stream clips from Apple's URLs.
- Prefer simple and small. Record each architecture decision and its reason in the root `README.md` under "Decisions".
- If you are unsure, or need a human (sign-in, a dashboard click, a decision), mark the phase blocked with exact steps. Do not guess.
