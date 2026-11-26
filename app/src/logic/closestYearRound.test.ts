import { describe, expect, it } from 'vitest';
import { applyOverride, buildReveal, everyoneLocked, isUsableYear, timerExpired, artistResult, type GameSong } from './closestYearRound';

const song: GameSong = { id: 'x-001', title: 'Made Up Tune', artists: ['Zorblat Quartet'], featuredArtists: ['Guest Person'], year: 1990 };

describe('isUsableYear', () => {
  it('accepts whole years in range only', () => {
    expect(isUsableYear(1990)).toBe(true);
    expect(isUsableYear(1899)).toBe(false);
    expect(isUsableYear(2101)).toBe(false);
    expect(isUsableYear(1990.5)).toBe(false);
    expect(isUsableYear(null)).toBe(false);
    expect(isUsableYear('1990')).toBe(false);
  });
});

describe('artistResult', () => {
  it('lets the host override beat the matcher, but never for an empty guess', () => {
    expect(artistResult('Zorblat Quartet', song, null).hit).toBe(true);
    expect(artistResult('Zorblat Quartet', song, false).hit).toBe(false);
    expect(artistResult('totally off', song, true)).toEqual({ autoMatched: false, hit: true });
    expect(artistResult('  ', song, true).hit).toBe(false);
  });
  it('never accepts a featured artist', () => {
    expect(artistResult('Guest Person', song, null).hit).toBe(false);
  });
});

describe('buildReveal', () => {
  it('gives every player a row and scores by the table', () => {
    const r = buildReveal(song, 'normal', ['a', 'b', 'c', 'd'], [
      { playerId: 'a', year: 1990, artist: 'Zorblat Quartet' }, // 5 + 2
      { playerId: 'b', year: 1991, artist: '' },               // 3
      { playerId: 'c', year: 1985, artist: 'nope' },           // 1
      // d: no answer
    ]);
    expect(r.rows.map((x) => x.total)).toEqual([7, 3, 1, 0]);
    expect(r.rows[3].year).toBeNull();
  });
  it('treats junk years as no answer', () => {
    const r = buildReveal(song, 'normal', ['a'], [{ playerId: 'a', year: 12, artist: '' }]);
    expect(r.rows[0]).toMatchObject({ year: null, total: 0 });
  });
  it('scores nothing in sudden death', () => {
    const r = buildReveal(song, 'sudden_death', ['a'], [{ playerId: 'a', year: 1990, artist: 'Zorblat Quartet' }]);
    expect(r.rows[0].total).toBe(0);
    expect(r.rows[0].distance).toBe(0);
  });
});

describe('applyOverride', () => {
  const base = buildReveal(song, 'normal', ['a', 'b'], [
    { playerId: 'a', year: 1990, artist: 'Zorblat Qrtet X' },
    { playerId: 'b', year: 1990, artist: 'Zorblat Quartet' },
  ]);
  it('adds the bonus when accepted and takes it back when rejected', () => {
    const on = applyOverride(base, song, 'a', true);
    expect(on.scoreDelta).toBe(2);
    expect(on.hitDelta).toBe(1);
    const off = applyOverride(base, song, 'b', false);
    expect(off.scoreDelta).toBe(-2);
    expect(off.hitDelta).toBe(-1);
    const back = applyOverride(on.reveal, song, 'a', null);
    expect(back.scoreDelta).toBe(-2);
  });
  it('does not touch other rows', () => {
    const on = applyOverride(base, song, 'a', true);
    expect(on.reveal.rows[1]).toEqual(base.rows[1]);
  });
});

describe('everyoneLocked', () => {
  const ps = [{ id: 'a', connected: true }, { id: 'b', connected: true }, { id: 'c', connected: false }];
  it('ignores disconnected players', () => {
    expect(everyoneLocked(ps, ['a'])).toBe(false);
    expect(everyoneLocked(ps, ['a', 'b'])).toBe(true);
  });
  it('narrows to the contenders and never fires with nobody expected', () => {
    expect(everyoneLocked(ps, ['a'], ['a'])).toBe(true);
    expect(everyoneLocked(ps, [], ['c'])).toBe(false);
    expect(everyoneLocked([], [])).toBe(false);
  });
});

describe('timerExpired', () => {
  it('compares against ends_at', () => {
    const end = new Date(1000).toISOString();
    expect(timerExpired(end, 999)).toBe(false);
    expect(timerExpired(end, 1000)).toBe(true);
    expect(timerExpired(null, 1e15)).toBe(false);
  });
});
