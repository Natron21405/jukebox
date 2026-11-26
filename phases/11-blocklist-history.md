# 11 Blocklist, play history reset, and polish of no-repeat

Read: plan/06-song-data.md (no-repeat and blocklist), plan/02-core-loop.md.

## Do
- Reveal screen: "Remove from future games" button (host only) writing to the blocklist; a restore screen listing blocked songs by title and artist (the host sees these in play, which is acceptable because they were just played) with a restore button.
- Settings screen: "Reset played songs" with a confirm step, explaining it makes all songs available again.
- Pool-exhausted handling: friendly message and offer to reset.
- Verify no-repeat across games: tests for two consecutive games on one device group.

## Gate
- Tests pass for block, restore, reset, exhaustion, and cross-game no-repeat. Final message counts only.
