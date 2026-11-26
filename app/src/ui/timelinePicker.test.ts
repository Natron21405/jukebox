// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { Card } from '../logic';
import { cardRow, createTimelinePicker } from './timelinePicker';

const tl = (...years: number[]): Card[] => years.map((year) => ({ year }));
const slotBtn = (el: HTMLElement, n: number) => el.querySelector<HTMLButtonElement>(`[data-slot="${n}"]`)!;

describe('timeline picker', () => {
  it('shows every card in order with a gap before, between and after (n + 1 gaps)', () => {
    const p = createTimelinePicker({ timeline: tl(1975, 1980, 1990) });
    expect([...p.el.querySelectorAll('[data-card-year]')].map((c) => c.textContent)).toEqual(['1975', '1980', '1990']);
    expect(p.el.querySelectorAll('[data-slot]').length).toBe(4);
    expect(p.value()).toBeNull();
    expect(slotBtn(p.el, 1).getAttribute('aria-label')).toBe('Between 1975 and 1980');
  });
  it('tapping a gap chooses it and tells the caller; tapping another changes it', () => {
    const seen: number[] = [];
    const p = createTimelinePicker({ timeline: tl(1975, 1990), onChange: (s) => seen.push(s) });
    slotBtn(p.el, 1).click();
    expect(p.value()).toBe(1);
    expect(slotBtn(p.el, 1).classList.contains('chosen')).toBe(true);
    expect(slotBtn(p.el, 1).getAttribute('aria-pressed')).toBe('true');
    slotBtn(p.el, 2).click();
    expect(p.value()).toBe(2);
    expect(slotBtn(p.el, 1).classList.contains('chosen')).toBe(false);
    expect(seen).toEqual([1, 2]);
    slotBtn(p.el, 2).click(); // same gap again: nothing new to save
    expect(seen).toEqual([1, 2]);
  });
  it('equal years: both gaps beside an equal card are offered and tappable', () => {
    const p = createTimelinePicker({ timeline: tl(1980, 1980) });
    expect(p.el.querySelectorAll('[data-slot]').length).toBe(3);
    expect([0, 1, 2].map((n) => slotBtn(p.el, n).getAttribute('aria-label'))).toEqual(['Before 1980', 'Between 1980 and 1980', 'After 1980']);
    slotBtn(p.el, 1).click();
    expect(p.value()).toBe(1);
  });
  it('starts from a saved slot, and drops one that does not fit', () => {
    expect(createTimelinePicker({ timeline: tl(1970, 1980), initial: 2 }).value()).toBe(2);
    expect(createTimelinePicker({ timeline: tl(1970, 1980), initial: 5 }).value()).toBeNull();
  });
  it('marks the newest card, and the static row has no buttons', () => {
    const line = [{ year: 1970 }, { year: 1975, songId: 'x' }, { year: 1980 }] as Card[];
    const row = cardRow(line, (c) => c.songId === 'x');
    expect(row.querySelectorAll('button').length).toBe(0);
    expect(row.querySelector('.newest')!.textContent).toBe('1975');
  });
});
