# 03 Curate songs: {{DECADE}}

Read: plan/06-song-data.md and plan/04-guessing-artist.md (the "Which artists count" part).

## Do
Curate **{{REQUEST}} songs** originally released in **{{START}} to {{END}}**: exactly **{{TARGET}} base** songs plus the rest marked `"extra": true` (extras are spares in case some fail the Apple preview match or the year check).

Rules:
- Songs a mixed-age US friend group (about 18 to 60) would recognise or enjoy being surprised by. A broad mix: pop, rock, R&B and soul, hip-hop where the era fits, country, dance and electronic, Latin, alternative and indie, one-hit wonders. Not all deep cuts and not all megahits.
- No holiday songs. No live, karaoke, tribute or remix versions. Avoid songs whose "original year" is murky (disputed or multiple first releases) unless you are confident.
- At most 6 songs per main artist across **all decades** (the check tool counts everything already written). No duplicate songs.
- Use the year of the recording that would play (for a famous cover, the cover's own year).
- `year` is your best knowledge of the original release year (first public release as a single or on an album, whichever came first). Add a short `yearNote` saying what it is based on (for example "single, Mar {{START}}").
- Fields per song: `id` (opaque: `{{DECADE}}-001`, `{{DECADE}}-002`, ...), `title` (no remaster or version suffixes), `artists` (main artists only; a duet credited "A & B" lists both; a band name is one artist), `featuredArtists` (use `[]` if none), `artistAliases` (alternate spellings or common short forms people might type; `[]` if none), `year`, `yearNote`, `extra` (true/false).

Write the songs in parts of at most 100 to `data/work/candidates/parts/{{DECADE}}-1.json`, `{{DECADE}}-2.json`, and so on (each a JSON array), then run:
`node tools/check-candidates.mjs --merge {{DECADE}}` and `node tools/check-candidates.mjs {{DECADE}} --multiplier {{MULT}}`.
Fix every reported problem (the tool prints counts and opaque ids only) until it prints "candidates OK". If another decade's file already exists, the artist cap and duplicate checks include it.

## Gate
- The check tool prints "candidates OK" for {{DECADE}}.
- Your final message is counts only.
