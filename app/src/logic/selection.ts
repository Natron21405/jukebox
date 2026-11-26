import { randomIndex, type Rng } from './rng';

export interface PoolSong {
  id: string;
  year: number;
}

export interface SelectionFilters {
  /** Songs already played in this game. */
  playedThisGame: Iterable<string>;
  /** Songs played in earlier games (the persistent history). */
  playedEarlier?: Iterable<string>;
  /** Songs the host removed from future games. */
  blocked?: Iterable<string>;
  /** Host year-range setting, inclusive. */
  yearRange?: { min: number; max: number };
}

export type SelectionResult<T> =
  | { status: 'ok'; song: T; remaining: number }
  | {
      status: 'exhausted';
      /** True if clearing earlier-games history would make songs available (so the host can be offered a reset). */
      resetWouldHelp: boolean;
    };

function eligible<T extends PoolSong>(pool: readonly T[], f: SelectionFilters, includeEarlier: boolean): T[] {
  const skip = new Set<string>([...f.playedThisGame, ...(f.blocked ?? [])]);
  if (includeEarlier) for (const id of f.playedEarlier ?? []) skip.add(id);
  return pool.filter(
    (s) => !skip.has(s.id) && (!f.yearRange || (s.year >= f.yearRange.min && s.year <= f.yearRange.max)),
  );
}

/** Songs that may still be chosen: never played (this or earlier games), not blocked, inside the year range. */
export function availableSongs<T extends PoolSong>(pool: readonly T[], f: SelectionFilters): T[] {
  return eligible(pool, f, true);
}

export function chooseNextSong<T extends PoolSong>(pool: readonly T[], f: SelectionFilters, rng: Rng): SelectionResult<T> {
  const avail = eligible(pool, f, true);
  if (avail.length === 0) {
    return { status: 'exhausted', resetWouldHelp: eligible(pool, f, false).length > 0 };
  }
  return { status: 'ok', song: avail[randomIndex(rng, avail.length)], remaining: avail.length - 1 };
}
