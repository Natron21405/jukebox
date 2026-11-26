# 04 Verify original years (blind verifier {{ROLE}}), chunk {{CHUNK_NAME}}

You are verifier {{ROLE}}, one of two independent verifiers. You must work **blind**: read only `{{CHUNK}}` (title and artists, no years). Do not read `data/work/candidates/`, `data/work/verifyA/` or `data/work/verifyB/` (other than your own output file), or any plan file about song data. Do not try to find the curator's year.

## Task
For every song in the chunk, determine the **real original release year**: the year the recording was first released to the public, as a single or on an album, whichever came first. Not a remaster, compilation, reissue, streaming-release or chart year. A song released in December that charts in January keeps its December year. For a cover version, use the cover's own first release year.

Method:
- Answer from knowledge where you are certain. For anything you are less than certain about, or where reissues, covers, soundtrack or single/album differences could change the year, check with WebSearch or WebFetch (artist or label discographies, the single or album's page, music databases showing the earliest release). Prefer evidence for the first public release.
- Keep context small: batch your lookups sensibly and do not dump page text.

Output: `data/work/verify{{ROLE}}/{{CHUNK_NAME}}.json`, a JSON array with one object per song id in the chunk: `{ "id", "year" (integer), "confidence": "high" | "medium" | "low", "evidence": "a few words naming the source" }`.
- Save progress as you go: after every 8 or so songs, rewrite the file with all answers so far. On start, read your output file if it exists and skip finished ids (this makes restarts cheap).

## Gate
- Every id in the chunk has an entry with an integer year. Then mark the phase done. Final message: counts only (songs answered, how many high/medium/low).
