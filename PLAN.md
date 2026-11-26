# Party Hitster: Build Plan

2026-11-26 · @Nathan

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

## Song data

An agent curates the song list, and two further agents confirm every song's real original year. This is the largest piece of real work, and its quality decides whether the game feels fair: a wrong year makes a correct player lose a card.

**Size and spread.** The decided distribution is 2,050 songs. If it is easy, double it to about 4,100 and keep the same proportions.

| Decade | Songs | If doubled |
| --- | --- | --- |
| 1950s | 40 | 80 |
| 1960s | 140 | 280 |
| 1970s | 350 | 700 |
| 1980s | 400 | 800 |
| 1990s | 400 | 800 |
| 2000s | 350 | 700 |
| 2010s | 300 | 600 |
| 2020s | 70 | 140 |

Ask the curator for about 10% extra candidates per decade, because some songs will fail the preview match and the decade counts should still be met.

**Curation guidance**

- Pick songs a mixed-age friend group is likely to recognize or enjoy being surprised by, across pop, rock, R&B, hip-hop, country, dance, soul and so on. There is no difficulty setting, so the pool itself should be broadly fair.
- Limit how many songs one artist can have so the game does not feel repetitive. A cap of about 5 to 6 per artist in the base pool is a reasonable starting point.
- Exclude holiday songs, whose chart years repeat every December, unless a specific original year is clear.
- Use the year of the version that plays. Where a famous cover or remake is in the pool, give its own year.
- Reject previews whose title or artist do not closely match, and anything labelled live, karaoke, tribute or remix unless that is the intended version.
- Remove duplicates and near-duplicates (same song, several releases).
- Chart data, such as the public Billboard Hot 100 history on GitHub, may help the curator pick songs. It must not be used as the source of the year.

**Record schema** (one JSON object per song; a static `songs.json` is enough for v1):

| Field | Purpose |
| --- | --- |
| id | Stable unique id |
| title | Display title, with remaster and version suffixes stripped |
| artists | List of the main artists. Any one of them is a correct guess |
| featuredArtists | Featured artists, shown on the reveal but never accepted as a guess |
| artistAliases | Optional list of accepted alternate spellings (see Guessing the artist) |
| year | Real original release year, the value the game scores against |
| itunesTrackId | For re-resolving the preview later |
| previewUrl | The 30-second clip, resolved by the script |
| artworkUrl | Album art for the reveal screen |

There is no difficulty or tier field. Blocked songs and play history are kept separately (below), not in this file.

**Confirming the real year.** Nathan does not want to check years himself, because he does not want the songs spoiled for him. The process must therefore settle every song without him.

1. The curator proposes each song with a year and a short note on where the year came from.
2. **Two independent verification agents** each research the real original year of every song. They work separately, do not see each other's answers, and ideally do not see the curator's year either.
3. Compare the curator and both verifiers. If all agree, the year is confirmed.
4. If they disagree, do not discard the song. Research the real answer from primary or reliable evidence, such as the original single or album release record, the label, the artist's official discography and music databases, and decide. Record the evidence.
5. Only remove a song if its year is still genuinely uncertain after that research. Replace it from the extra candidates.
6. Use iTunes' dates only as one more hint. See Audio for why they are unreliable.

**What counts as the original year:** the year the recording was first released to the public, as a single or on an album, whichever came first. Not a remaster, compilation, reissue, streaming-release or chart year. A song released in December that charts in January keeps its December year.

**No spoilers for Nathan.** The audit evidence for each song goes in a private file that Nathan does not open. What Nathan sees is counts only: songs per decade, how many were resolved after a disagreement, and how many were removed. He is never asked to review individual songs.

**No repeated songs.**

- A song never plays twice in one game.
- The game also remembers songs already played in earlier games and skips them. Store play history in Supabase (song id, game, time) and give the host a Reset played songs button. If the filtered pool runs out, tell the host and offer the reset.

**Blocklist.**

- On the reveal screen, the host can tap Remove from future games. This works only after the answer is shown, so nobody is spoiled.
- Blocked song ids are stored in Supabase and skipped when songs are chosen.
- The host has a screen listing blocked songs, where a song can be restored. Showing titles there is fine, since those songs have already been revealed.
- Blocking applies in future rounds and future games, not retroactively to the current round's scoring.

## Audio

Nathan chose Apple's iTunes Search API as the audio source for v1. It is free, needs no developer account or key, and returns a 30-second preview URL, artwork and basic metadata for each track. Nobody needs an Apple Music subscription to hear a clip. **In v1 only the host device plays audio.** Playing the song from every phone is a later version.

**What the API does and does not give you**

- The result field `previewUrl` points to a 30-second clip, [per Apple's documentation](https://performance-partners.apple.com/resources/documentation/itunes-store-web-service-search-api/). Search is by term and country; `limit` accepts 1 to 200.
- Apple documents a rate limit of about 20 calls per minute, subject to change. Resolving 2,000 songs at one search each takes at least 100 minutes, and a doubled pool takes about twice that, so the resolver script must throttle, save progress to disk after every song, and resume where it stopped.
- The `releaseDate` the API returns [is reported by developers](https://developer.apple.com/forums/thread/71569) to be an iTunes-specific date, not the album's original release date. So never score against it. Use it only as one extra hint when confirming years (see Song data).
- Preview URLs may change over time. Store `itunesTrackId` so the resolver or the game can look the clip up again when one fails.

**Terms of use: decided.** Apple's documentation says previews may only be used to promote store content and must be streamed rather than downloaded, saved or cached. Nathan has decided this game is for personal use only and that streaming the previews is acceptable to him. The build should keep to the spirit of that: stream clips directly from Apple's URLs, never download or re-host the audio files, and do not turn the game into a public service. A link from the reveal screen to the song's Apple Music page is a nice touch but optional. This document is not legal advice.

**Where the resolver can run.** During scoping, requests from the planning sandbox to `itunes.apple.com` and `musicbrainz.org` were refused by its network proxy, so the build agent may hit the same wall. The resolver should be a standalone script that Nathan can run on his own computer, outputting the final `songs.json`. It should print only counts, not song details, so Nathan is not spoiled.

**Playback behavior on the host screen**

- Play with an HTML audio element on the host device, started from a user click to satisfy browser autoplay rules. Phones stay silent.
- Loop the 30-second clip while the round timer runs, or stop and show a replay button. Either is acceptable; looping is simpler.
- Preload the next round's clip during the reveal so rounds start without a gap.
- Provide volume, pause and skip controls on the host.
- On load failure, show an error to the host only, offer Skip, and log the song id for cleanup.

## Architecture

Nathan decided that v1 goes straight to the cloud on Supabase. Everything else in the design is left to the build agent, who should record each decision and its reason in the repo README.

**Requirements any design must meet**

- Real-time two-way messaging between one host screen and up to about 12 phones, with answers appearing on the host within a fraction of a second.
- Join by short room code and by scanning a QR code on the host screen. The QR must encode the public address of the deployed site.
- Mobile-first phone pages that need no install, no login and no app store.
- Players rejoin the same seat after a refresh, a closed tab or a dropped connection, including from a different browser by entering the room code and their old name (see Core loop, Rejoining).
- A name already in use by a connected player in the same room is rejected with a friendly message.
- The host page can be refreshed without ending the game.
- Songs are never repeated, within a game or across games, and blocked songs are skipped. Both need stored state.
- Game rules, scoring, the artist matcher and the sudden-death logic should be plain functions with automated tests, separate from the network code.
- Cheating is not a concern. A static song file that includes the answers is acceptable.

**What using Supabase implies** (details for the agent to decide)

- **Live updates:** Supabase Realtime carries messages between the host and phones during a round.
- **Saved state:** because rejoining is a hard requirement, keep room, player, round, answer, timeline, play-history and blocklist state in the Supabase database, not only in a browser tab's memory. A refreshed host or phone then reloads its state instead of losing it. The agent decides the exact split between database rows and realtime messages.
- **Access rules:** the public key ships to every browser, so turn on Row Level Security and write simple policies suited to a casual game, rather than leaving tables open.
- **Where the web app lives:** Supabase serves the data, not the pages. The static site is hosted on GitHub Pages (decided). Set the site's base path for the repository address, and check whether the repository must be public for free Pages. Nathan is fine with the song file being publicly readable.
- **Idle projects:** check whether a free Supabase project pauses when unused and how to wake it, so it does not catch the group out on game night.
- **Limits:** check current free-tier connection and message limits against 12 phones plus a host before committing.

**Frontend stack.** Not specified. Prefer something small that builds to static files and works well on phone browsers (a plain TypeScript or JavaScript app, or a light framework). Avoid a heavy toolchain for a one-evening game.

## Findings from scoping

No game code has been written. The planning pass only tested what data and services were reachable. Treat the "not checked" rows as the first things the build agent should confirm.

| Finding | Status |
| --- | --- |
| Apple's Search API returns a 30-second `previewUrl` for tracks, with a rate limit of about 20 calls per minute | Read from [Apple's documentation](https://performance-partners.apple.com/resources/documentation/itunes-store-web-service-search-api/) |
| Apple's preview terms limit previews to promoting store content, streamed only, not downloaded or cached | Read from the same documentation; Nathan decided streaming for personal use is acceptable, see Audio |
| The API's `releaseDate` may not be the original release year | Reported in [an Apple developer forum thread](https://developer.apple.com/forums/thread/71569) with no official reply; treat as a real risk |
| `data-out/hot-100-current.csv` in `utdata/rwd-billboard-data` downloads from `raw.githubusercontent.com` and has the columns chart_week, title, performer, peak_pos, wks_on_chart | Tested; first rows were dated 2022-01-01 |
| How far back that file (or the repo) goes, and whether it covers 1958 onward | Not checked; clone was interrupted before inspection. Less important now that the song list is agent-curated |
| Network access to `itunes.apple.com` and `musicbrainz.org` from the planning sandbox | Refused by the sandbox proxy (HTTP 403); the build agent's environment may differ |
| Whether the preview URLs play in a browser audio element, and whether they expire | Not checked |
| Whether the iTunes lookup endpoint accepts several track ids in one call, which would speed up re-resolving | Not checked |
| Supabase Realtime free-tier limits and per-channel message visibility | Not checked |

**Why not Spotify.** The group uses Apple Music, and Spotify stopped serving preview URLs to new apps in its Web API in late 2024, according to [Spotify developer forum posts](https://community.spotify.com/t5/Spotify-for-Developers/Kind-request-regarding-the-Spotify-Web-API-preview-url/td-p/6909407). The official Hitster app also connects to Spotify, so it is not an option for this group.

**Existing alternatives not chosen.** Third-party Apple Music apps such as Beatster and Hitstalt scan the physical Hitster cards and play the song through Apple Music. They keep the one-guesser-per-turn rules, so they do not fix the problem this project is for.

## Open questions for Nathan

Nathan has answered every earlier question, and the answers are built into this plan. One small item remains, and the agent can proceed on its default.

**Confirmed by Nathan**

- The 12-card Timeline target includes the two starting cards, so a player needs 10 correct placements.
- Starting cards are two year-only cards per player with different years between 1970 and 2015, and no two players get the same pair where possible.
- Timeline sudden death: if players are still tied after the artist-hit tiebreak, only the tied players answer further songs and the closest year guess wins, repeating until one winner remains. Closest Year mode uses the same style of sudden death.
- Songs played in earlier games are also skipped, until the host taps Reset played songs.
- A player who lost their phone's session can take back their seat by entering the room code and their old name, as long as that seat is not currently connected.
- The static site is hosted on **GitHub Pages**.
- Nathan has no Supabase project yet. **Creating the Supabase project and the GitHub repository is part of the build.**

**Still open (proceed on the default)**

- [ ] **Player limit.** Default: up to 12 players per room. Is that enough for the biggest group?

**Later versions (not in v1, but do not design them out)**

- Playing the song on every phone as well as the host.
- Title guessing as a second bonus.
- Teams, and a speed bonus.

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
