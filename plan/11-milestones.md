## Milestones and acceptance criteria

Build in this order. Each step has a gate; do not start the next until the gate passes. The first step exists because several things above are unverified.

1. **Confirm access.** From a machine that can reach Apple, resolve 20 sample songs from different decades and confirm the clips play in a browser audio element. Create the GitHub repository and the Supabase project (neither exists yet; Nathan signs in or grants access where needed, and no passwords are shared in chat), then confirm Realtime works between two devices. *Gate:* clips play, and two phones exchange live messages through Supabase.
2. **Song pipeline.** An agent curates the list to the decade counts in Song data. Two independent verification agents confirm every original year, disagreements are researched and resolved, and a throttled, resumable script resolves previews into `songs.json`. *Gate:* every included song has a playable preview, a matching title and artist, and a year confirmed as the real original year. Decade counts are met. Nathan has seen counts only, with no song-level details.
3. **Game logic with tests.** Timeline placement rules, starting-card generation (two different years from 1970 to 2015), Closest Year scoring, win and tie logic including artist hits and sudden death in both modes, the artist matcher, song selection with no repeats, and the blocklist filter, all as plain functions. *Gate:* every case in the matcher test table passes (including featured versus main artists and two main artists), plus tests for equal-year placement and every tie-break path.
4. **Supabase schema and lobby.** Tables with Row Level Security, room creation, join by code and QR, duplicate-name rejection, and rejoin. *Gate:* 12 scripted players join; a duplicate name is rejected with a clear message; a player who refreshes, closes and reopens the page, or returns from a different browser by typing the room code and old name, lands back in the same seat with their state; a host refresh mid-round resumes the game.
5. **Closest Year mode end to end,** with the year picker, artist field, reveal, scoreboard and sudden death. *Gate:* a full 15-round game with 10 scripted players finishes with correct scores and no stuck screen, and a forced tie resolves through sudden death.
6. **Timeline mode end to end,** with the personal timeline UI, placement, card award, artist hits and win detection. *Gate:* a full game with 10 scripted players ends with a correct winner, including a forced tie that goes through artist hits and then sudden death.
7. **Blocklist and play history.** Remove-from-future-games on the reveal screen, a restore screen, played-song memory and a reset button. *Gate:* a blocked song never appears again, and a song played in one game does not appear in the next until reset.
8. **Deploy and real-device playtest.** Publish the static site on GitHub Pages and test on Nathan's actual phones, on Wi-Fi and on cellular, with a TV or laptop playing audio. Check the year picker one-handed, timeline legibility from across a room, audio start and lag with 10 phones. *Gate:* Nathan signs off or lists fixes.

**Working agreements for the build agent**

- Ask Nathan the open questions in one batch before building anything that depends on them. For anything left unanswered, use the stated default and note it in the README.
- Do not make the architecture decisions silently. Record each decision and its reason in the README.
- Keep game rules, scoring and the matcher in a module with no network or UI code, so they can be tested and reused.
- Keep every tunable number (timer, points, targets, thresholds, starting-card range) in one config object.
- Never show Nathan song titles, artists or years outside the running game. Pipeline reports, logs and scripts show counts only.
- Leave out everything marked as a later version, but do not design it out.
- Prefer simple and small. This is a party game for one friend group, not a product.
