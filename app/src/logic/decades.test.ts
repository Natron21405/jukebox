import { describe, expect, it } from 'vitest';
import { ALL_DECADES, chooseNextSong, chosenDecades, countByDecade, decadeOf, seededRng, toggleDecade } from '.';

describe('decades', () => {
  it('maps a year to its decade', () => {
    expect(decadeOf(1999)).toBe(1990);
    expect(decadeOf(2000)).toBe(2000);
  });
  it('defaults to every decade when nothing usable is stored', () => {
    expect(chosenDecades(undefined)).toEqual(ALL_DECADES);
    expect(chosenDecades({ decades: 'x' })).toEqual(ALL_DECADES);
    expect(chosenDecades({ decades: [] })).toEqual(ALL_DECADES);
    expect(chosenDecades({ decades: [1234] })).toEqual(ALL_DECADES);
  });
  it('keeps only known decades, in order', () => {
    expect(chosenDecades({ decades: [2000, 1980, 1234] })).toEqual([1980, 2000]);
  });
  it('toggles on and off but never empties the list', () => {
    expect(toggleDecade([1980, 2000], 1990)).toEqual([1980, 1990, 2000]);
    expect(toggleDecade([1980, 1990], 1990)).toEqual([1980]);
    expect(toggleDecade([1980], 1980)).toEqual([1980]);
    expect(toggleDecade([1980], 1234)).toEqual([1980]);
  });
  it('counts songs per decade', () => {
    const c = countByDecade([{ year: 1981 }, { year: 1989 }, { year: 2003 }]);
    expect(c[1980]).toBe(2);
    expect(c[2000]).toBe(1);
    expect(c[1950]).toBe(0);
  });
  it('only picks songs from the chosen decades', () => {
    const pool = [
      { id: 'a', year: 1975 }, { id: 'b', year: 1985 }, { id: 'c', year: 1995 }, { id: 'd', year: 1999 },
    ];
    const rng = seededRng(3);
    const seen = new Set<string>();
    const played: string[] = [];
    for (let i = 0; i < 2; i++) {
      const r = chooseNextSong(pool, { playedThisGame: played, decades: [1990] }, rng);
      expect(r.status).toBe('ok');
      if (r.status === 'ok') { seen.add(r.song.id); played.push(r.song.id); }
    }
    expect([...seen].sort()).toEqual(['c', 'd']);
    const done = chooseNextSong(pool, { playedThisGame: played, decades: [1990] }, rng);
    expect(done.status).toBe('exhausted');
  });
});
