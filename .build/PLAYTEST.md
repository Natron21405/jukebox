# Playtest checklist: first real session

Site: https://natron21405.github.io/jukebox/
Host screen (laptop or TV browser): https://natron21405.github.io/jukebox/#/host
Phones: scan the QR on the host screen, or open the site and type the room code.

## Day before
- [ ] Wake Supabase: open the dashboard (supabase.com/dashboard) or run `node tools/apply-migrations.mjs --verify`. Free projects pause after 1 week idle; a restore can take a few minutes.
- [ ] Open the host page once on the device that will play audio. Check it loads and shows a room code.

## Join (use at least 3 real phones; ideally one on cellular)
- [ ] Scan the QR: the name screen appears with the code filled in.
- [ ] Join with a name. It shows up on the host lobby within a second or two.
- [ ] Duplicate name: a second phone tries the same name (any capitals or spacing) and is refused with a clear message.
- [ ] Refresh a phone mid-lobby: it comes back in the same seat.
- [ ] Close the tab, reopen the site, type the room code and the old name: same seat, same state.
- [ ] Join from a different browser with the old name after closing the first one: takes over the seat.
- [ ] Kick a player from the lobby (two taps): their phone returns to the join form and the name is free again.
- [ ] Try 10 or more phones if you can; the limit is 12.

## Audio (host device)
- [ ] Tap "Tap to play" on the host: the clip plays from the host speakers or TV. Browsers need that tap.
- [ ] Volume: check the laptop or TV volume reaches the room. Phones stay silent by design.
- [ ] If a clip will not load, "Skip song" moves on without counting the round.
- [ ] Audio start lag is acceptable with 10 phones connected (how many seconds from round start to sound?).

## Closest Year
- [ ] Year picker works one-handed (slider, plus and minus, press and hold).
- [ ] Type an artist guess (try a small typo and a surname only); check the reveal marks it right or wrong sensibly.
- [ ] Lock In is final; the host moves on early when everybody has locked in.
- [ ] Let one round run out of time: answers still count.
- [ ] Host override of an artist verdict changes the score.
- [ ] Reveal and scoreboard are readable from across the room.
- [ ] Tie at the end goes to sudden death (set few rounds to try it).

## Timeline
- [ ] Each phone shows only its own timeline, with the two starter cards.
- [ ] Pick a slot, change it, lock in. Right slot adds the card; wrong slot adds nothing.
- [ ] Equal years accept either side.
- [ ] Artist hits show on the reveal; first to the target wins (set a low target to finish quickly).
- [ ] A phone that joins late gets starter cards before the next song.
- [ ] Timeline text is legible on the phone and the host's card counts are legible from across the room.

## Refresh and resilience
- [ ] Refresh the host page mid-round: the game resumes, no restart.
- [ ] Refresh a phone mid-round: it returns to the right screen.
- [ ] Lock a phone screen for 30 seconds, then wake it: it reconnects.

## Blocklist and history
- [ ] On a reveal, use "Remove from future games", then Undo.
- [ ] Remove one for real; open Song settings in the lobby and see it listed; restore it.
- [ ] Play two games in a row: no song from game one shows up in game two.
- [ ] "Reset played songs" asks for confirmation, then makes earlier songs available again.

## Afterwards
Write down what felt slow, confusing or too small, plus any song that had a wrong year or a clip that did not match.

---

## Take the site down
- Quick: repo Settings > Pages > Unpublish site (or `gh api -X DELETE repos/Natron21405/jukebox/pages`). Put it back with `gh api -X POST repos/Natron21405/jukebox/pages -f build_type=workflow` and rerun the workflow (`gh workflow run deploy.yml`).
- Full: make the repo private or delete it. Free Pages needs a public repo, so making it private also takes the site down.
- The Supabase project keeps its data. To stop all game traffic as well, pause the project in the Supabase dashboard.

## Rerun the song pipeline for more songs
1. Easiest: `SONG_MULTIPLIER=2 node run_phases.mjs --reset 03` (and the later song phases), which curates, verifies, resolves previews and rewrites `songs.json` at about double size. Previews take hours but are resumable.
2. If only the preview or final step needs redoing: `node tools/resolve-previews.mjs` (resumable, re-run after any "stopped:" message), then `node tools/finalize-songs.mjs`.
3. Check counts only: `cd app && npm test` (the songs file test checks the decade totals).
4. Commit `app/public/songs.json` and push; the workflow redeploys. Do not open the file if you want the surprise kept.
5. Played history and the blocklist hold song ids, so existing ids should keep their meaning; if ids are renumbered, use Reset played songs and review the blocklist.

## Supabase pausing
The Free plan pauses a project after about 1 week without activity (a warning email arrives first). Data is kept. Open the dashboard and click Restore, or open the dashboard a day before a party. Realtime limits on Free (200 connections, 100 messages per second) are far above one game's needs, apart from short bursts at reveals (see README).
