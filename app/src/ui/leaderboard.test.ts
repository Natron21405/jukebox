// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { topBoard } from '../logic';
import { leaderboardList, type RoundMark } from './leaderboard';

const players = [
  { id: 'a', name: 'Ann', total: 5, hits: 2 },
  { id: 'b', name: 'Bo', total: 5, hits: 2 },
  { id: 'c', name: 'Cy', total: 4, hits: 0 },
];

describe('answer-screen leaderboard', () => {
  it('Timeline: shows rank, cards, artists so far, and a placement and artist verdict each with an icon', () => {
    const marks = new Map<string, RoundMark>([
      ['a', { placed: true, artist: 'hit' }], ['b', { placed: false, artist: 'miss' }], ['c', { placed: null, artist: 'none' }],
    ]);
    const el = leaderboardList('timeline', topBoard('timeline', players), marks);
    const rows = [...el.querySelectorAll('.lb-row')];
    expect(rows.map((r) => r.getAttribute('data-rank'))).toEqual(['1', '1', '3']); // ties share a rank
    expect(rows[0].querySelector('[data-lb-hits]')!.getAttribute('data-lb-hits')).toBe('2');
    const ok = (r: Element, kind: string) => r.querySelector(`[data-mark=${kind}]`)!.getAttribute('data-ok');
    expect([ok(rows[0], 'placement'), ok(rows[1], 'placement'), ok(rows[2], 'placement')]).toEqual(['true', 'false', 'false']);
    expect([ok(rows[0], 'artist'), ok(rows[1], 'artist'), ok(rows[2], 'artist')]).toEqual(['true', 'false', 'none']);
    expect(rows[0].querySelector('.lb-mark.right .lb-icon')!.textContent).toBe('✓');
    expect(rows[1].querySelector('.lb-mark.wrong .lb-icon')!.textContent).toBe('✗');
  });
  it('Closest Year: shows points this round and the artist verdict, and no artists-so-far column', () => {
    const marks = new Map<string, RoundMark>([['a', { points: 3, artist: 'hit' }], ['b', { points: 0, artist: 'miss' }]]);
    const el = leaderboardList('closestYear', topBoard('closestYear', players.slice(0, 2)), marks);
    expect(el.querySelectorAll('.lb-row').length).toBe(2);
    expect(el.querySelector('[data-lb-hits]')).toBeNull();
    expect(el.querySelector('.lb-row[data-player=Ann] .lb-points')!.getAttribute('data-points')).toBe('3');
    expect(el.querySelector('.lb-row[data-player=Bo] [data-mark=artist]')!.getAttribute('data-ok')).toBe('false');
  });
});
