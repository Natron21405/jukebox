import { afterEach, describe, expect, it } from 'vitest';
import { seededRng, type GameSong } from '../logic';
import {
  HostSession, createFakeBackend, createHostRoom, joinGame, memoryKV, startPhoneSession, type FakeBackend, type PhoneSession,
} from '../net';
import { ClosestYearGame, type NextRound } from './closestYear';

// Made-up songs only.
const POOL: GameSong[] = Array.from({ length: 12 }, (_, n) => ({
  id: `h-${String(n).padStart(2, '0')}`, title: `Pretend Tune ${n}`, artists: [`Imaginary Act ${n}`], featuredArtists: [], year: 1970 + n,
}));
const ALL = POOL.map((s) => s.id);

const open: PhoneSession[] = [];
afterEach(async () => { while (open.length) await open.pop()!.stop(); });

async function rig(pool: GameSong[] = POOL) {
  const fake: FakeBackend = createFakeBackend();
  const creds = await createHostRoom(fake, 'closest_year');
  const host = new HostSession(fake, creds);
  for (const name of ['Ana', 'Bo']) {
    const j = await joinGame(fake, memoryKV(), { code: creds.code, name });
    if (!j.ok) throw new Error('join failed');
    const p = await startPhoneSession(fake, j.seat);
    open.push(p);
  }
  const base = Date.UTC(2026, 0, 1);
  const game = new ClosestYearGame({ session: host, pool, rng: seededRng(3), now: () => base });
  return { fake, host, game };
}

/** Plays n songs in the current game (dead-clip skips: they still count as played). Returns the song ids. */
async function playSongs(game: ClosestYearGame, n: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const r: NextRound = await game.nextRound();
    if (r.status !== 'started') throw new Error(`expected a round, got ${r.status}`);
    ids.push(r.songId);
    await game.skipRound();
  }
  return ids;
}

describe('no repeats across games on one device group', () => {
  it('two consecutive games (same room, same players) never repeat a song, and the pool then runs out', async () => {
    const { host, game } = await rig();
    await game.begin();
    const g1 = await playSongs(game, 5);
    await game.playAgain();
    expect((await host.state()).room.game_no).toBe(2);
    const g2 = await playSongs(game, 5);

    expect(new Set(g1).size).toBe(5);
    expect(g2.filter((id) => g1.includes(id))).toEqual([]);
    const s = await host.state();
    expect([...s.played_this_game].sort()).toEqual([...g2].sort());
    expect([...s.played_earlier].sort()).toEqual([...g1].sort());

    // Game 3 can only use the 2 songs nobody has heard.
    await game.playAgain();
    const g3 = await playSongs(game, 2);
    expect([...g3, ...g1, ...g2].sort()).toEqual([...ALL].sort());
    const out = await game.nextRound();
    expect(out).toEqual({ status: 'exhausted', resetWouldHelp: true });
  });

  it('keeps remembering across a lobby round trip (history lives in the database, not the page)', async () => {
    const { host, game } = await rig();
    await game.begin();
    const g1 = await playSongs(game, 3);
    await host.updateRoom({ status: 'lobby' });
    await game.playAgain();
    const g2 = await playSongs(game, 3);
    expect(g2.filter((id) => g1.includes(id))).toEqual([]);
  });
});

describe('reset played songs', () => {
  it('makes earlier games available again but never repeats a song inside the current game', async () => {
    const { host, game } = await rig();
    await game.begin();
    const g1 = await playSongs(game, 6);
    await game.playAgain();
    const g2 = await playSongs(game, 6);
    expect(await game.nextRound()).toEqual({ status: 'exhausted', resetWouldHelp: true });

    const removed = await host.resetPlayed();
    expect(removed).toBe(g1.length);
    const s = await host.state();
    expect(s.played_earlier).toEqual([]);
    expect([...s.played_this_game].sort()).toEqual([...g2].sort());

    // The 6 from this game stay out; the next 6 all come from the first game's songs.
    const more = await playSongs(game, 6);
    expect([...more].sort()).toEqual([...g1].sort());
    expect(await game.nextRound()).toEqual({ status: 'exhausted', resetWouldHelp: false });
  });

  it('does not touch the blocklist', async () => {
    const { host, game } = await rig();
    await game.begin();
    await host.blockSong('h-03');
    await host.resetPlayed();
    expect((await host.state()).blocked).toEqual(['h-03']);
  });
});

describe('blocklist', () => {
  it('a blocked song is never picked, this game or the next; restoring it brings it back', async () => {
    const { host, game } = await rig();
    await game.begin();
    await host.blockSong('h-00');
    await host.blockSong('h-00'); // blocking twice is harmless
    expect((await host.state()).blocked).toEqual(['h-00']);

    const g1 = await playSongs(game, 5);
    await game.playAgain();
    const g2 = await playSongs(game, 6); // 11 songs are playable, so 6 more exist
    expect([...g1, ...g2]).not.toContain('h-00');

    await host.unblockSong('h-00');
    expect((await host.state()).blocked).toEqual([]);
    const last = await playSongs(game, 1);
    expect(last).toEqual(['h-00']);
  });

  it('blocking the song on the reveal does not change that round\'s scoring', async () => {
    const { host, game } = await rig();
    await game.begin();
    const r = await game.nextRound();
    if (r.status !== 'started') throw new Error('expected a round');
    await host.blockSong(r.songId);
    const rv = await game.endRound();
    expect(rv?.song.id).toBe(r.songId);
    expect((await host.state()).round?.status).toBe('revealed');
  });

  it('reports exhausted with no reset offer when everything left is blocked, and recovers after a restore', async () => {
    const { host, game } = await rig();
    await game.begin();
    for (const id of ALL) await host.blockSong(id);
    expect(await game.nextRound()).toEqual({ status: 'exhausted', resetWouldHelp: false });
    await host.unblockSong('h-07');
    const r = await game.nextRound();
    expect(r.status === 'started' && r.songId).toBe('h-07');
  });
});

describe('pool exhaustion', () => {
  it('a reset does not help when the pool is simply used up inside one game', async () => {
    const { game } = await rig(POOL.slice(0, 3));
    await game.begin();
    await playSongs(game, 3);
    expect(await game.nextRound()).toEqual({ status: 'exhausted', resetWouldHelp: false });
  });
});
