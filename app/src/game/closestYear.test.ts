import { afterEach, describe, expect, it } from 'vitest';
import { CONFIG, seededRng, type GameSong } from '../logic';
import {
  HostSession, createFakeBackend, createHostRoom, joinGame, memoryKV, startPhoneSession,
  type FakeBackend, type PhoneSession,
} from '../net';
import { ClosestYearGame, gamePhase, suddenDeathContenders, winnerOf, type ClosestYearReveal } from './closestYear';
import { phoneView, sendAnswer } from './phone';

// Made-up songs only. Year of song n is 1960 + (n % 50); the artist name is unique per song.
const POOL: GameSong[] = Array.from({ length: 60 }, (_, n) => ({
  id: `t-${String(n).padStart(3, '0')}`,
  title: `Invented Title ${n}`,
  artists: [`Quorblat Ensemble ${n}`],
  featuredArtists: [`Gleep Guest ${n}`],
  year: 1960 + (n % 50),
}));
const byId = new Map(POOL.map((s) => [s.id, s]));

// Hand-written points for a year miss of 0..6 (the CONFIG table: 5 / 3 / 2 / 1, then 0), kept apart from the scorer.
const HAND_POINTS = [5, 3, 2, 2, 1, 1, 0];
const P4_OFFSETS = [0, 1, 2, 4, 5, 6];

interface Rig {
  fake: FakeBackend;
  host: HostSession;
  game: ClosestYearGame;
  phones: PhoneSession[];
  ids: string[];
  elapsed: () => number;
  tick: (ms: number) => void;
}

const open: PhoneSession[] = [];
afterEach(async () => { while (open.length) await open.pop()!.stop(); });

async function rig(): Promise<Rig> {
  const fake = createFakeBackend();
  const creds = await createHostRoom(fake, memoryKV(), 'closest_year');
  const host = new HostSession(fake, creds);
  const phones: PhoneSession[] = [];
  for (const name of ['Ana', 'Bo', 'Cy', 'Di']) {
    const j = await joinGame(fake, memoryKV(), { code: creds.code, name });
    if (!j.ok) throw new Error('join failed');
    const p = await startPhoneSession(fake, j.seat);
    phones.push(p); open.push(p);
  }
  let elapsed = 0;
  const base = Date.UTC(2026, 0, 1);
  const game = new ClosestYearGame({ session: host, pool: POOL, rng: seededRng(7), now: () => base + elapsed });
  return {
    fake, host, game, phones, ids: phones.map((p) => p.seat.playerId),
    elapsed: () => elapsed, tick: (ms) => { elapsed += ms; fake.advance(ms); },
  };
}

const scoresOf = async (r: Rig) => Object.fromEntries((await r.host.state()).players.map((p) => [p.name, p.score]));

describe('Closest Year over the fake net', () => {
  it('plays a full 15-round game with hand-computed scores, early finish, timer, override, skip, no repeats and no spoilers', async () => {
    const r = await rig();
    await r.game.begin();
    const seen: string[] = [];
    let normalRounds = 0;
    let skipped = 0;

    while (normalRounds < 15) {
      const next = await r.game.nextRound();
      if (next.status !== 'started') throw new Error('expected a round');
      seen.push(next.songId);
      const song = byId.get(next.songId)!;

      // Before the reveal nothing a phone can read holds the song or any typed guess.
      const snap = r.fake.publicSnapshot();
      for (const secret of [song.id, song.title, song.artists[0], song.featuredArtists[0]]) expect(snap).not.toContain(secret);
      for (const p of r.phones) {
        const mine = JSON.stringify(await p.state());
        for (const secret of [song.id, song.title, song.artists[0]]) expect(mine).not.toContain(secret);
        expect(phoneView((await p.state())!).stage).toBe('answer');
      }

      // The very first song has a dead preview: skipped, not a round, never repeats.
      if (seen.length === 1) {
        expect(await r.game.skipRound()).toBe(true);
        skipped += 1;
        expect(gamePhase(await r.host.state())).toBe('between');
        continue;
      }

      normalRounds += 1;
      const n = normalRounds;
      const off = P4_OFFSETS[(n - 1) % P4_OFFSETS.length];
      const y = song.year;
      const typedFor = [song.artists[0], n === 2 ? 'Something Else Entirely' : '', 'Wrong Band', n % 2 === 1 ? song.artists[0] : song.featuredArtists[0]];
      const years = [y, y + 1, y - 3, y + off];
      const lockAll = n !== 5; // round 5: Cy never locks in, so only the timer can end it

      for (let i = 0; i < 4; i++) {
        const stage = i === 2 && !lockAll ? false : true;
        const res = await sendAnswer(r.phones[i], next.roundId, { year: years[i], artist: typedFor[i], lock: stage });
        expect(res.ok).toBe(true);
        if (i < 3) expect(await r.game.checkAutoEnd()).toBeNull(); // not everyone yet
      }

      let reveal: ClosestYearReveal | null;
      if (lockAll) {
        reveal = await r.game.checkAutoEnd(); // fourth lock-in: early finish
        expect(reveal).not.toBeNull();
      } else {
        expect(await r.game.checkAutoEnd()).toBeNull();
        r.tick(CONFIG.roundSeconds * 1000 - 1);
        expect(await r.game.checkAutoEnd()).toBeNull();
        r.tick(2);
        reveal = await r.game.checkAutoEnd();
        expect(reveal).not.toBeNull();
      }
      expect(await r.game.checkAutoEnd()).toBeNull(); // already over: nothing happens twice
      const rv = reveal!;

      // Per-player points for this round, worked out by hand.
      const artistBonus = [2, 0, 0, n % 2 === 1 ? 2 : 0];
      const yearPts = [5, 3, 2, HAND_POINTS[off]];
      expect(rv.rows.map((x) => x.total)).toEqual(yearPts.map((p, i) => p + artistBonus[i]));
      expect(rv.song.id).toBe(song.id);
      expect(rv.roundsPlayed).toBe(n);

      // After the reveal phones can see the answer and their own line.
      expect((await r.phones[0].state())!.round!.reveal).not.toBeNull();
      expect(phoneView((await r.phones[1].state())!).mine?.total).toBe(rv.rows[1].total);

      // Round 2: the matcher rejects Bo's guess; the host accepts it (+2 for Bo, one more artist hit).
      if (n === 2) {
        const before = await scoresOf(r);
        const fixed = await r.game.setArtistOverride(r.ids[1], true);
        expect(fixed!.rows[1]).toMatchObject({ autoMatched: false, override: true, artistHit: true, total: 5 });
        expect((await scoresOf(r)).Bo).toBe(before.Bo + 2);
      }
      if (n < 15) expect(rv.outcome.status).toBe('continue');
    }

    // Final tallies. Ana 15*(5+2); Bo 15*3 + 2 override; Cy 15*2; Di: two cycles of 12 + (5+3+2), plus 2 on the 8 odd rounds.
    const final = await scoresOf(r);
    expect(final).toEqual({ Ana: 105, Bo: 47, Cy: 30, Di: 34 + 16 });
    const s = await r.host.state();
    expect(s.players.map((p) => p.artist_hits)).toEqual([15, 1, 0, 8]);
    expect(s.room.status).toBe('over');
    expect(winnerOf(s.room.settings)).toEqual({ winnerId: r.ids[0], decidedBy: 'score' });
    expect(gamePhase(s)).toBe('over');
    expect(phoneView((await r.phones[3].state())!).over).toBe(true);

    // History: every song played, the skipped one included, once each.
    expect(seen).toHaveLength(16);
    expect(new Set(seen).size).toBe(16);
    expect(skipped).toBe(1);
    expect([...s.played_this_game].sort()).toEqual([...seen].sort());
    expect((await r.game.nextRound()).status).toBe('not-now');
  });

  it('sends a tie among the top players to sudden death and ends with a single winner, then plays again without repeats', async () => {
    const r = await rig();
    await r.game.begin();
    const seen: string[] = [];

    // 15 rounds: Ana and Bo always exact (5 each), Cy and Di always far off (0).
    for (let n = 1; n <= 15; n++) {
      const next = await r.game.nextRound();
      if (next.status !== 'started') throw new Error('expected a round');
      seen.push(next.songId);
      const y = byId.get(next.songId)!.year;
      const guesses = [y, y, y + 9, y - 9];
      for (let i = 0; i < 4; i++) await sendAnswer(r.phones[i], next.roundId, { year: guesses[i], artist: '', lock: true });
      const rv = await r.game.checkAutoEnd();
      expect(rv!.rows.map((x) => x.total)).toEqual([5, 5, 0, 0]);
    }
    let s = await r.host.state();
    expect(s.players.map((p) => p.score)).toEqual([75, 75, 0, 0]);
    expect(s.room.status).toBe('playing');
    expect(suddenDeathContenders(s.room.settings).sort()).toEqual([r.ids[0], r.ids[1]].sort());
    expect(winnerOf(s.room.settings)).toBeNull();

    // Sudden death 1: both exact, still tied. Only the two contenders are waited for; the others just watch.
    // Sudden death 2: Ana exact, Bo two years off. Ana wins.
    const sdGuess = [[0, 0], [0, 2]];
    for (let k = 0; k < 2; k++) {
      const next = await r.game.nextRound();
      if (next.status !== 'started') throw new Error('expected a round');
      expect(next.kind).toBe('sudden_death');
      seen.push(next.songId);
      const y = byId.get(next.songId)!.year;
      expect(phoneView((await r.phones[2].state())!).stage).toBe('watching');
      expect(phoneView((await r.phones[3].state())!).stage).toBe('watching');
      expect(phoneView((await r.phones[0].state())!).stage).toBe('answer');
      await sendAnswer(r.phones[0], next.roundId, { year: y + sdGuess[k][0], artist: '', lock: true });
      expect(await r.game.checkAutoEnd()).toBeNull();
      await sendAnswer(r.phones[1], next.roundId, { year: y + sdGuess[k][1], artist: '', lock: true });
      const rv = await r.game.checkAutoEnd(); // Cy and Di never answered, and are not waited for
      expect(rv!.kind).toBe('sudden_death');
      expect(rv!.rows).toHaveLength(2);
      expect(rv!.roundsPlayed).toBe(15);
      expect(rv!.outcome.status).toBe(k === 0 ? 'suddenDeath' : 'winner');
      expect(rv!.rows.every((x) => x.total === 0)).toBe(true);
    }
    s = await r.host.state();
    expect(s.players.map((p) => p.score)).toEqual([75, 75, 0, 0]); // sudden death does not score
    expect(s.room.status).toBe('over');
    expect(winnerOf(s.room.settings)).toEqual({ winnerId: r.ids[0], decidedBy: 'suddenDeath' });
    expect(new Set(seen).size).toBe(17);
    expect((await r.game.nextRound()).status).toBe('not-now');

    // Play again: scores back to zero, and none of those 17 songs is picked again.
    await r.game.playAgain();
    s = await r.host.state();
    expect(s.players.map((p) => p.score)).toEqual([0, 0, 0, 0]);
    expect(s.room.status).toBe('playing');
    expect(winnerOf(s.room.settings)).toBeNull();
    for (let n = 1; n <= 15; n++) {
      const next = await r.game.nextRound();
      if (next.status !== 'started') throw new Error('expected a round');
      expect(seen).not.toContain(next.songId);
      seen.push(next.songId);
      for (let i = 0; i < 4; i++) await sendAnswer(r.phones[i], next.roundId, { year: 1900, artist: '', lock: true });
      expect(await r.game.checkAutoEnd()).not.toBeNull();
    }
    expect(new Set(seen).size).toBe(32);
    // Nobody scored in the second game: a four-way tie goes to sudden death among all four.
    s = await r.host.state();
    expect(suddenDeathContenders(s.room.settings)).toHaveLength(4);
  });

  it('ignores a disconnected player when deciding everyone has answered, and can be resumed by a fresh controller', async () => {
    const r = await rig();
    await r.game.begin();
    await r.phones[3].stop();
    const next = await r.game.nextRound();
    if (next.status !== 'started') throw new Error('expected a round');
    for (let i = 0; i < 3; i++) await sendAnswer(r.phones[i], next.roundId, { year: 1990, artist: '', lock: true });
    // A brand-new controller (as after a host refresh) reads everything from the room and finishes the round.
    const again = new ClosestYearGame({ session: r.host, pool: POOL, rng: seededRng(99), now: () => Date.UTC(2026, 0, 1) + r.elapsed() });
    const rv = await again.checkAutoEnd();
    expect(rv).not.toBeNull();
    expect(rv!.rows).toHaveLength(4);
    expect(rv!.rows[3].year).toBeNull();
    expect(rv!.roundsPlayed).toBe(1);
    expect(ClosestYearGame.progress(await r.host.state()).expected).toBe(3);
  });

  it('reports exhaustion when the pool runs out', async () => {
    const r = await rig();
    const small = new ClosestYearGame({ session: r.host, pool: POOL.slice(0, 2), rng: seededRng(1) });
    await small.begin();
    for (let i = 0; i < 2; i++) {
      const n = await small.nextRound();
      if (n.status !== 'started') throw new Error('expected a round');
      await small.skipRound();
    }
    expect(await small.nextRound()).toEqual({ status: 'exhausted', resetWouldHelp: false });
  });
});
