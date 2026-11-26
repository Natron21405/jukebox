# 07c Finalize the song file

Inputs: `data/work/songs.nopreview.json`, `data/work/previews.json`. Never print song details.

## Do
1. Write `tools/finalize-songs.mjs`: join songs with previews; keep songs that have a preview; per decade (field `decade`) take non-extra songs first, then extras, until the decade target in `tools/config.mjs` (times SONG_MULTIPLIER from NOTES.md, default 1) is reached. Output `app/public/songs.json` as an array of `{id, title, artists, featuredArtists, artistAliases, year, previewUrl}`. Print per-decade counts only.
2. If any decade is more than 3% short of its target, mark blocked with: "Decade X is short by N songs" with the recovery: ask Claude to add more candidate songs for that decade, then run `node run_phases.mjs --reset 03-check`, `--reset 04`, `--reset 05`, `--reset 06`, `--reset 07` and re-run (finished chunks are skipped). (Otherwise continue.)
3. Add a unit test that songs.json has unique ids, integer years within 1950 to now, non-empty previewUrl, and that decade counts are printed.
4. Record the final counts in `.build/NOTES.md` and in the root README ("Song pool: N songs").

## Gate
- `app/public/songs.json` exists, validated, total within 3% of target. Final message counts only.
