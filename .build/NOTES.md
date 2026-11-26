# Build notes (handoff between phases)

Keep this file short. Newest information wins.

01-setup facts: repo https://github.com/Natron21405/jukebox (public, branch main, pushed). Pages URL will be https://natron21405.github.io/jukebox/ . App in app/ (Vite+TS, vitest, base /jukebox/): dev 'cd app && npm run dev', tests 'cd app && npm test', build 'cd app && npm run build'. Root package.json is for tools only (npm install at root). tools/env.mjs = .env loader (strips inline comments); 'node tools/sync-app-env.mjs' writes app/.env (VITE_ vars). Workflow stub .github/workflows/deploy.yml (needs Pages source=GitHub Actions + secrets VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY, phase 13). No psql/supabase CLI installed: migrations via node 'pg' using SUPABASE_DB_URL. Smoke results: realtime A<->B exchange OK (about 40 ms each way); iTunes 20/20 previews returned audio (HTTP 206 on range probe); DB select 1 FAILED: SUPABASE_DB_URL in .env is malformed (no postgresql://user:password@ prefix).
- [BLOCKED 2026-11-26 18:54] 01-setup: Everything else in 01-setup is done (repo pushed, app scaffolded, realtime works, 20/20 iTunes previews OK). One fix needed: SUPABASE_DB_URL in .env is malformed; it is missing the 'postgresql://postgres:' start, so it begins with the password. 1) Open the Supabase dashboard > your project > Connect > 'Direct connection' (or 'Session pooler' if your network has no IPv6) and copy the full URI, which looks like postgresql://postgres:[YOUR-PASSWORD]@db.<ref>.supabase.co:5432/postgres. 2) Replace [YOUR-PASSWORD] with your database password; if it contains characters like + $ @ / # ?, URL-encode them (+ is %2B, $ is %24, @ is %40) or reset the password in Project Settings > Database to a simple letters-and-digits one. 3) Put the whole string on the SUPABASE_DB_URL line of .env with no spaces or trailing comment. 4) Run: node tools/smoke-realtime.mjs  (expect 4 passed), then re-run the driver: node run_phases.mjs. Note: the database password was accidentally printed in an agent log while debugging, so resetting it (Project Settings > Database) is recommended, then use the new one.
- [BLOCKED 2026-11-26 18:55] 01-setup: SUPABASE_DB_URL in .env still does not work. It starts with the password instead of 'postgresql://postgres:', and even with that fixed the direct host db.<ref>.supabase.co does not resolve from this machine (IPv4-only network, DNS ENOTFOUND). Do this: 1) Supabase dashboard > your project > Connect > choose 'Session pooler' (not Direct connection) and copy the full URI, which looks like postgresql://postgres.<ref>:[YOUR-PASSWORD]@aws-0-<region>.pooler.supabase.com:5432/postgres. 2) Replace [YOUR-PASSWORD] with the database password, URL-encoding special characters (+ is %2B, $ is %24, @ is %40), or reset it in Project Settings > Database to a simple letters-and-digits one (recommended, as the old one was printed in an agent log). 3) Put the whole string on the SUPABASE_DB_URL line of .env, with no spaces or trailing comment. 4) Re-run: node run_phases.mjs. Everything else in 01-setup is already done and passing.
- [BLOCKED 2026-11-26 18:57] 01-setup: SUPABASE_DB_URL in .env is now well-formed but still uses the direct host (db.<ref>.supabase.co), which does not resolve on this IPv4-only network (ENOTFOUND). Do this: 1) Supabase dashboard > your project > Connect > choose 'Session pooler' (not 'Direct connection') and copy the URI, which looks like postgresql://postgres.<ref>:[YOUR-PASSWORD]@aws-0-<region>.pooler.supabase.com:5432/postgres (the user part is postgres.<ref>, not plain postgres). 2) Put your database password in place of [YOUR-PASSWORD], URL-encoding special characters (+ is %2B, $ is %24, @ is %40). 3) Replace the SUPABASE_DB_URL line in .env with that whole string, no spaces or trailing comment. 4) Check with: node tools/smoke-realtime.mjs (expect 4 passed), then re-run: node run_phases.mjs. Everything else in 01-setup is done and passing (repo pushed, app scaffolded, realtime OK, 20/20 iTunes previews).
01-setup UNBLOCKED: SUPABASE_DB_URL now uses session pooler and works. Final smoke: realtime 4/4 passed (incl. DB select 1), iTunes 20/20 previews audio, app tests 1/1. Migrations: node 'pg' with SUPABASE_DB_URL.
- [done 2026-11-26 19:07] 01-setup: Repo pushed, app scaffolded, realtime 4/4 smoke checks pass incl. DB select 1, iTunes 20/20 previews OK
02-logic: pure modules in app/src/logic/ (import from './logic' index). Tests: 'cd app && npm test' (91 pass). No network/DOM imports. All tunables in CONFIG (config.ts). Randomness is injected: type Rng=()=>number, seededRng(seed) for tests.
 config.ts: CONFIG {maxPlayers 12, maxNameLength 20, roundSeconds 40, songYearMin 1950, timeline{targetCards 12, startingCards 2, startYearMin 1970, startYearMax 2015}, closestYear{rounds 15, pointsTable}, artistBonus 2, matcher{editsByLength, minSurnameLength 4}}; defaultYearMax(now).
 types.ts: Song {id,title,artists[],featuredArtists[],artistAliases?,year,itunesTrackId?,previewUrl?,artworkUrl?}.
 matcher.ts: matchArtist(guess, {artists, artistAliases?, groupArtists?, featuredArtists?}) -> {matched, kind: exact|typo|alias|surname|null}; isArtistMatch -> boolean; normalizeName. featuredArtists is never used. Surname rule is on by default for multi-word names; OFF for names starting 'The', containing 'and'/'&', or listed in optional groupArtists. DATA PHASES: songs with a band/duo name that has no 'The' (e.g. two-word band names) should list it in an optional 'groupArtists' field in songs.json so a lone last word is not accepted; also add aliases like the P!nk/Guns N' Roses cases. Partial names (a strict subset of the words) never match by typo tolerance. Whole credit of a multi-artist song ('A & B') also counts.
 timeline.ts: Card {year, songId?, starter?}; timelines are sorted arrays; slot n = insert before index n (0..length). drawStartingCards(rng, usedPairs), dealStartingHands(ids, rng, usedPairs?) -> Record<id, Card[]>, startingPairKey(timeline) for late joiners (pass existing keys as usedPairs), isPlacementCorrect(timeline, slot, year), applyPlacement(timeline, slot, {id,year}) -> {correct, timeline} (wrong or null slot returns same cards).
 scoring.ts: closestYearPoints(guess|null, truth), artistPoints(hit), scoreClosestYearRound(guess, truth, hit) -> {distance, yearPoints, artistPoints, total}.
 endgame.ts: Outcome = continue | winner{winnerId, decidedBy} | suddenDeath{contenders}. timelineOutcome(players[{id,cards,artistHits}], target?) (call after each round), closestYearOutcome(players[{id,score}]) (after last round; isClosestYearOver(roundsPlayed)), resolveSuddenDeathRound([{id, year|null}], truthYear) (pass only current contenders; repeat while status=suddenDeath), rankTimeline, rankClosestYear.
 selection.ts: chooseNextSong(pool, {playedThisGame, playedEarlier?, blocked?, yearRange?}, rng) -> {status:ok, song, remaining} | {status:exhausted, resetWouldHelp}; availableSongs(pool, filters).
 names.ts: decideJoin(seats[{id,name,connected}], name) -> new | reclaim{seatId} | rejected{reason: empty|too-long|taken|full}; NAME_TAKEN_MESSAGE.
- [done 2026-11-26 19:10] 02-logic: Pure logic modules (config, matcher, timeline, scoring, endgame, selection, names) with 90 new tests, all passing
03-curate-1950s: data/work/candidates/1950s.json (46 = 40 base + 6 extra), parts in candidates/parts/1950s-1.json; checker passes.
- [done 2026-11-26 19:11] 03-curate-1950s: 46 songs curated for 1950s (40 base, 6 extra), checker passes
03-curate-1960s: data/work/candidates/1960s.json (161 = 140 base + 21 extra), parts 1960s-1/2.json; checker passes, max 6 per artist across 1950s+1960s. Band names without 'The' carry an extra groupArtists field.
- [done 2026-11-26 19:16] 03-curate-1960s: 161 songs curated for 1960s (140 base, 21 extra), checker passes
03-curate-1970s: data/work/candidates/1970s.json (403 = 350 base + 53 extra), parts 1970s-1..5.json (built from data/work/src-1970s-*.txt via data/work/build-1970s.mjs); checker passes. Rolling Stones artist cap is full across 1960s+1970s. Band names without 'The' carry groupArtists.
- [done 2026-11-26 19:22] 03-curate-1970s: 403 songs curated for 1970s (350 base, 53 extra), checker passes
- [done 2026-11-26 19:31] 03-curate-1980s: 460 songs curated for 1980s (400 base, 60 extra), checker passes
03-curate-1980s: data/work/candidates/1980s.json (460 = 400 base + 60 extra), parts 1980s-1..5.json built from data/work/src-1980s-*.txt via data/work/build-1980s.mjs (dedupes, applies artist cap across decades); checker passes. Band names without 'The' carry groupArtists.
03-curate-1990s: data/work/candidates/1990s.json (460 = 400 base + 60 extra), parts 1990s-1..5.json built from data/work/src-1990s-*.txt via data/work/build-1990s.mjs (dedupes, applies artist cap across decades); checker passes. Band names without 'The' carry groupArtists.
- [done 2026-11-26 19:38] 03-curate-1990s: 460 songs curated for 1990s (400 base, 60 extra), checker passes
03-curate-2000s: data/work/candidates/2000s.json (403 = 350 base + 53 extra), parts 2000s-1..5.json built from data/work/src-2000s-*.txt via data/work/build-2000s.mjs (dedupes, drops out-of-range years, applies artist cap across decades); checker passes. Band names without 'The' carry groupArtists.
- [done 2026-11-26 19:41] 03-curate-2000s: 403 songs curated for 2000s (350 base, 53 extra), checker passes
03-curate-2010s: data/work/candidates/2010s.json (345 = 300 base + 45 extra), parts 2010s-1..4.json built from data/work/src-2010s-*.txt via data/work/build-2010s.mjs (dedupes, drops out-of-range years, applies artist cap across decades); checker passes. Band names without 'The' carry groupArtists.
- [done 2026-11-26 19:50] 03-curate-2010s: 345 songs curated for 2010s (300 base, 45 extra), checker passes
03-curate-2020s: data/work/candidates/2020s.json (81 = 70 base + 11 extra), part 2020s-1.json built from data/work/src-2020s-a.txt via data/work/build-2020s.mjs (dedupes, drops out-of-range years, applies artist cap across decades); checker passes. Band names without 'The' carry groupArtists.
- [done 2026-11-26 19:53] 03-curate-2020s: 81 songs curated for 2020s (70 base, 11 extra), checker passes
- [done 2026-11-26 19:54] 04-verifyA:1960s-01: 40 songs answered blind: 37 high, 3 medium, 0 low
- [done 2026-11-26 19:54] 04-verifyA:1950s-02: 6 of 6 songs answered: 5 high, 0 medium, 1 low
- [done 2026-11-26 19:54] 04-verifyA:1950s-01: 40 songs answered blind: 38 high, 2 medium, 0 low
- [done 2026-11-26 19:54] 04-verifyA:1960s-02: 40 songs answered blind: 40 high, 0 medium, 0 low
- [done 2026-11-26 19:54] 04-verifyA:1960s-05: 1 song answered blind: 1 high, 0 medium, 0 low
- [done 2026-11-26 19:54] 04-verifyA:1960s-03: 40 songs answered blind: 39 high, 1 medium, 0 low
- [done 2026-11-26 19:54] 04-verifyA:1960s-04: 40 songs answered blind: 38 high, 1 medium, 1 low
- [done 2026-11-26 19:54] 04-verifyA:1970s-01: 40 songs answered blind: 40 high, 0 medium, 0 low
- [done 2026-11-26 19:55] 04-verifyA:1970s-02: 40 songs answered blind: 40 high, 0 medium, 0 low
- [done 2026-11-26 19:55] 04-verifyA:1970s-04: 40 songs answered blind: 38 high, 2 medium, 0 low
- [done 2026-11-26 19:55] 04-verifyA:1970s-03: 40 songs answered blind: 40 high, 0 medium, 0 low
- [done 2026-11-26 19:55] 04-verifyA:1970s-06: 40 songs answered blind: 38 high, 2 medium, 0 low
- [done 2026-11-26 19:55] 04-verifyA:1970s-05: 40 songs answered blind: 37 high, 3 medium, 0 low
- [done 2026-11-26 19:56] 04-verifyA:1970s-07: 40 songs answered blind: 39 high, 1 medium, 0 low
- [done 2026-11-26 19:59] 04-verifyA:1970s-09: 40 songs answered blind: 33 high, 7 medium, 0 low
- [done 2026-11-26 19:59] 04-verifyA:1970s-11: 3 songs answered blind: 3 high, 0 medium, 0 low
- [done 2026-11-26 19:59] 04-verifyA:1970s-10: 40 songs answered blind: 38 high, 2 medium, 0 low
- [done 2026-11-26 19:59] 04-verifyA:1970s-08: 40 songs answered blind: 38 high, 2 medium, 0 low
- [done 2026-11-26 19:59] 04-verifyA:1980s-01: 40 songs answered blind: 35 high, 5 medium, 0 low
- [done 2026-11-26 20:00] 04-verifyA:1980s-03: 40 songs answered blind: 36 high, 4 medium, 0 low
- [done 2026-11-26 20:00] 04-verifyA:1980s-02: 40 songs answered blind: 38 high, 2 medium, 0 low
- [done 2026-11-26 20:00] 04-verifyA:1980s-04: 40 songs answered blind: 37 high, 3 medium, 0 low
- [done 2026-11-26 20:00] 04-verifyA:1980s-05: 40 songs answered blind: 39 high, 1 medium, 0 low
- [done 2026-11-26 20:00] 04-verifyA:1980s-06: 40 songs answered blind: 38 high, 2 medium, 0 low
- [done 2026-11-26 20:01] 04-verifyA:1980s-07: 40 songs answered blind: 39 high, 1 medium, 0 low
- [done 2026-11-26 20:01] 04-verifyA:1980s-08: 40 songs answered blind: 39 high, 1 medium, 0 low
- [done 2026-11-26 20:01] 04-verifyA:1980s-09: 40 songs answered blind: 37 high, 3 medium, 0 low
- [done 2026-11-26 20:01] 04-verifyA:1980s-11: 40 songs answered blind: 38 high, 2 medium... 
Correction: 04-verifyA:1980s-11 actual counts are 37 high, 3 medium, 0 low (40 answered).
- [done 2026-11-26 20:02] 04-verifyA:1980s-10: 40 songs answered blind: 34 high, 6 medium, 0 low
- [done 2026-11-26 20:02] 04-verifyA:1980s-12: 20 songs answered blind: 15 high, 5 medium, 0 low
- [done 2026-11-26 20:02] 04-verifyA:1990s-01: 40 songs answered blind: 38 high, 2 medium, 0 low
- [done 2026-11-26 20:02] 04-verifyA:1990s-02: 40 songs answered blind: 38 high, 2 medium, 0 low
- [done 2026-11-26 20:03] 04-verifyA:1990s-03: 40 songs answered blind: 34 high, 6 medium, 0 low
- [done 2026-11-26 20:03] 04-verifyA:1990s-05: 40 songs answered blind: 33 high, 7 medium, 0 low
- [done 2026-11-26 20:03] 04-verifyA:1990s-04: 40 songs answered blind: 37 high, 3 medium, 0 low
- [done 2026-11-26 20:03] 04-verifyA:1990s-06: 40 songs answered blind: 39 high, 1 medium, 0 low
- [done 2026-11-26 20:04] 04-verifyA:1990s-07: 40 songs answered blind: 33 high, 7 medium, 0 low
- [done 2026-11-26 20:04] 04-verifyA:1990s-08: 40 songs answered blind: 35 high, 5 medium, 0 low
- [done 2026-11-26 20:04] 04-verifyA:1990s-09: 40 songs answered blind: 34 high, 6 medium, 0 low
- [done 2026-11-26 20:05] 04-verifyA:1990s-12: 20 songs answered blind: 18 high, 2 medium, 0 low
- [done 2026-11-26 20:05] 04-verifyA:1990s-11: 40 songs answered blind: 30 high, 10 medium, 0 low
- [done 2026-11-26 20:05] 04-verifyA:1990s-10: 40 songs answered blind: 31 high, 9 medium, 0 low
- [done 2026-11-26 20:05] 04-verifyA:2000s-01: 40 songs answered blind: 32 high, 8 medium, 0 low
- [done 2026-11-26 20:05] 04-verifyA:2000s-02: 40 songs answered blind: 37 high, 3 medium, 0 low
- [done 2026-11-26 20:06] 04-verifyA:2000s-03: 40 songs answered blind: 35 high, 5 medium, 0 low
04-verifyA:2000s-04: 2 ids (2000s-153, 2000s-156) have title/artist pairings I could not find as real recordings (artist not known to have recorded that title); answered low with the year of the same-title song by another artist. Curator/reconciler should check the pairing.
- [done 2026-11-26 20:06] 04-verifyA:2000s-04: 40 songs answered blind: 33 high, 5 medium, 2 low
- [done 2026-11-26 20:06] 04-verifyA:2000s-05: 40 songs answered blind: 32 high, 8 medium, 0 low
- [done 2026-11-26 20:07] 04-verifyA:2000s-06: 40 songs answered blind: 32 high, 8 medium, 0 low
04-verifyA:2000s-07: medium answers hinge on album-vs-single or indie-release rules (ids 2000s-242, 245, 261, 266, 269, 275); I used the earliest public release (album track before single).
- [done 2026-11-26 20:07] 04-verifyA:2000s-07: 40 songs answered blind: 32 high, 8 medium, 0 low
04-verifyA:2000s-09: id 2000s-357 has a title/artist pairing I could not find as a real recording; answered low with the year of the same-title song by another artist. Curator/reconciler should check the pairing.
- [done 2026-11-26 20:08] 04-verifyA:2000s-09: 40 songs answered blind: 30 high, 9 medium, 1 low
04-verifyA:2000s-08: id 2000s-291 (title/artist pairing) could not be found as a real recording; answered low as a guess. Curator/reconciler should check the pairing.
- [done 2026-11-26 20:08] 04-verifyA:2000s-08: 40 songs answered blind: 28 high, 11 medium, 1 low
- [done 2026-11-26 20:08] 04-verifyA:2000s-11: 3 songs answered blind: 3 high, 0 medium, 0 low
04-verifyA:2000s-10: id 2000s-371 has a title that matches an album, not a song (answered low with the album year); curator/reconciler should check.
- [done 2026-11-26 20:08] 04-verifyA:2000s-10: 40 songs answered blind: 26 high, 13 medium, 1 low
- [done 2026-11-26 20:08] 04-verifyA:2010s-01: 40 songs answered blind: 37 high, 3 medium, 0 low
- [done 2026-11-26 20:09] 04-verifyA:2010s-02: 40 songs answered blind: 40 high, 0 medium, 0 low
- [done 2026-11-26 20:09] 04-verifyA:2010s-03: 40 songs answered blind: 36 high, 4 medium, 0 low
- [done 2026-11-26 20:09] 04-verifyA:2010s-04: 40 songs answered blind: 36 high, 4 medium, 0 low
- [done 2026-11-26 20:09] 04-verifyA:2010s-05: 40 songs answered blind: 35 high, 5 medium, 0 low
- [done 2026-11-26 20:09] 04-verifyA:2010s-06: 40 songs answered blind: 39 high, 1 medium, 0 low
04-verifyA:2010s-07: medium answers hinge on album-vs-single dates (ids 2010s-241, 273, 274, 278, 280); used earliest public release.
- [done 2026-11-26 20:10] 04-verifyA:2010s-07: 40 songs answered blind: 35 high, 5 medium, 0 low
04-verifyA:2010s-09: id 2010s-335 title/artist pairing could not be confirmed as a real recording; answered low (guess). Curator/reconciler should check the pairing.
- [done 2026-11-26 20:10] 04-verifyA:2010s-09: 25 songs answered blind: 21 high, 3 medium, 1 low
- [done 2026-11-26 20:10] 04-verifyA:2020s-01: 40 songs answered blind: 39 high, 1 medium, 0 low
- [done 2026-11-26 20:10] 04-verifyA:2010s-08: 40 songs answered blind: 36 high, 4 medium, 0 low
- [done 2026-11-26 20:11] 04-verifyA:2020s-03: 1 song answered blind: 1 high, 0 medium, 0 low
- [done 2026-11-26 20:11] 04-verifyA:2020s-02: 40 songs answered blind: 38 high, 2 medium, 0 low
- [done 2026-11-26 20:12] 04-verifyB:1960s-01: 40 songs answered blind: 37 high, 3 medium, 0 low
- [done 2026-11-26 20:12] 04-verifyB:1950s-02: 6 songs answered blind: 5 high, 1 medium, 0 low
- [done 2026-11-26 20:12] 04-verifyB:1950s-01: 40 songs answered blind: 39 high, 1 medium, 0 low
- [done 2026-11-26 20:12] 04-verifyB:1960s-02: 40 songs answered blind: 39 high, 1 medium, 0 low
- [done 2026-11-26 20:12] 04-verifyB:1960s-03: 40 songs answered blind: 38 high, 2 medium, 0 low
- [done 2026-11-26 20:12] 04-verifyB:1960s-05: 1 song answered blind: 1 high, 0 medium, 0 low
- [done 2026-11-26 20:12] 04-verifyB:1960s-04: 40 songs answered blind: 39 high, 1 medium, 0 low
- [done 2026-11-26 20:13] 04-verifyB:1970s-01: 40 songs answered blind: 40 high, 0 medium, 0 low
- [done 2026-11-26 20:13] 04-verifyB:1970s-02: 40 songs answered blind: 40 high, 0 medium, 0 low
- [done 2026-11-26 20:13] 04-verifyB:1970s-03: 40 songs answered blind: 36 high, 4 medium, 0 low
- [done 2026-11-26 20:13] 04-verifyB:1970s-04: 40 songs answered blind: 38 high, 2 medium, 0 low
- [done 2026-11-26 20:13] 04-verifyB:1970s-05: 40 songs answered blind: 39 high, 1 medium, 0 low
- [done 2026-11-26 20:13] 04-verifyB:1970s-06: 40 songs answered blind: 38 high, 2 medium, 0 low
- [done 2026-11-26 20:14] 04-verifyB:1970s-07: 40 songs answered blind: 36 high, 4 medium, 0 low
- [done 2026-11-26 20:14] 04-verifyB:1970s-08: 40 songs answered blind: 39 high, 1 medium, 0 low
- [done 2026-11-26 20:19] 04-verifyB:1970s-11: 3 songs answered blind: 3 high, 0 medium, 0 low
- [done 2026-11-26 20:19] 04-verifyB:1970s-09: 40 songs answered blind: 37 high, 3 medium, 0 low
- [done 2026-11-26 20:19] 04-verifyB:1970s-10: 40 songs answered blind: 38 high, 2 medium, 0 low
- [done 2026-11-26 20:20] 04-verifyB:1980s-01: 40 songs answered blind: 37 high, 3 medium, 0 low
04-verifyB:1980s-02: ids 1980s-060 and 1980s-065 are medium: an earlier separate-version release exists (indie/Stiff 1980 version) but the well-known recording is 1981; I answered 1981. Reconciler should decide.
- [done 2026-11-26 20:20] 04-verifyB:1980s-02: 40 songs answered blind: 38 high, 2 medium, 0 low
- [done 2026-11-26 20:20] 04-verifyB:1980s-03: 40 songs answered blind: 36 high, 4 medium, 0 low
04-verifyB:1980s-04: medium ids 1980s-122, 126, 148, 151, 154, 155 hinge on album-vs-single dates; I used the earliest public release (album track before single).
- [done 2026-11-26 20:20] 04-verifyB:1980s-04: 40 songs answered blind: 34 high, 6 medium, 0 low
04-verifyB:1980s-05: medium ids 1980s-163 and 1980s-193: album track released in 1983 before the 1984 single (163 was remixed for its single); I used the earlier album year. Reconciler should decide.
- [done 2026-11-26 20:21] 04-verifyB:1980s-05: 40 songs answered blind: 38 high, 2 medium, 0 low
04-verifyB:1980s-06: ids 1980s-206 (earlier different 1984 recording exists; answered the well-known 1985 recording) and 1980s-215 (single Dec 1986 per one source; answered 1986) are medium. Reconciler should decide.
- [done 2026-11-26 20:21] 04-verifyB:1980s-06: 40 songs answered blind: 38 high, 2 medium, 0 low
- [done 2026-11-26 20:21] 04-verifyB:1980s-08: 40 songs answered blind: 38 high, 2 medium, 0 low
04-verifyB:1980s-07: medium ids 1980s-247, 265, 268: album/soundtrack track released a few weeks before the single (single in the following year for 247 and 265); I used the earlier album/soundtrack year. Reconciler should decide.
- [done 2026-11-26 20:21] 04-verifyB:1980s-07: 40 songs answered blind: 37 high, 3 medium, 0 low
04-verifyB:1980s-09: medium ids 1980s-330 (single vs album date) and 1980s-347 (album track Nov 1983 before 1984 single/soundtrack); I used the earlier album year. Reconciler should decide.
- [done 2026-11-26 20:21] 04-verifyB:1980s-09: 40 songs answered blind: 38 high, 2 medium, 0 low
04-verifyB:1980s-11: medium ids 1980s-403, 414, 421, 425, 437: album released before the single (single in following year); I used the earlier album year. Reconciler should decide.
- [done 2026-11-26 20:22] 04-verifyB:1980s-11: 40 songs answered blind: 35 high, 5 medium, 0 low
