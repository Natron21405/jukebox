# 10a Timeline game flow (logic wiring)

Read: plan/03-game-modes.md (Timeline), plan/04-guessing-artist.md, plan/02-core-loop.md.

## Do
Wire Timeline: each player gets two different starter year cards (1970 to 2015, distinct pairs where possible); each round everyone places the new song in their own timeline (slot choice) and optionally types the artist; reveal; correct placement adds the card, wrong adds nothing and costs nothing; artist hit counted for the tiebreak only; first to 12 cards wins; same-round finishers ties broken by artist hits then sudden death among tied players (closest year, repeat). Reuse the round loop from 09a. Play history and no-repeat as before. Phones receive only their own timeline.

## Gate
- Integration test with 5 simulated players: a full game to 12 cards, wrong placements verified, tie-break paths verified (hits, then sudden death), no repeats, no answer leakage pre-reveal. Final message counts only.
