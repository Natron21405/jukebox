## Overview and goals

Build a Jackbox-style web game where about 10 people play a Hitster-like music game at the same time on their own phones, so nobody sits out waiting for a turn. A host screen (laptop or TV) plays each song clip and shows results. Players join with a room code and submit guesses from their phones. No physical cards, no streaming-service login for players.

**The problem it solves.** In standard Hitster only the active player guesses, so with 10 players about 90% of everyone's time is spent waiting. In this game every player answers every song, so participation is 100%.

**Requirements from Nathan (fixed):**

- Two game modes, both playable from the same song pool: **Timeline** (each player builds a personal timeline, everyone places the same song at once) and **Closest Year** (everyone guesses the year, scored by distance).
- A separate **artist guess** on every song, typed rather than multiple choice, because options give away the answer. Only a song's main artists count, never featured artists. If a song has two main artists, guessing either one is correct.
- A **year picker that is not typing and not multiple choice**, such as a slider with nudge buttons.
- A **curated pool of about 2,050 songs** from 1950 to now, weighted toward recent decades (exact counts under Song data). An agent curates it. If it is easy, the pool may be doubled to about 4,100.
- **Every song's year is the real, original release year**, confirmed by two independent verification agents. Nathan will not review the years himself, because he does not want the songs spoiled for him.
- **No repeated songs.**
- **Audio from the host device only** for v1, using Apple Music / iTunes 30-second previews (the group uses Apple Music, not Spotify). Playing audio from every phone is a later version.
- **Players who are not comfortable with tech must be able to rejoin easily.** If someone refreshes the page, closes the tab or loses signal, they return to their same seat without help. Two players cannot use the same name.
- A **song blocklist**, so Nathan can remove songs the group does not like.
- **Cloud hosted from the start, on Supabase.** Personal use only.

**Non-goals for v1:** teams, accounts or logins, persistent stats, full-length playback, printed cards, native mobile apps, audio from phones, title guessing, a difficulty setting, a speed bonus.

**Audience and setting:** one friend group of about 10, casual party use, phones as controllers. Players are not music experts and not all are comfortable with technology, so the game must stay fun when many people get songs wrong and must forgive mistakes like an accidental refresh.
