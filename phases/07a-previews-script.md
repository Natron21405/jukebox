# 07a Write the Apple preview resolver

Read: plan/07-audio.md, plan/06-song-data.md (preview and matching parts). Input: `data/work/songs.nopreview.json` (do not print it).

## Do
Write `tools/resolve-previews.mjs` (plain Node, no dependencies) that, for every song, finds an iTunes Search API match and stores its `previewUrl`:
- Throttle: at least 3.2 seconds between API calls; on HTTP 403/429 back off 60 seconds and retry up to 5 times.
- Query by `title + main artist`, `entity=song`, `limit=10`, `country=US`. Accept a result only if normalised title and artist match well (reuse `norm` from `tools/lib.mjs`; ignore "remastered", "feat." suffixes; the result artist must contain the main artist or an alias). Prefer the earliest-released matching result. `releaseDate` is only a hint and must never change the song's year.
- Verify the `previewUrl` answers 200 with an audio content type (HEAD or ranged GET, no downloading of audio).
- Resumable: write progress to `data/work/previews.json` (id to `{previewUrl, trackId}` or `{failed: true}`) after every song; skip finished ids on restart. Can be stopped with Ctrl-C and re-run.
- Print only counts and a progress line every 50 songs. Never print titles or artists.
- At the end print: matched, failed, remaining.
Test the script on 5 made-up fixture songs in a temp file using a stubbed fetch (so the unit test is offline), and run one real call against a well-known song as a technical check (print only "ok" or "fail").

## Gate
- The script exists, its offline test passes, and the real call prints ok (if iTunes is unreachable, mark blocked).
- Note in `.build/NOTES.md` that step 07b runs it and may take about 4 to 5 hours for 2,000 songs (about double for 4,000).
