import { clampYear, createHold, decadeChips, fraction, startYear, stepYear, tickYears, type YearRange } from '../logic';
import { h } from './dom';

export interface YearPicker {
  el: HTMLElement;
  value(): number;
  set(year: number, notify?: boolean): void;
  /** Stop any press-and-hold that is still running (call when the screen goes away). */
  destroy(): void;
}

export interface YearPickerOptions {
  range: YearRange;
  /** Where to start: the player's saved answer or last guess. Never anything derived from the song. */
  initial?: number | null;
  onChange?: (year: number) => void;
}

/**
 * The year picker: a big readout, a slider with decade ticks, minus/plus buttons that repeat while held, and decade
 * chips. Everything is one-handed and at least 56 px to tap.
 */
export function createYearPicker(o: YearPickerOptions): YearPicker {
  const { range } = o;
  let year = startYear(range, o.initial);
  let last = year;

  const readout = h('output', { class: 'year-readout', 'data-year': String(year), 'aria-live': 'polite', for: 'year-slider' }, String(year));
  const slider = h('input', {
    class: 'year-slider', id: 'year-slider', type: 'range', min: range.min, max: range.max, step: 1, value: year,
    'aria-label': 'Year', 'data-role': 'slider',
  });

  const ticks = h('div', { class: 'year-ticks', 'aria-hidden': 'true' },
    ...tickYears(range).map((y) => h('span', { class: 'year-tick', style: `--at:${fraction(y, range)}` }, String(y))));

  const chips = h('div', { class: 'year-chips', role: 'group', 'aria-label': 'Jump to a decade' },
    ...decadeChips(range).map((c) => h('button', {
      class: 'chip', type: 'button', 'data-chip': c.label, 'aria-label': `Jump to the ${c.decade}s`,
      onclick: () => set(c.year, true),
    }, c.label)));

  function paint() {
    readout.textContent = String(year);
    readout.setAttribute('data-year', String(year));
    slider.value = String(year);
    for (const chip of chips.querySelectorAll('.chip')) {
      const d = decadeChips(range).find((c) => c.label === chip.getAttribute('data-chip'));
      chip.classList.toggle('on', !!d && year >= d.decade && year <= d.decade + 9);
    }
  }
  function set(next: number, notify = false) {
    year = clampYear(next, range);
    paint();
    if (notify && year !== last) { last = year; o.onChange?.(year); }
  }

  slider.addEventListener('input', () => set(Number(slider.value), true));

  const holds: Array<{ stop(): void }> = [];
  function stepButton(delta: 1 | -1, label: string, glyph: string) {
    const hold = createHold(() => {
      const before = year;
      set(stepYear(year, delta, range), true);
      return year !== before;
    });
    holds.push(hold);
    const btn = h('button', {
      class: `btn step-btn ${delta > 0 ? 'plus' : 'minus'}`, type: 'button', 'aria-label': label, 'data-step': String(delta),
    }, glyph);
    btn.addEventListener('pointerdown', (e) => {
      if (e instanceof MouseEvent && e.button > 0) return;
      e.preventDefault();
      hold.start();
    });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave', 'blur']) btn.addEventListener(ev, () => hold.stop());
    btn.addEventListener('contextmenu', (e) => e.preventDefault()); // long-press must not open a menu on a phone
    // Keyboard and screen readers click without a pointer (detail 0): that is one step.
    btn.addEventListener('click', (e) => { if (e.detail === 0) set(stepYear(year, delta, range), true); });
    return btn;
  }

  const el = h('div', { class: 'year-picker', 'data-component': 'year-picker' },
    h('div', { class: 'year-top' },
      stepButton(-1, 'One year earlier', '−'),
      readout,
      stepButton(1, 'One year later', '+'),
    ),
    h('div', { class: 'year-slider-wrap' }, slider, ticks),
    chips,
  );
  paint();

  return {
    el,
    value: () => year,
    set: (y, notify) => set(y, notify),
    destroy: () => holds.forEach((x) => x.stop()),
  };
}
