import { chooseSlot, describeSlots, groupStacks, keepSlot, type Card, type CardStack } from '../logic';
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
  const buttons: (HTMLButtonElement | undefined)[] = [];

  const paint = () => buttons.forEach((b, i) => {
    if (!b) return;
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
  const addGap = (slot: number) => {
    const s = slots[slot];
    const b = h('button', {
      class: 'tl-slot', type: 'button', 'data-slot': String(s.slot), 'aria-label': s.label, 'aria-pressed': 'false',
      onclick: () => set(s.slot, true),
    }, h('span', { class: 'slot-text', 'aria-hidden': 'true' }, '+'));
    buttons[slot] = b;
    row.append(h('li', { class: 'tl-gap' }, b));
  };
  // Gaps go around a stack of equal years, never through it (equal years are always valid).
  for (const st of groupStacks(timeline)) {
    addGap(st.start);
    row.append(stackItem(st, o.newest));
  }
  addGap(timeline.length);
  paint();

  return { el: row, value: () => slot, set };
}

/** One card, or a pile of equal-year cards with an "x2" / "x3" badge. */
function stackItem(st: CardStack, newest?: (c: Card, i: number) => boolean): HTMLElement {
  const isNew = st.cards.some((c, k) => newest?.(c, st.start + k));
  const cls = `tl-card${isNew ? ' newest' : ''}${st.count > 1 ? ' stack' : ''}`;
  const attrs: Record<string, string> = { class: cls, 'data-card-year': String(st.year), 'data-stack-size': String(st.count) };
  if (st.count > 1) attrs['aria-label'] = `${st.year}, ${st.count} cards`;
  return h('li', attrs, String(st.year), st.count > 1 ? h('span', { class: 'stack-badge', 'data-stack-badge': '' }, `x${st.count}`) : null);
}

/** A read-only row of cards (result screen, host progress). Cards of the same year form one stack. */
export function cardRow(timeline: readonly Card[], newest?: (c: Card, i: number) => boolean): HTMLElement {
  return h('ol', { class: 'tl-row static', 'data-component': 'card-row', 'data-cards': String(timeline.length) },
    ...groupStacks(timeline).map((st) => stackItem(st, newest)));
}
