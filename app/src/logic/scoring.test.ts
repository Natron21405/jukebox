import { describe, expect, it } from 'vitest';
import { artistPoints, closestYearPoints, scoreClosestYearRound } from './scoring';

describe('Closest Year points table', () => {
  const rows: Array<[number, number]> = [
    [0, 5], [1, 3], [2, 2], [3, 2], [4, 1], [5, 1], [6, 0], [7, 0], [30, 0],
  ];
  it.each(rows)('distance %i -> %i points (both directions)', (d, pts) => {
    expect(closestYearPoints(1990 + d, 1990)).toBe(pts);
    expect(closestYearPoints(1990 - d, 1990)).toBe(pts);
  });
  it('no guess scores nothing', () => {
    expect(closestYearPoints(null, 1990)).toBe(0);
    expect(closestYearPoints(undefined, 1990)).toBe(0);
  });
});

describe('artist bonus', () => {
  it('is 2 for a hit and 0 otherwise', () => {
    expect(artistPoints(true)).toBe(2);
    expect(artistPoints(false)).toBe(0);
  });
  it('adds to the year points, and counts even with no year guess', () => {
    expect(scoreClosestYearRound(1990, 1990, true)).toEqual({ distance: 0, yearPoints: 5, artistPoints: 2, total: 7 });
    expect(scoreClosestYearRound(1995, 1990, false).total).toBe(1);
    expect(scoreClosestYearRound(1999, 1990, true).total).toBe(2);
    expect(scoreClosestYearRound(null, 1990, true)).toEqual({ distance: null, yearPoints: 0, artistPoints: 2, total: 2 });
  });
});
