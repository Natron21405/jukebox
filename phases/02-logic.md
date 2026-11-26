# 02 Game logic and tests (pure functions)

Read: plan/03-game-modes.md, plan/04-guessing-artist.md, plan/06-song-data.md (schema and no-repeat/blocklist parts), plan/02-core-loop.md (only the loop and rejoin names).

## Do
Create pure TypeScript (or your chosen language) modules under `app/src/logic/` with no network, DOM or Supabase imports, plus tests:
- `config`: every tunable number in one object (timer 40s, Timeline target 12 cards, Closest Year rounds 15, points table, artist bonus 2, starting cards 2 with year range 1970 to 2015, max players 12, artist cap not needed here).
- `matcher`: artist matching per plan section 4 (normalise, typo tolerance scaled by length, aliases, surname rule, main artists only, either of two main artists counts, featured never counts). Use made-up artist names in tests plus the plan's starter table (those are test strings, fine to use).
- `timeline`: starting cards (two different years, 1970 to 2015, distinct pairs across players where possible), placement validity (equal years always fine), awarding a card on correct placement only.
- `scoring`: Closest Year points table plus artist bonus.
- `endgame`: Timeline win at 12 cards including the two starters; same-round ties broken by artist hits, then sudden death (tied players only, closest year wins, repeat); Closest Year ties go straight to sudden death among tied top players.
- `selection`: choose the next song never played (this game or earlier games) and not blocked, from a given pool; report pool exhausted.
Document the interfaces in `.build/NOTES.md`.

## Gate
- `npm test` (or equivalent) passes, including: every row of the matcher table, equal-year placement, wrong placement adds nothing and costs nothing, starting-card generation constraints, every tie path in both modes, selection never repeats or returns a blocked song.
