# 09a Closest Year game flow (logic wiring, no polish)

Read: plan/03-game-modes.md (Closest Year), plan/04-guessing-artist.md, plan/02-core-loop.md (round loop).

## Do
Wire the round loop for Closest Year using the pure logic from phase 02 and the net layer: pick next unplayed unblocked song, play state, all phones submit year + typed artist, timer, host-visible "everyone answered" early finish, reveal with correct year/artist and per-player points, running scoreboard, 15 rounds (configurable), tie to sudden death among tied top players, final result. Record played song ids in play history. Host override for borderline artist guesses. Songs and years must not reach phones before reveal.

## Gate
- Integration test with 4 simulated players over the fake net: full 15-round game, scoring matches hand-computed expectations, tie path ends in a single winner, no song repeats, pre-reveal payload to phones contains no answer. Final message counts only.
