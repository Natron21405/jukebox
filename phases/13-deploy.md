# 13 Deploy to GitHub Pages and playtest checklist

Read: plan/11-milestones.md (final gate), plan/09-findings.md (hosting notes).

## Do
1. Finish the GitHub Actions workflow that builds `app/` and deploys to Pages with the correct base path; Supabase URL and publishable key come from repository variables or a build-time env (never the DB URL). Set them with `gh variable set`. Enable Pages via `gh api` or mark blocked with the exact settings click-path.
2. Push, wait for the workflow, and fetch the deployed URL to confirm it loads (HTTP 200 and the app title).
3. Write `.build/PLAYTEST.md`: a short checklist for Nathan's first real session on phones (join, duplicate name, refresh and rejoin, audio from the host device including that phones/laptop volume works, both modes, blocklist, reset), plus how to take the site down, how to rerun the song pipeline for more songs, and the Supabase pausing note.
4. Final README polish: how to run locally, how to update, decisions list.

## Gate
- Deployed URL answers 200. PLAYTEST.md exists. Final message: the URL and counts only.
