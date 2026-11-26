## Game modes

The host picks one mode per game. Numbers below are the decided defaults unless marked as proposed; all should be easy to change in one config object.

### Mode 1: Timeline (simultaneous)

This is Hitster with every player playing every song.

- **Starting cards.** Each player starts with two cards, each showing only a year. Years are random between 1970 and 2015, and the two cards are different. Where possible, no two players get the same pair. These are placeholders that show just a year, with no title or artist, so no real song from the pool is used up as a starting card.
- Each round, every player sees the same song and places it somewhere in their own timeline: before the first card, between two cards, or after the last.
- A placement is correct if the song's year is greater than or equal to the card before it and less than or equal to the card after it. Equal years are always acceptable on either side.
- Correct placement adds the song as a card in that player's timeline, showing title, artist and year. Wrong placement means only that this round's card is not added. The player loses nothing else.
- A correct artist guess is counted as an **artist hit**, whether or not the placement was right. Artist hits are used only as a tiebreaker; there are no tokens to spend.
- **Winning.** The first player to reach 12 cards wins. This counts the two starting cards, so a player needs 10 correct placements. The target of 12 is the default and can be changed.
- **Ties.** If several players reach the target in the same round, the one with the most artist hits over the game wins. If they are still tied, the tied players play sudden death: further songs are played, only the tied players answer, and the closest year guess wins the round. Repeat until one winner remains. (The sudden-death form is a proposal; see Open questions.)
- A phone must show the player's own timeline clearly, with large tap targets for each insertion slot, because this is the main interaction of the game.

### Mode 2: Closest Year

No timelines. Everyone guesses the year of every song and scores by distance.

- Fixed number of rounds (default 15).
- Points for the year guess, by how far off the player was:

| Distance from true year | Points |
| --- | --- |
| Exact | 5 |
| 1 year | 3 |
| 2 to 3 years | 2 |
| 4 to 5 years | 1 |
| 6 or more | 0 |

- Correct artist adds 2 points. Only main artists count, never featured artists.
- **Ties.** If players are tied at the top after the last round, sudden-death rounds are played between just those tied players until one winner is decided. In each sudden-death round the player whose year guess is closest wins; if they are still tied on distance, play another round with a new song.
- Possible later additions, not v1: a speed bonus, streak multipliers, a one-time double-points round per player.

### Host settings (apply to both modes)

| Setting | Default | Notes |
| --- | --- | --- |
| Mode | Timeline | Timeline or Closest Year |
| Round timer | 40 seconds | Round ends early when all have locked in |
| Target | 12 cards (Timeline) or 15 rounds (Closest Year) | Changeable |
| Year range | 1950 to current year | Filters the song pool |
| Artist guess | On | Can be turned off |
| No repeats | On | A song never plays twice in one game, and songs already played in earlier games are skipped too, with a reset option (see Song data) |

There is no difficulty setting and no title-guess setting in this build.
