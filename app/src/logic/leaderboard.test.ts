import { describe, expect, it } from 'vitest';
import { ordinal, rankBoard, rankOf, topBoard } from './leaderboard';

const p = (id: string, total: number, hits?: number) => ({ id, name: id.toUpperCase(), total, hits });

describe('leaderboard ordering', () => {
  it('Closest Year: most points first', () => {
    expect(rankBoard('closestYear', [p('a', 3), p('b', 9), p('c', 5)]).map((r) => [r.id, r.rank])).toEqual([['b', 1], ['c', 2], ['a', 3]]);
  });
  it('Closest Year ignores any hits count', () => {
    const r = rankBoard('closestYear', [p('a', 5, 9), p('b', 5, 0)]);
    expect(r.map((x) => x.rank)).toEqual([1, 1]);
  });
  it('Timeline: more cards first, then more artists guessed right', () => {
    const r = rankBoard('timeline', [p('a', 6, 1), p('b', 6, 4), p('c', 7, 0), p('d', 6, 2)]);
    expect(r.map((x) => x.id)).toEqual(['c', 'b', 'd', 'a']);
    expect(r.map((x) => x.rank)).toEqual([1, 2, 3, 4]);
  });
  it('Timeline: equal cards and equal artists share a rank, and the next rank skips', () => {
    const r = rankBoard('timeline', [p('a', 6, 2), p('b', 6, 2), p('c', 6, 2), p('d', 5, 9)]);
    expect(r.map((x) => x.rank)).toEqual([1, 1, 1, 4]);
  });
  it('Timeline: same cards but different artists do not tie', () => {
    expect(rankBoard('timeline', [p('a', 4, 1), p('b', 4, 2)]).map((x) => x.rank)).toEqual([1, 2]);
  });
  it('ties are listed by name so the order is steady', () => {
    expect(rankBoard('closestYear', [p('z', 2), p('m', 2), p('a', 2)]).map((x) => x.id)).toEqual(['a', 'm', 'z']);
  });
  it('does not change the input', () => {
    const input = [p('a', 1), p('b', 2)];
    rankBoard('closestYear', input);
    expect(input.map((x) => x.id)).toEqual(['a', 'b']);
  });
});

describe('top five', () => {
  it('cuts to five when there are more players', () => {
    const many = Array.from({ length: 12 }, (_, i) => p(`p${String(i).padStart(2, '0')}`, 12 - i));
    const top = topBoard('closestYear', many);
    expect(top.length).toBe(5);
    expect(top.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5]);
  });
  it('shows everyone when there are fewer than five', () => {
    expect(topBoard('timeline', [p('a', 3), p('b', 2)]).length).toBe(2);
    expect(topBoard('timeline', []).length).toBe(0);
  });
  it('a player outside the top five still has a rank', () => {
    const many = Array.from({ length: 8 }, (_, i) => p(`p${i}`, 8 - i));
    expect(rankOf('closestYear', many, 'p7')).toBe(8);
    expect(rankOf('closestYear', many, 'nobody')).toBeNull();
  });
  it('tied players share the rank rankOf reports', () => {
    expect(rankOf('timeline', [p('a', 5, 1), p('b', 5, 1), p('c', 2, 0)], 'b')).toBe(1);
  });
});

describe('ordinal', () => {
  it('handles suffixes, including the teens', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 20, 21, 22, 101].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '20th', '21st', '22nd', '101st']);
  });
});
