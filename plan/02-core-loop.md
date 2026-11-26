## Core loop and screens

Every round follows the same loop in both modes, so the two modes share one engine and differ only in what the phone asks for and how the reveal is scored.

1. The host starts a round. The next song is chosen (never one already played) and its clip plays on the host device only, looping until the round ends.
2. Every player answers on their phone. In Timeline mode they place the song in their own timeline. In Closest Year mode they pick a year. In both modes there is an optional typed artist guess.
3. Each player taps Lock In. The round ends when everyone has locked in or the timer runs out (default 40 seconds, host-adjustable). The host can also end a round early.
4. The host screen reveals the song (title, artist, year, album art) and who was right, then shows updated scores. The reveal includes a button to remove the song from all future games (see Song data).
5. The host advances to the next round. The game ends at the target (Timeline: first to N cards; Closest Year: a fixed number of rounds), with tie-breaks as described under Game modes.

**Host screen states** (shown on a TV or laptop, which is also the only device that plays audio in v1):

- **Lobby:** room code, a QR code that opens the join page, the list of joined players, mode and settings, Start button.
- **Listening:** audio playing, countdown, a count of how many players have locked in. It must not show names of who has answered what, and must not show the song details.
- **Reveal:** song title, artist, year, album art, which players were correct, points or cards gained, and the remove-from-future-games button.
- **Scoreboard:** standings after each round. In Timeline mode, show each player's card count and artist hits.
- **Game over:** winner and final standings, with a Play Again option that keeps the same players.
- **Always visible:** a small room code and join address stay on the host screen during the whole game, so a player who lost their page can find the way back in.

**Phone screens:**

- **Join:** room code and a display name. A name already in use by someone else in the room is rejected with a plain message, such as "That name is already taken, please choose another."
- **Waiting:** between rounds, with the player's own status.
- **Answer screen:** the mode-specific input plus the artist field and a Lock In button. Answers can be changed until Lock In.
- **Result:** this player's outcome for the round and running total, shown while the host screen shows the reveal.

**Rejoining.** Some players will refresh, close the tab or lose signal by accident, and some are not comfortable with tech, so rejoining is a core requirement, not polish.

- The phone remembers its seat (for example with an id in browser storage), so a refresh or reopened page puts the player straight back in the room with their timeline, score and in-progress answer for the current round.
- If that memory is gone (a different browser, a cleared page), the player enters the room code and their old name again. Because the old seat is not currently connected, they take it back instead of being rejected as a duplicate. A name belonging to a currently connected player is still rejected.
- A returning player is told they are back in the game, and any answer they had locked in for the current round still counts.
- Test this case specifically (see Milestones).

**Other edge cases the build must handle:**

- Browsers block audio until a user interacts with the page, so the host needs an explicit Start or Enable Sound click before the first clip.
- A preview URL that fails to load: the host can skip the song without penalty, and the song is flagged for cleanup.
- Players who disconnect mid-round count as no answer for that round until they come back.
- Late joiners can join between rounds. In Timeline mode they start with two year-only cards like everyone else.
- The host screen refreshing must not end the game. Room, player and round state should be saved in Supabase so the host page can reload and continue (see Architecture).
