## Audio

Nathan chose Apple's iTunes Search API as the audio source for v1. It is free, needs no developer account or key, and returns a 30-second preview URL, artwork and basic metadata for each track. Nobody needs an Apple Music subscription to hear a clip. **In v1 only the host device plays audio.** Playing the song from every phone is a later version.

**What the API does and does not give you**

- The result field `previewUrl` points to a 30-second clip, [per Apple's documentation](https://performance-partners.apple.com/resources/documentation/itunes-store-web-service-search-api/). Search is by term and country; `limit` accepts 1 to 200.
- Apple documents a rate limit of about 20 calls per minute, subject to change. Resolving 2,000 songs at one search each takes at least 100 minutes, and a doubled pool takes about twice that, so the resolver script must throttle, save progress to disk after every song, and resume where it stopped.
- The `releaseDate` the API returns [is reported by developers](https://developer.apple.com/forums/thread/71569) to be an iTunes-specific date, not the album's original release date. So never score against it. Use it only as one extra hint when confirming years (see Song data).
- Preview URLs may change over time. Store `itunesTrackId` so the resolver or the game can look the clip up again when one fails.

**Terms of use: decided.** Apple's documentation says previews may only be used to promote store content and must be streamed rather than downloaded, saved or cached. Nathan has decided this game is for personal use only and that streaming the previews is acceptable to him. The build should keep to the spirit of that: stream clips directly from Apple's URLs, never download or re-host the audio files, and do not turn the game into a public service. A link from the reveal screen to the song's Apple Music page is a nice touch but optional. This document is not legal advice.

**Where the resolver can run.** During scoping, requests from the planning sandbox to `itunes.apple.com` and `musicbrainz.org` were refused by its network proxy, so the build agent may hit the same wall. The resolver should be a standalone script that Nathan can run on his own computer, outputting the final `songs.json`. It should print only counts, not song details, so Nathan is not spoiled.

**Playback behavior on the host screen**

- Play with an HTML audio element on the host device, started from a user click to satisfy browser autoplay rules. Phones stay silent.
- Loop the 30-second clip while the round timer runs, or stop and show a replay button. Either is acceptable; looping is simpler.
- Preload the next round's clip during the reveal so rounds start without a gap.
- Provide volume, pause and skip controls on the host.
- On load failure, show an error to the host only, offer Skip, and log the song id for cleanup.
