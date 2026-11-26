import { CONFIG } from './config';

/**
 * The one top-N list shown after each answer. Pure: no UI, no network.
 * Closest Year ranks by points. Timeline ranks by cards, then by total artists guessed right (the game's tiebreak).
 * Players equal on every ranking key share a rank, and the next rank skips (1, 1, 3).
 */
export type BoardMode = 'closestYear' | 'timeline';

export interface BoardInput {
  id: string;
  name: string;
  /** Closest Year: points. Timeline: cards held. */
  total: number;
  /** Timeline only: artists guessed right over the whole game. Ignored in Closest Year. */
  hits?: number;
}

export interface BoardRow extends BoardInput {
  hits: number;
  rank: number;
}

const hitsOf = (mode: BoardMode, p: BoardInput) => (mode === 'timeline' ? p.hits ?? 0 : 0);

/** Everyone, best first, with shared ranks. Equal entries are ordered by name so the list never jumps around. */
export function rankBoard(mode: BoardMode, players: readonly BoardInput[]): BoardRow[] {
  const sorted = [...players]
    .map((p) => ({ ...p, hits: hitsOf(mode, p) }))
    .sort((a, b) => b.total - a.total || b.hits - a.hits || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return sorted.map((p, i) => {
    const prev = sorted[i - 1];
    const same = prev && prev.total === p.total && prev.hits === p.hits;
    return { ...p, rank: i === 0 ? 1 : same ? 0 : i + 1 };
  }).reduce<BoardRow[]>((acc, p) => {
    // A tie takes the rank of the entry before it.
    acc.push(p.rank === 0 ? { ...p, rank: acc[acc.length - 1].rank } : p);
    return acc;
  }, []);
}

/** The first `size` rows (everyone when there are fewer players). */
export function topBoard(mode: BoardMode, players: readonly BoardInput[], size: number = CONFIG.leaderboardSize): BoardRow[] {
  return rankBoard(mode, players).slice(0, size);
}

/** One player's rank (ties share), or null if they are not in the list. */
export function rankOf(mode: BoardMode, players: readonly BoardInput[], id: string): number | null {
  return rankBoard(mode, players).find((p) => p.id === id)?.rank ?? null;
}

export function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'}`;
}
