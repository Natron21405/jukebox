import { describe, expect, it } from 'vitest';
import { blockedEntries, exhaustedMessage, summarizePool } from './songLibrary';
import type { Song } from './types';

const pool: Song[] = ['a', 'b', 'c', 'd'].map((k, i) => ({
  id: `t-${k}`, title: `Made Up ${k.toUpperCase()}`, artists: [`Nobody ${k}`], featuredArtists: [], year: 1970 + i,
}));

describe('summarizePool', () => {
  it('counts blocked, played and available songs, blocked winning over played', () => {
    expect(summarizePool(pool, { blocked: ['t-a'], played: ['t-a', 't-b'] })).toEqual({ total: 4, blocked: 1, played: 1, available: 2 });
  });
  it('ignores ids that are not in the pool', () => {
    expect(summarizePool(pool, { blocked: ['gone'], played: ['gone-too'] })).toEqual({ total: 4, blocked: 0, played: 0, available: 4 });
  });
});

describe('blockedEntries', () => {
  it('joins ids to titles and artists, sorted by title', () => {
    const r = blockedEntries(pool, ['t-c', 't-a']);
    expect(r.map((e) => e.id)).toEqual(['t-a', 't-c']);
    expect(r[0]).toEqual({ id: 't-a', known: true, title: 'Made Up A', artist: 'Nobody a' });
  });
  it('keeps unknown ids so they can be restored, and drops duplicates', () => {
    const r = blockedEntries(pool, ['zzz-1', 'zzz-1']);
    expect(r).toHaveLength(1);
    expect(r[0].known).toBe(false);
  });
});

describe('exhaustedMessage', () => {
  it('offers the reset only when it would help', () => {
    expect(exhaustedMessage(true)).toMatch(/available again/);
    expect(exhaustedMessage(false)).not.toMatch(/available again/);
  });
});
