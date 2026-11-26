import { chooseSlot, describeSlots, keepSlot, type Card } from '../logic';
import { h } from './dom';

export interface TimelinePicker {
  el: HTMLElement;
  /** The chosen slot, or null when nothing is chosen yet. */
  value(): number | null;
  set(slot: number | null, notify?: boolean): void;
}

export interface TimelinePickerOptions {
  timeline: readonly Card[];
  /** The player's saved slot (changeable until Lock In). Dropped if it no longer fits the timeline. */
  initial?: number | null;
  onChange?: (slot: number) => void;
  /** Highlight this card (the one just placed, on the result screen). */
  newest?: (c: Card, i: number) => boolean;
}

/**
 * A player's own timeline as a horizontally scrolling row of year cards with a big tappable gap between and around
 * them. Tap a gap to choose it (it lights up), tap another to change. The row scrolls the chosen gap into view.
 */
export function createTimelinePicker(o: TimelinePickerOptions): TimelinePicker {
  const { timeline } = o;
  let slot = keepSlot(timeline, o.initial);
  const slots = describeSlots(timeline);
  const buttons: HTMLButtonElement[] = [];

  const paint = () => buttons.forEach((b, i) => {
    const on = i === slot;
    b.classList.toggle('chosen', on);
    b.setAttribute('aria-pressed', String(on));
    b.querySelector('.slot-text')!.textContent = on ? 'Here ✓' : '+';
  });

  const set = (next: number | null, notify = false) => {
    const before = slot;
    slot = next === null ? null : chooseSlot(timeline, slot, next);
    paint();
    if (slot !== null && slot !== before && notify) o.onChange?.(slot);
    if (slot !== null) buttons[slot]?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
  };

  const row = h('ol', { class: 'tl-row', 'data-component': 'timeline-picker', 'data-cards': String(timeline.length) });
  for (const s of slots) {
    const b = h('button', {
      class: 'tl-slot', type: 'button', 'data-slot': String(s.slot), 'aria-label': s.label, 'aria-pressed': 'false',
      onclick: () => set(s.slot, true),
    }, h('span', { class: 'slot-text', 'aria-hidden': 'true' }, '+'));
    buttons.push(b);
    row.append(h('li', { class: 'tl-gap' }, b));
    if (s.slot < timeline.length) {
      const c = timeline[s.slot];
      row.append(h('li', { class: `tl-card${o.newest?.(c, s.slot) ? ' newest' : ''}`, 'data-card-year': String(c.year) }, String(c.year)));
    }
  }
  paint();

  return { el: row, value: () => slot, set };
}

/** A read-only row of cards (result screen, host progress). */
export function cardRow(timeline: readonly Card[], newest?: (c: Card, i: number) => boolean): HTMLElement {
  return h('ol', { class: 'tl-row static', 'data-component': 'card-row', 'data-cards': String(timeline.length) },
    ...timeline.map((c, i) => h('li', { class: `tl-card${newest?.(c, i) ? ' newest' : ''}`, 'data-card-year': String(c.year) }, String(c.year))));
}
