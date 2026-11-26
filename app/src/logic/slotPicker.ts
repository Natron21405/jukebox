import { isPlacementCorrect, type Card } from './timeline';

/** One tappable gap in a player's timeline. Slot n means "insert before the card at index n". */
export interface SlotInfo {
  slot: number;
  /** Year of the card on the left / right of this gap (null at the ends). */
  before: number | null;
  after: number | null;
  /** Spoken and written description, e.g. "Between 1975 and 1980". */
  label: string;
}

/** Describe one gap in words. Equal neighbours read as "Between 1980 and 1980", which is accurate: that year fits. */
export function slotLabel(timeline: readonly Card[], slot: number): string {
  const before = slot > 0 ? timeline[slot - 1]?.year ?? null : null;
  const after = slot < timeline.length ? timeline[slot]?.year ?? null : null;
  if (before === null && after === null) return 'Place the song here';
  if (before === null) return `Before ${after}`;
  if (after === null) return `After ${before}`;
  return `Between ${before} and ${after}`;
}

/** Every gap of a timeline, in order: length + 1 of them. */
export function describeSlots(timeline: readonly Card[]): SlotInfo[] {
  return Array.from({ length: timeline.length + 1 }, (_, slot) => ({
    slot,
    before: slot > 0 ? timeline[slot - 1].year : null,
    after: slot < timeline.length ? timeline[slot].year : null,
    label: slotLabel(timeline, slot),
  }));
}

/** A slot the phone may send: a whole number inside the timeline. Anything else means "no answer yet". */
export function validSlot(timeline: readonly Card[], slot: number | null | undefined): slot is number {
  return typeof slot === 'number' && Number.isInteger(slot) && slot >= 0 && slot <= timeline.length;
}

/** The slot to keep selected after the timeline changed under the player (a saved answer from an older timeline). */
export function keepSlot(timeline: readonly Card[], slot: number | null | undefined): number | null {
  return validSlot(timeline, slot) ? slot : null;
}

/** Every slot where a song of this year would be accepted. With equal years that is more than one gap. */
export function correctSlots(timeline: readonly Card[], year: number): number[] {
  return describeSlots(timeline).filter((s) => isPlacementCorrect(timeline, s.slot, year)).map((s) => s.slot);
}

/** Toggle behaviour of the slot buttons: tapping the chosen gap again keeps it (a lock-in is the way to commit). */
export function chooseSlot(timeline: readonly Card[], current: number | null, tapped: number): number | null {
  return validSlot(timeline, tapped) ? tapped : keepSlot(timeline, current);
}

/** Consecutive cards of the same year, shown as one pile. `start` is the index of its first card in the timeline. */
export interface CardStack {
  year: number;
  count: number;
  start: number;
  cards: Card[];
}

/** Group a sorted timeline into stacks of equal years (a single card is a stack of 1). Display only: every card still counts. */
export function groupStacks(timeline: readonly Card[]): CardStack[] {
  const stacks: CardStack[] = [];
  timeline.forEach((c, i) => {
    const last = stacks[stacks.length - 1];
    if (last && last.year === c.year) { last.count += 1; last.cards.push(c); }
    else stacks.push({ year: c.year, count: 1, start: i, cards: [c] });
  });
  return stacks;
}

/** The gaps a player can tap: around stacks, never through one. Equal years are always valid, so this loses no correct answer. */
export function stackSlots(timeline: readonly Card[]): number[] {
  return [...groupStacks(timeline).map((s) => s.start), timeline.length];
}
