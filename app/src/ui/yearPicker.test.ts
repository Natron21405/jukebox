// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONFIG } from '../logic';
import { createYearPicker } from './yearPicker';

const RANGE = { min: 1950, max: 2025 };
const readout = (el: HTMLElement) => el.querySelector('.year-readout')!.textContent;
const slider = (el: HTMLElement) => el.querySelector<HTMLInputElement>('input[type=range]')!;
const btn = (el: HTMLElement, step: 1 | -1) => el.querySelector<HTMLButtonElement>(`[data-step="${step}"]`)!;
const fire = (el: Element, type: string) => el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));

describe('year picker component', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); });

  it('starts in the middle of the range and carries no hint about any song', () => {
    const p = createYearPicker({ range: RANGE });
    expect(p.value()).toBe(1988);
    expect(readout(p.el)).toBe('1988');
    // Same start for every round: nothing about a song can reach the component, only the range and the last guess.
    expect(createYearPicker({ range: RANGE }).value()).toBe(p.value());
    expect(slider(p.el).min).toBe('1950');
    expect(slider(p.el).max).toBe('2025');
  });

  it('starts where this player last guessed, clamped into the range', () => {
    expect(createYearPicker({ range: RANGE, initial: 1999 }).value()).toBe(1999);
    expect(createYearPicker({ range: RANGE, initial: 3000 }).value()).toBe(2025);
  });

  it('draws decade ticks and chips', () => {
    const p = createYearPicker({ range: RANGE });
    expect(p.el.querySelectorAll('.year-tick').length).toBeGreaterThanOrEqual(7);
    expect(p.el.querySelector('[data-chip="80s"]')).not.toBeNull();
  });

  it('a keyboard or screen-reader click moves one year', () => {
    const seen: number[] = [];
    const p = createYearPicker({ range: RANGE, onChange: (y) => seen.push(y) });
    btn(p.el, 1).click(); btn(p.el, 1).click(); btn(p.el, -1).click();
    expect(p.value()).toBe(1989);
    expect(seen).toEqual([1989, 1990, 1989]);
  });

  it('holding plus repeats, speeds up, and stops on release', () => {
    const p = createYearPicker({ range: RANGE });
    const start = p.value();
    fire(btn(p.el, 1), 'pointerdown');
    expect(p.value()).toBe(start + 1); // immediate single step
    vi.advanceTimersByTime(CONFIG.yearPicker.holdDelayMs - 1);
    expect(p.value()).toBe(start + 1);
    vi.advanceTimersByTime(CONFIG.yearPicker.holdRepeatMs + 1);
    expect(p.value()).toBeGreaterThan(start + 1);
    vi.advanceTimersByTime(2000);
    const fast = p.value();
    expect(fast).toBeGreaterThan(start + 10);
    fire(btn(p.el, 1), 'pointerup');
    vi.advanceTimersByTime(2000);
    expect(p.value()).toBe(fast);
  });

  it('never goes past either end, even when held', () => {
    const p = createYearPicker({ range: RANGE, initial: 2024 });
    fire(btn(p.el, 1), 'pointerdown');
    vi.advanceTimersByTime(3000);
    fire(btn(p.el, 1), 'pointerup');
    expect(p.value()).toBe(2025);
    expect(readout(p.el)).toBe('2025');
    fire(btn(p.el, -1), 'pointerdown');
    vi.advanceTimersByTime(20000);
    fire(btn(p.el, -1), 'pointerleave');
    expect(p.value()).toBe(1950);
  });

  it('slider, chips and set() stay in sync and report changes', () => {
    const seen: number[] = [];
    const p = createYearPicker({ range: RANGE, onChange: (y) => seen.push(y) });
    const s = slider(p.el);
    s.value = '1975'; fire(s, 'input');
    expect(readout(p.el)).toBe('1975');
    p.el.querySelector<HTMLButtonElement>('[data-chip="60s"]')!.click();
    expect(p.value()).toBeGreaterThanOrEqual(1960);
    expect(p.value()).toBeLessThanOrEqual(1969);
    expect(s.value).toBe(String(p.value()));
    p.set(1951);
    expect(seen[seen.length - 1]).not.toBe(1951); // set() without notify does not fire onChange
    expect(readout(p.el)).toBe('1951');
  });

  it('destroy stops a hold in progress', () => {
    const p = createYearPicker({ range: RANGE });
    fire(btn(p.el, 1), 'pointerdown');
    p.destroy();
    const v = p.value();
    vi.advanceTimersByTime(5000);
    expect(p.value()).toBe(v);
  });
});
