## Guessing the artist

Artist guessing is typed free text with forgiving matching. Nathan explicitly does not want suggestions, autocomplete or multiple choice inside the game, because any list of options reminds players of the answer. If a typed field proves unworkable in testing, the fallback he approved is a multiple-choice list of 6 to 8 options, but typing is the target.

**Scope for v1:** artist only. Title guessing is not part of this build and is a possible later addition.

**Input rules**

- One text input on the phone answer screen, optional to fill in.
- No dropdown of matches while typing. Nothing about the answer is revealed until the round ends.
- Nathan does not need the browser keyboard's autocomplete, autocorrect, autocapitalize or spellcheck turned off. Leave the defaults and spend no effort on it.

**Which artists count**

- Only a song's **main artists** count. A featured artist never counts.
- If a song has **two main artists** (for example a duet credited as "A & B"), typing either one is correct.
- The song data therefore needs the main artists as a list, separate from featured artists, which are shown on the reveal only.
- A group name such as a band or duo name is one artist. Aliases in the data can cover members where it is natural (see Song data).

**Matching rules** (the build agent should choose the implementation and tune thresholds against the test cases below)

- Normalize both sides before comparing: lowercase, strip accents, remove punctuation, treat "&" and "and" as equal, drop a leading "the", collapse whitespace.
- Allow typos with an edit-distance or similarity threshold that scales with length. Very short names need a stricter rule than long ones.
- Support per-song aliases in the data, such as "Pink" for P!nk or "Guns and Roses" for Guns N' Roses.
- For solo people, accept the surname alone when it is distinctive ("Springsteen"). Do not accept a first name alone. Bands need the full name apart from "the".
- Matching can run wherever the game logic runs. On the reveal screen, show what each player typed and whether it counted. Give the host an override to mark a borderline guess correct, which keeps the matcher strict enough to be fun while avoiding arguments.

**Starter test cases** (expected results the matcher should pass; extend these):

| Player types | Song's credit | Should count? |
| --- | --- | --- |
| beatles | The Beatles | Yes |
| Beyonce | Beyoncé | Yes |
| fleetwod mac | Fleetwood Mac | Yes (typo) |
| springsteen | Bruce Springsteen | Yes (surname) |
| bruce | Bruce Springsteen | No (first name only) |
| michael | Michael Jackson | No |
| pink | P!nk | Yes (alias) |
| guns and roses | Guns N' Roses | Yes (alias) |
| daft | Daft Punk | No (partial band name) |
| Jay Z | JAY-Z | Yes |
| Lil Nas | Lil Nas X | Decide: probably No |
| mark ronson | Mark Ronson feat. Bruno Mars | Yes (main artist) |
| bruno mars | Mark Ronson feat. Bruno Mars | No (featured artist) |
| mariah carey | Mariah Carey & Boyz II Men | Yes (one of two main artists) |
| boyz ii men | Mariah Carey & Boyz II Men | Yes (the other main artist) |

**Cheating.** Nathan is not worried about players reading the game code or the answer key, so no hardening is required. The normal screens should still not show the current song's answer to phones before the reveal.
