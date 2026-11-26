import { describe, expect, it } from 'vitest';
import { CONFIG } from './config';
import {
  clampYear, createHold, decadeChips, fraction, startYear, stepYear, tickYears, yearRangeOf, type HoldTimers,
} from './yearPicker';

const R = { min: 1950, max: 2026 };

function fakeTimers() {
  let now = 0; let next = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const timers: HoldTimers = {
    setTimeout(fn, ms) { const id = next++; pending.set(id, { at: now + ms, fn }); return id; },
    clearTimeout(id) { pending.delete(id as number); },
  };
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const due = [...pending.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      now = due[1].at; pending.delete(due[0]); due[1].fn();
    }
    now = end;
  };
  return { timers, advance, pending: () => pending.size };
}

describe('year range', () => {
  it('defaults to the song range and follows the host setting when there is one', () => {
    expect(yearRangeOf({}, new Date('2026-06-01'))).toEqual({ min: 1950, max: 2026 });
    expect(yearRangeOf({ yearMin: 1980, yearMax: 1999 })).toEqual({ min: 1980, max: 1999 });
    expect(yearRangeOf({ yearMin: 2000, yearMax: 1990 })).toEqual({ min: 2000, max: 2001 });
    expect(yearRangeOf(null, new Date('2026-06-01')).min).toBe(1950);
  });
});

describe('bounds', () => {
  it('never leaves the range, however far you step', () => {
    expect(stepYear(1950, -1, R)).toBe(1950);
    expect(stepYear(2026, 1, R)).toBe(2026);
    expect(stepYear(2000, 500, R)).toBe(2026);
    expect(stepYear(2000, -500, R)).toBe(1950);
    expect(stepYear(1990, 1, R)).toBe(1991);
    expect(stepYear(1990, -1, R)).toBe(1989);
    expect(clampYear(1800, R)).toBe(1950);
    expect(clampYear(3000, R)).toBe(2026);
    expect(clampYear(1987.4, R)).toBe(1987);
  });
  it('maps a year to a slider position from 0 to 1', () => {
    expect(fraction(1950, R)).toBe(0);
    expect(fraction(2026, R)).toBe(1);
    expect(fraction(1988, R)).toBeCloseTo(0.5);
  });
});

describe('starting position gives no hint', () => {
  it('is the same fixed middle value no matter which song is up (it takes no song input at all)', () => {
    expect(startYear(R)).toBe(1988);
    expect(startYear(R, null)).toBe(1988);
    expect(startYear.length).toBe(2); // only (range, lastGuess): there is no way to pass a song
  });
  it('uses the last guess the player made, kept inside the range', () => {
    expect(startYear(R, 1977)).toBe(1977);
    expect(startYear(R, 1900)).toBe(1950);
    expect(startYear({ min: 1980, max: 1999 })).toBe(1990);
  });
});

describe('ticks and chips', () => {
  it('labels every decade on the full range and every 5 years on a short one', () => {
    expect(tickYears(R)).toEqual([1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020]);
    expect(tickYears({ min: 1980, max: 2000 })).toEqual([1980, 1985, 1990, 1995, 2000]);
  });
  it('has one chip per decade that jumps to the middle of it', () => {
    const chips = decadeChips(R);
    expect(chips.map((c) => c.label)).toEqual(['50s', '60s', '70s', '80s', '90s', '00s', '10s', '20s']);
    expect(chips.find((c) => c.label === '80s')!.year).toBe(1985);
    // The last decade is cut short by the range, so its middle is too.
    expect(chips.find((c) => c.label === '20s')!.year).toBe(2023);
    for (const c of chips) expect(clampYear(c.year, R)).toBe(c.year);
  });
});

describe('press and hold', () => {
  it('fires once at once, waits, then repeats until released', () => {
    const t = fakeTimers();
    let n = 0;
    const hold = createHold(() => { n++; }, t.timers);
    hold.start();
    expect(n).toBe(1);
    t.advance(CONFIG.yearPicker.holdDelayMs - 1);
    expect(n).toBe(1);
    t.advance(1);
    expect(n).toBe(2);
    t.advance(CONFIG.yearPicker.holdRepeatMs * 3);
    expect(n).toBe(5);
    hold.stop();
    t.advance(5000);
    expect(n).toBe(5);
    expect(t.pending()).toBe(0);
  });
  it('speeds up when held for a while', () => {
    const t = fakeTimers();
    let n = 0;
    const hold = createHold(() => { n++; }, t.timers);
    hold.start();
    t.advance(CONFIG.yearPicker.holdDelayMs + CONFIG.yearPicker.holdRepeatMs * CONFIG.yearPicker.holdFastAfter);
    const before = n;
    t.advance(CONFIG.yearPicker.holdFastRepeatMs * 4);
    expect(n - before).toBe(4);
    hold.stop();
  });
  it('stops by itself at the end of the range, and a held plus never passes the maximum', () => {
    const t = fakeTimers();
    let year = 2024;
    const hold = createHold(() => { const next = stepYear(year, 1, R); const moved = next !== year; year = next; return moved; }, t.timers);
    hold.start();
    t.advance(10_000);
    expect(year).toBe(2026);
    expect(hold.active).toBe(false);
    expect(t.pending()).toBe(0);
  });
  it('a quick tap is a single step, even if released before the delay', () => {
    const t = fakeTimers();
    let n = 0;
    const hold = createHold(() => { n++; }, t.timers);
    hold.start();
    hold.stop();
    t.advance(5000);
    expect(n).toBe(1);
  });
});
