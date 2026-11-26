## Year picker (Closest Year mode)

Nathan wants a year picker that is neither typed nor multiple choice. The song pool spans 1950 to now, about 75 years, and scoring depends on being off by only 1 to 5 years, so the picker needs both fast coarse movement and precise single-year adjustment on a phone.

**Proposed design** (the build agent may improve it after testing on a real phone):

- A large year readout at the top of the screen, always visible.
- A horizontal slider across the full range with decade tick labels (1950, 1960, and so on) that sets the rough position.
- Minus and plus buttons beside the readout that move one year at a time, with press-and-hold to repeat. This solves the precision problem a 75-year slider has on a small screen.
- Optional decade chips (50s, 60s, and so on) that jump the slider to the middle of that decade.
- The slider range follows the host's year range setting, so a narrower game gets a more precise slider.
- The starting position should not hint at the answer. Start at a fixed middle value, or at the last guess the player made, never anywhere derived from the song.
- Lock In confirms the year. The player can change it until then.

**Acceptance test:** a player can land on a specific year they have in mind in under 5 seconds, one-handed, without zooming.

The same range logic is used for the host screen reveal, which can draw the answer on a timeline with every player's guess as a marker. That is a nice-to-have for the reveal, not required for v1.
