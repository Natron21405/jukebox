import { describe, expect, it } from 'vitest';
import { CONFIG } from './config';
import { seededRng } from './rng';
import {
  applyPlacement,
  dealStartingHands,
  drawStartingCards,
  isPlacementCorrect,
  pairKey,
  startingPairKey,
  type Card,
} from './timeline';

const tl = (...years: number[]): Card[] => years.map((year) => ({ year }));

describe('starting cards', () => {
  it('are two different years inside the range, sorted, year-only', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const cards = drawStartingCards(seededRng(seed));
      expect(cards).toHaveLength(CONFIG.timeline.startingCards);
      expect(cards[0].year).toBeLessThan(cards[1].year);
      for (const c of cards) {
        expect(c.year).toBeGreaterThanOrEqual(CONFIG.timeline.startYearMin);
        expect(c.year).toBeLessThanOrEqual(CONFIG.timeline.startYearMax);
        expect(c.songId).toBeUndefined();
        expect(c.starter).toBe(true);
      }
    }
  });
  it('are distinct pairs across all players at max size, over many seeds', () => {
    const ids = Array.from({ length: CONFIG.maxPlayers }, (_, i) => `p${i}`);
    for (let seed = 1; seed <= 200; seed++) {
      const hands = dealStartingHands(ids, seededRng(seed));
      const keys = new Set(ids.map((id) => startingPairKey(hands[id])));
      expect(keys.size).toBe(ids.length);
    }
  });
  it('late joiners avoid pairs already held', () => {
    const rng = seededRng(7);
    const hands = dealStartingHands(['a', 'b', 'c'], rng);
    const used = new Set(Object.values(hands).map((h) => startingPairKey(h)!));
    for (let i = 0; i < 100; i++) {
      const c = drawStartingCards(rng, used);
      expect(used.has(pairKey(c[0].year, c[1].year))).toBe(false);
    }
  });
  it('still deals when every pair is taken (repeats allowed only then)', () => {
    const { startYearMin: lo, startYearMax: hi } = CONFIG.timeline;
    const all = new Set<string>();
    for (let a = lo; a <= hi; a++) for (let b = a + 1; b <= hi; b++) all.add(pairKey(a, b));
    const c = drawStartingCards(seededRng(3), all);
    expect(c).toHaveLength(2);
    expect(c[0].year).not.toBe(c[1].year);
  });
  it('gives different years even with the tightest free pair set', () => {
    const { startYearMin: lo, startYearMax: hi } = CONFIG.timeline;
    const all = new Set<string>();
    for (let a = lo; a <= hi; a++) for (let b = a + 1; b <= hi; b++) all.add(pairKey(a, b));
    all.delete(pairKey(1990, 1991));
    const c = drawStartingCards(seededRng(9), all);
    expect([c[0].year, c[1].year]).toEqual([1990, 1991]);
  });
});

describe('placement validity', () => {
  const t = tl(1980, 1990, 2000);
  it('accepts years in the right gap for every slot', () => {
    expect(isPlacementCorrect(t, 0, 1975)).toBe(true);
    expect(isPlacementCorrect(t, 1, 1985)).toBe(true);
    expect(isPlacementCorrect(t, 2, 1995)).toBe(true);
    expect(isPlacementCorrect(t, 3, 2010)).toBe(true);
  });
  it('rejects years in the wrong gap', () => {
    expect(isPlacementCorrect(t, 0, 1985)).toBe(false);
    expect(isPlacementCorrect(t, 1, 1975)).toBe(false);
    expect(isPlacementCorrect(t, 1, 1995)).toBe(false);
    expect(isPlacementCorrect(t, 3, 1995)).toBe(false);
  });
  it('equal years are always fine on either side', () => {
    expect(isPlacementCorrect(t, 0, 1980)).toBe(true); // before an equal card
    expect(isPlacementCorrect(t, 1, 1980)).toBe(true); // after an equal card
    expect(isPlacementCorrect(t, 1, 1990)).toBe(true);
    expect(isPlacementCorrect(t, 2, 1990)).toBe(true);
    expect(isPlacementCorrect(t, 2, 2000)).toBe(true);
    expect(isPlacementCorrect(t, 3, 2000)).toBe(true);
    const dup = tl(1990, 1990);
    for (const slot of [0, 1, 2]) expect(isPlacementCorrect(dup, slot, 1990)).toBe(true);
  });
  it('a missing or out-of-range slot is not correct', () => {
    expect(isPlacementCorrect(t, null, 1985)).toBe(false);
    expect(isPlacementCorrect(t, undefined, 1985)).toBe(false);
    expect(isPlacementCorrect(t, -1, 1985)).toBe(false);
    expect(isPlacementCorrect(t, 4, 1985)).toBe(false);
    expect(isPlacementCorrect(t, 1.5, 1985)).toBe(false);
  });
  it('works on an empty timeline', () => {
    expect(isPlacementCorrect([], 0, 1999)).toBe(true);
  });
});

describe('awarding cards', () => {
  const start = tl(1980, 2000);
  it('correct placement inserts the card at the slot, keeping order', () => {
    const r = applyPlacement(start, 1, { id: 's-1', year: 1990 });
    expect(r.correct).toBe(true);
    expect(r.timeline.map((c) => c.year)).toEqual([1980, 1990, 2000]);
    expect(r.timeline[1].songId).toBe('s-1');
    expect(start).toHaveLength(2); // input not mutated
  });
  it('equal-year insert on either side stays sorted', () => {
    const a = applyPlacement(start, 0, { id: 's-2', year: 1980 });
    const b = applyPlacement(start, 1, { id: 's-3', year: 1980 });
    for (const r of [a, b]) {
      expect(r.correct).toBe(true);
      expect(r.timeline.map((c) => c.year)).toEqual([1980, 1980, 2000]);
    }
  });
  it('wrong placement adds nothing and costs nothing', () => {
    const before = tl(1980, 1995, 2000);
    const r = applyPlacement(before, 0, { id: 's-4', year: 1999 });
    expect(r.correct).toBe(false);
    expect(r.timeline).toEqual(before);
    expect(r.timeline).toHaveLength(3);
  });
  it('no answer adds nothing and costs nothing', () => {
    const r = applyPlacement(start, null, { id: 's-5', year: 1990 });
    expect(r.correct).toBe(false);
    expect(r.timeline).toEqual(start);
  });
  it('a long run of correct placements grows by exactly one each time', () => {
    let t: Card[] = start;
    for (let i = 0; i < 10; i++) {
      const year = 1981 + i;
      t = applyPlacement(t, t.findIndex((c) => c.year > year) === -1 ? t.length : t.findIndex((c) => c.year > year), {
        id: `s-${i}`,
        year,
      }).timeline;
    }
    expect(t).toHaveLength(12);
    expect(t.map((c) => c.year)).toEqual([...t.map((c) => c.year)].sort((x, y) => x - y));
  });
});
