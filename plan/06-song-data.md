## Song data

An agent curates the song list, and two further agents confirm every song's real original year. This is the largest piece of real work, and its quality decides whether the game feels fair: a wrong year makes a correct player lose a card.

**Size and spread.** The decided distribution is 2,050 songs. If it is easy, double it to about 4,100 and keep the same proportions.

| Decade | Songs | If doubled |
| --- | --- | --- |
| 1950s | 40 | 80 |
| 1960s | 140 | 280 |
| 1970s | 350 | 700 |
| 1980s | 400 | 800 |
| 1990s | 400 | 800 |
| 2000s | 350 | 700 |
| 2010s | 300 | 600 |
| 2020s | 70 | 140 |

Ask the curator for about 10% extra candidates per decade, because some songs will fail the preview match and the decade counts should still be met.

**Curation guidance**

- Pick songs a mixed-age friend group is likely to recognize or enjoy being surprised by, across pop, rock, R&B, hip-hop, country, dance, soul and so on. There is no difficulty setting, so the pool itself should be broadly fair.
- Limit how many songs one artist can have so the game does not feel repetitive. A cap of about 5 to 6 per artist in the base pool is a reasonable starting point.
- Exclude holiday songs, whose chart years repeat every December, unless a specific original year is clear.
- Use the year of the version that plays. Where a famous cover or remake is in the pool, give its own year.
- Reject previews whose title or artist do not closely match, and anything labelled live, karaoke, tribute or remix unless that is the intended version.
- Remove duplicates and near-duplicates (same song, several releases).
- Chart data, such as the public Billboard Hot 100 history on GitHub, may help the curator pick songs. It must not be used as the source of the year.

**Record schema** (one JSON object per song; a static `songs.json` is enough for v1):

| Field | Purpose |
| --- | --- |
| id | Stable unique id |
| title | Display title, with remaster and version suffixes stripped |
| artists | List of the main artists. Any one of them is a correct guess |
| featuredArtists | Featured artists, shown on the reveal but never accepted as a guess |
| artistAliases | Optional list of accepted alternate spellings (see Guessing the artist) |
| year | Real original release year, the value the game scores against |
| itunesTrackId | For re-resolving the preview later |
| previewUrl | The 30-second clip, resolved by the script |
| artworkUrl | Album art for the reveal screen |

There is no difficulty or tier field. Blocked songs and play history are kept separately (below), not in this file.

**Confirming the real year.** Nathan does not want to check years himself, because he does not want the songs spoiled for him. The process must therefore settle every song without him.

1. The curator proposes each song with a year and a short note on where the year came from.
2. **Two independent verification agents** each research the real original year of every song. They work separately, do not see each other's answers, and ideally do not see the curator's year either.
3. Compare the curator and both verifiers. If all agree, the year is confirmed.
4. If they disagree, do not discard the song. Research the real answer from primary or reliable evidence, such as the original single or album release record, the label, the artist's official discography and music databases, and decide. Record the evidence.
5. Only remove a song if its year is still genuinely uncertain after that research. Replace it from the extra candidates.
6. Use iTunes' dates only as one more hint. See Audio for why they are unreliable.

**What counts as the original year:** the year the recording was first released to the public, as a single or on an album, whichever came first. Not a remaster, compilation, reissue, streaming-release or chart year. A song released in December that charts in January keeps its December year.

**No spoilers for Nathan.** The audit evidence for each song goes in a private file that Nathan does not open. What Nathan sees is counts only: songs per decade, how many were resolved after a disagreement, and how many were removed. He is never asked to review individual songs.

**No repeated songs.**

- A song never plays twice in one game.
- The game also remembers songs already played in earlier games and skips them. Store play history in Supabase (song id, game, time) and give the host a Reset played songs button. If the filtered pool runs out, tell the host and offer the reset.

**Blocklist.**

- On the reveal screen, the host can tap Remove from future games. This works only after the answer is shown, so nobody is spoiled.
- Blocked song ids are stored in Supabase and skipped when songs are chosen.
- The host has a screen listing blocked songs, where a song can be restored. Showing titles there is fine, since those songs have already been revealed.
- Blocking applies in future rounds and future games, not retroactively to the current round's scoring.
