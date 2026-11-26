import { describe, expect, it } from 'vitest';
import { applyPlacement, chooseSlot, correctSlots, describeSlots, keepSlot, slotLabel, validSlot, type Card } from './index';

const tl = (...years: number[]): Card[] => years.map((year) => ({ year }));

describe('describeSlots', () => {
  it('has one more gap than cards, in order', () => {
    const slots = describeSlots(tl(1975, 1980, 1990));
    expect(slots.map((s) => s.slot)).toEqual([0, 1, 2, 3]);
    expect(slots.map((s) => s.label)).toEqual(['Before 1975', 'Between 1975 and 1980', 'Between 1980 and 1990', 'After 1990']);
    expect(slots[0]).toMatchObject({ before: null, after: 1975 });
    expect(slots[3]).toMatchObject({ before: 1990, after: null });
  });
  it('handles a single card and an empty timeline', () => {
    expect(describeSlots(tl(2000)).map((s) => s.label)).toEqual(['Before 2000', 'After 2000']);
    expect(describeSlots([]).map((s) => s.label)).toEqual(['Place the song here']);
    expect(slotLabel(tl(1999), 1)).toBe('After 1999');
  });
});

describe('correctSlots (equal years are fine on either side)', () => {
  it('a year equal to a card fits on both sides of it', () => {
    expect(correctSlots(tl(1970, 1980, 1990), 1980)).toEqual([1, 2]);
  });
  it('a run of equal cards accepts every gap in and around it', () => {
    expect(correctSlots(tl(1980, 1980, 1980), 1980)).toEqual([0, 1, 2, 3]);
    expect(correctSlots(tl(1970, 1980, 1980, 1990), 1980)).toEqual([1, 2, 3]);
  });
  it('a year strictly between cards fits exactly one gap', () => {
    expect(correctSlots(tl(1970, 1980, 1990), 1985)).toEqual([2]);
  });
  it('outside the range fits only an end', () => {
    expect(correctSlots(tl(1970, 1980), 1960)).toEqual([0]);
    expect(correctSlots(tl(1970, 1980), 2005)).toEqual([2]);
  });
  it('agrees with applyPlacement for every gap', () => {
    const line = tl(1970, 1980, 1980, 1990);
    for (const year of [1960, 1970, 1975, 1980, 1985, 1990, 2000]) {
      const ok = correctSlots(line, year);
      for (const s of describeSlots(line)) {
        expect(applyPlacement(line, s.slot, { id: 'x', year }).correct).toBe(ok.includes(s.slot));
      }
    }
  });
});

describe('slot choice', () => {
  const line = tl(1970, 1980);
  it('accepts only whole slots inside the timeline', () => {
    expect([0, 1, 2].map((s) => validSlot(line, s))).toEqual([true, true, true]);
    for (const bad of [-1, 3, 1.5, null, undefined, NaN]) expect(validSlot(line, bad as number)).toBe(false);
  });
  it('tapping a gap selects it, and tapping another changes the choice', () => {
    expect(chooseSlot(line, null, 1)).toBe(1);
    expect(chooseSlot(line, 1, 2)).toBe(2);
    expect(chooseSlot(line, 2, 2)).toBe(2);
  });
  it('an impossible tap keeps the earlier choice; a stale saved slot is dropped', () => {
    expect(chooseSlot(line, 1, 9)).toBe(1);
    expect(keepSlot(line, 7)).toBeNull();
    expect(keepSlot(line, 0)).toBe(0);
  });
});
