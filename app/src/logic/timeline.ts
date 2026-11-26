import { CONFIG } from './config';
import { randomIndex, type Rng } from './rng';

export interface Card {
  year: number;
  /** Absent on starting cards, which are year-only placeholders. */
  songId?: string;
  starter?: boolean;
}

/** A timeline is always kept sorted by year (equal years allowed). */

export function pairKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

/** Key of the starting pair in a timeline (uses the cards flagged `starter`). */
export function startingPairKey(timeline: readonly Card[]): string | null {
  const s = timeline.filter((c) => c.starter);
  return s.length === 2 ? pairKey(s[0].year, s[1].year) : null;
}

/**
 * Two different random years in the starting range, as sorted year-only cards.
 * Avoids any pair already in `usedPairs` while an unused pair exists; otherwise repeats one.
 */
export function drawStartingCards(rng: Rng, usedPairs: ReadonlySet<string> = new Set()): Card[] {
  const { startYearMin: lo, startYearMax: hi } = CONFIG.timeline;
  const all: Array<[number, number]> = [];
  for (let a = lo; a <= hi; a++) for (let b = a + 1; b <= hi; b++) all.push([a, b]);
  const free = all.filter(([a, b]) => !usedPairs.has(pairKey(a, b)));
  const pool = free.length > 0 ? free : all;
  const [a, b] = pool[randomIndex(rng, pool.length)];
  return [
    { year: a, starter: true },
    { year: b, starter: true },
  ];
}

/** Deal starting cards to many players, pairs distinct across players where possible. */
export function dealStartingHands(
  playerIds: readonly string[],
  rng: Rng,
  alreadyUsedPairs: Iterable<string> = [],
): Record<string, Card[]> {
  const used = new Set(alreadyUsedPairs);
  const hands: Record<string, Card[]> = {};
  for (const id of playerIds) {
    const cards = drawStartingCards(rng, used);
    used.add(pairKey(cards[0].year, cards[1].year));
    hands[id] = cards;
  }
  return hands;
}

/**
 * Slot n means "insert before the card at index n" (0 = before first, length = after last).
 * Correct when year >= previous card and year <= next card (equal years always fine).
 * A missing or out-of-range slot is simply not correct.
 */
export function isPlacementCorrect(timeline: readonly Card[], slot: number | null | undefined, year: number): boolean {
  if (slot == null || !Number.isInteger(slot) || slot < 0 || slot > timeline.length) return false;
  const prev = slot > 0 ? timeline[slot - 1] : null;
  const next = slot < timeline.length ? timeline[slot] : null;
  if (prev && year < prev.year) return false;
  if (next && year > next.year) return false;
  return true;
}

export interface PlacementResult {
  correct: boolean;
  /** The new timeline: the song inserted if correct, otherwise the same cards untouched. */
  timeline: Card[];
}

/** Correct placement adds the song as a card; wrong placement adds nothing and costs nothing. */
export function applyPlacement(
  timeline: readonly Card[],
  slot: number | null | undefined,
  song: { id: string; year: number },
): PlacementResult {
  if (!isPlacementCorrect(timeline, slot, song.year)) return { correct: false, timeline: [...timeline] };
  const next = [...timeline];
  next.splice(slot as number, 0, { year: song.year, songId: song.id });
  return { correct: true, timeline: next };
}
