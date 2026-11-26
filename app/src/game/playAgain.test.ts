import { afterEach, describe, expect, it } from 'vitest';
import { seededRng, type Card, type GameSong } from '../logic';
import {
  HostSession, createFakeBackend, createHostRoom, joinGame, loadPublicState, memoryKV, resumeSeat, startPhoneSession,
  type KV, type PhoneSession, type StoredHost,
} from '../net';
import { winnerOf } from './closestYear';
import { TimelineGame } from './timeline';
import { sendTimelineAnswer, timelinePhoneView } from './timelinePhone';

// Play Again must give a clean game: same room and players, but nothing from the last game's results.
// Made-up songs only. Every title is unique, so a leak of an old reveal is easy to spot in a snapshot.
const POOL: GameSong[] = Array.from({ length: 60 }, (_, n) => ({
  id: `p-${String(n).padStart(3, '0')}`,
  title: `Zanzibar Title ${n}x`,
  artists: [`Plonk Collective ${n}x`],
  featuredArtists: [],
  year: 1960 + ((n * 7) % 55),
}));
const byId = new Map(POOL.map((s) => [s.id, s]));
const NAMES = ['Ana', 'Bo', 'Cy'];

const rightSlot = (t: readonly Card[], year: number) =>
  Array.from({ length: t.length + 1 }, (_, i) => i).find((i) => (i === 0 || t[i - 1].year <= year) && (i === t.length || year <= t[i].year))!;

const open: PhoneSession[] = [];
afterEach(async () => { while (open.length) await open.pop()!.stop(); });

describe('play again (fake backend)', () => {
  it('starts game 2 clean, never repeats a song, and survives a host refresh and a phone rejoin', async () => {
    const fake = createFakeBackend();
    const hostKv = memoryKV();
    const creds: StoredHost = await createHostRoom(fake, hostKv, 'timeline');
    let host = new HostSession(fake, creds);
    const kvs: KV[] = NAMES.map(() => memoryKV());
    const phones: PhoneSession[] = [];
    for (const [i, name] of NAMES.entries()) {
      const j = await joinGame(fake, kvs[i], { code: creds.code, name });
      if (!j.ok) throw new Error('join failed');
      const p = await startPhoneSession(fake, j.seat);
      open.push(p);
      phones.push(p);
    }
    const ids = phones.map((p) => p.seat.playerId);
    const mk = (h: HostSession) => new TimelineGame({ session: h, pool: POOL, rng: seededRng(5), now: () => Date.UTC(2026, 0, 1) });
    let game = mk(host);
    const seen: string[] = [];

    /** One round: Ana places right, the others lock in with no answer. Returns the song. */
    async function round(g: TimelineGame, ps: PhoneSession[]): Promise<GameSong> {
      const next = await g.nextRound();
      if (next.status !== 'started') throw new Error('expected a round');
      expect(seen).not.toContain(next.songId);
      seen.push(next.songId);
      const song = byId.get(next.songId)!;
      for (const [i, p] of ps.entries()) {
        const mine = (await p.state())!;
        const slot = i === 0 ? rightSlot(mine.player.timeline, song.year) : null;
        expect((await sendTimelineAnswer(p, next.roundId, { slot, artist: '', lock: true })).ok).toBe(true);
      }
      expect(await g.checkAutoEnd()).not.toBeNull();
      return song;
    }

    // ---- Game 1, played to a winner.
    await game.begin();
    const game1Titles: string[] = [];
    while ((await host.state()).room.status !== 'over') {
      game1Titles.push((await round(game, phones)).title);
      if (seen.length > 20) throw new Error('game 1 did not end');
    }
    let s = await host.state();
    expect(winnerOf(s.room.settings)?.winnerId).toBe(ids[0]);
    expect(s.players[0].timeline.length).toBeGreaterThanOrEqual(12);
    const game1Round = s.round!.id;
    const game1Seen = [...seen];

    // ---- Play again: same room, same seats, nothing left over.
    await game.playAgain();
    s = await host.state();
    expect(s.room).toMatchObject({ game_no: 2, status: 'playing', round_no: 0 });
    expect(winnerOf(s.room.settings)).toBeNull();
    expect(s.room.settings.roundsPlayed).toBe(0);
    expect(s.round).toBeNull();
    expect(s.answers).toEqual([]);
    expect(s.locked_player_ids).toEqual([]);
    expect(s.players.map((p) => p.id).sort()).toEqual([...ids].sort()); // same seats
    expect(s.players.map((p) => p.name).sort()).toEqual([...NAMES].sort());
    expect(s.players.every((p) => p.score === 0 && p.artist_hits === 0 && p.timeline.length === 2)).toBe(true);
    expect(s.played_this_game).toEqual([]);
    expect(s.played_earlier.sort()).toEqual([...game1Seen].sort()); // history carries over

    // No old results anywhere a phone or watcher can read, and the phones show a clean start.
    const snap = fake.publicSnapshot();
    for (const t of game1Titles) expect(snap).not.toContain(t);
    expect(snap).not.toContain(game1Round);
    expect((await loadPublicState(fake, creds.roomId))).toMatchObject({ round: null, locked: [] });
    for (const p of phones) {
      const mine = (await p.state())!;
      expect(mine.round).toBeNull();
      expect(mine.answer).toBeNull();
      expect(mine.player).toMatchObject({ score: 0, artist_hits: 0 });
      expect(mine.player.timeline).toHaveLength(2);
      expect(timelinePhoneView(mine).stage).toBe('waiting');
    }

    // ---- Game 2: a round, then a host refresh, then a phone rejoin, then another round.
    await round(game, phones);
    s = await host.state();
    expect(s.round).toMatchObject({ game_no: 2, round_no: 1, status: 'revealed' });
    expect(s.players[0].timeline).toHaveLength(3);

    host = new HostSession(fake, creds); // host page refreshed: same credentials, new objects
    game = mk(host);
    const again = await host.state();
    expect(again.room).toMatchObject({ game_no: 2, status: 'playing' });
    expect(again.players.map((p) => p.timeline.length)).toEqual([3, 2, 2]);
    await round(game, phones);

    await phones[1].stop(); // Bo's phone refreshes: stops, then resumes from the saved seat
    const back = await resumeSeat(fake, kvs[1]);
    expect(back?.seat.playerId).toBe(ids[1]);
    expect(back!.state.player.timeline).toHaveLength(2);
    expect(back!.state.round).toMatchObject({ game_no: 2, round_no: 2 });
    const rejoined = await joinGame(fake, kvs[1], { code: creds.code, name: NAMES[1] });
    expect(rejoined).toMatchObject({ ok: true });
    const bo = await startPhoneSession(fake, back!.seat);
    open.push(bo);
    phones[1] = bo;
    await round(game, phones);

    s = await host.state();
    expect(s.room.game_no).toBe(2);
    expect(s.round).toMatchObject({ game_no: 2, round_no: 3 });
    expect(new Set(seen).size).toBe(seen.length); // no song twice, across both games
  });
});
