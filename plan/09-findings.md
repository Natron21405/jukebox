## Findings from scoping

No game code has been written. The planning pass only tested what data and services were reachable. Treat the "not checked" rows as the first things the build agent should confirm.

| Finding | Status |
| --- | --- |
| Apple's Search API returns a 30-second `previewUrl` for tracks, with a rate limit of about 20 calls per minute | Read from [Apple's documentation](https://performance-partners.apple.com/resources/documentation/itunes-store-web-service-search-api/) |
| Apple's preview terms limit previews to promoting store content, streamed only, not downloaded or cached | Read from the same documentation; Nathan decided streaming for personal use is acceptable, see Audio |
| The API's `releaseDate` may not be the original release year | Reported in [an Apple developer forum thread](https://developer.apple.com/forums/thread/71569) with no official reply; treat as a real risk |
| `data-out/hot-100-current.csv` in `utdata/rwd-billboard-data` downloads from `raw.githubusercontent.com` and has the columns chart_week, title, performer, peak_pos, wks_on_chart | Tested; first rows were dated 2022-01-01 |
| How far back that file (or the repo) goes, and whether it covers 1958 onward | Not checked; clone was interrupted before inspection. Less important now that the song list is agent-curated |
| Network access to `itunes.apple.com` and `musicbrainz.org` from the planning sandbox | Refused by the sandbox proxy (HTTP 403); the build agent's environment may differ |
| Whether the preview URLs play in a browser audio element, and whether they expire | Not checked |
| Whether the iTunes lookup endpoint accepts several track ids in one call, which would speed up re-resolving | Not checked |
| Supabase Realtime free-tier limits and per-channel message visibility | Not checked |

**Why not Spotify.** The group uses Apple Music, and Spotify stopped serving preview URLs to new apps in its Web API in late 2024, according to [Spotify developer forum posts](https://community.spotify.com/t5/Spotify-for-Developers/Kind-request-regarding-the-Spotify-Web-API-preview-url/td-p/6909407). The official Hitster app also connects to Spotify, so it is not an option for this group.

**Existing alternatives not chosen.** Third-party Apple Music apps such as Beatster and Hitstalt scan the physical Hitster cards and play the song through Apple Music. They keep the one-guesser-per-turn rules, so they do not fix the problem this project is for.
