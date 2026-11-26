# 05 Resolve disputed years, chunk {{CHUNK_NAME}}

Read only `{{CHUNK}}`. Each item is a song where the curator and two blind verifiers disagreed about the original release year. It gives the three years, confidence levels and short evidence notes.

## Task
Find the **real original release year** for each song: the year the recording was first released to the public, as a single or on an album, whichever came first. Not a remaster, compilation, reissue, streaming-release or chart year.

Do not discard a song just because the sources conflict. Research it properly with WebSearch and WebFetch: the original single or album release record, the label, the artist's official discography, and music databases that list the earliest release. Settle conflicts such as single versus album date, regional release dates, or confusion with a cover or re-recording.

Only if you are still genuinely unsure after real research, set `year` to `null` (the song will be dropped and replaced).

Output `data/work/resolved/{{CHUNK_NAME}}.json`: a JSON array of `{ "id", "year" (integer or null), "evidence": "short source note" }`, one per song in the chunk. Save progress after every few songs and, on start, skip ids already in your output file.

## Gate
- Every id in the chunk has an entry. Then mark the phase done. Final message: counts only (resolved, set to null).
