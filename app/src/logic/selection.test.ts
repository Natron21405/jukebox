import { describe, expect, it } from 'vitest';
import { seededRng } from './rng';
import { availableSongs, chooseNextSong, type PoolSong } from './selection';

const pool: PoolSong[] = Array.from({ length: 30 }, (_, i) => ({ id: `t-${String(i).padStart(3, '0')}`, year: 1960 + i * 2 }));

describe('song selection', () => {
  it('never repeats within a game and finishes with exhausted', () => {
    const played = new Set<string>();
    const rng = seededRng(42);
    for (let i = 0; i < pool.length; i++) {
      const r = chooseNextSong(pool, { playedThisGame: played }, rng);
      expect(r.status).toBe('ok');
      if (r.status !== 'ok') return;
      expect(played.has(r.song.id)).toBe(false);
      expect(r.remaining).toBe(pool.length - i - 1);
      played.add(r.song.id);
    }
    expect(played.size).toBe(pool.length);
    expect(chooseNextSong(pool, { playedThisGame: played }, rng)).toEqual({ status: 'exhausted', resetWouldHelp: false });
  });
  it('skips songs from earlier games and blocked songs, across many seeds', () => {
    const earlier = pool.slice(0, 10).map((s) => s.id);
    const blocked = pool.slice(10, 20).map((s) => s.id);
    const thisGame = [pool[20].id];
    for (let seed = 1; seed <= 200; seed++) {
      const r = chooseNextSong(pool, { playedThisGame: thisGame, playedEarlier: earlier, blocked }, seededRng(seed));
      expect(r.status).toBe('ok');
      if (r.status === 'ok') {
        expect([...earlier, ...blocked, ...thisGame]).not.toContain(r.song.id);
        expect(r.remaining).toBe(8);
      }
    }
  });
  it('reports exhausted, and that a reset would help when earlier-game history is what blocks', () => {
    const r = chooseNextSong(pool, { playedThisGame: [], playedEarlier: pool.map((s) => s.id) }, seededRng(1));
    expect(r).toEqual({ status: 'exhausted', resetWouldHelp: true });
  });
  it('reset does not help when the rest is blocked or played this game', () => {
    const half = pool.length / 2;
    const r = chooseNextSong(
      pool,
      {
        playedThisGame: pool.slice(0, half).map((s) => s.id),
        blocked: pool.slice(half).map((s) => s.id),
        playedEarlier: [],
      },
      seededRng(1),
    );
    expect(r).toEqual({ status: 'exhausted', resetWouldHelp: false });
  });
  it('an empty pool is exhausted', () => {
    expect(chooseNextSong([], { playedThisGame: [] }, seededRng(1))).toEqual({ status: 'exhausted', resetWouldHelp: false });
  });
  it('honours the year range filter', () => {
    const yearRange = { min: 1980, max: 1990 };
    for (let seed = 1; seed <= 100; seed++) {
      const r = chooseNextSong(pool, { playedThisGame: [], yearRange }, seededRng(seed));
      expect(r.status).toBe('ok');
      if (r.status === 'ok') {
        expect(r.song.year).toBeGreaterThanOrEqual(1980);
        expect(r.song.year).toBeLessThanOrEqual(1990);
      }
    }
    expect(chooseNextSong(pool, { playedThisGame: [], yearRange: { min: 2100, max: 2200 } }, seededRng(1)).status).toBe('exhausted');
  });
  it('rng at the top of its range still picks a valid song', () => {
    const r = chooseNextSong(pool, { playedThisGame: [] }, () => 0.9999999);
    expect(r.status).toBe('ok');
  });
  it('availableSongs lists exactly the pickable songs', () => {
    const a = availableSongs(pool, { playedThisGame: [pool[0].id], playedEarlier: [pool[1].id], blocked: [pool[2].id] });
    expect(a.map((s) => s.id)).not.toContain(pool[0].id);
    expect(a).toHaveLength(pool.length - 3);
  });
});
