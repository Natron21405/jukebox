import type { Song } from './types';

/** What the host sees about the song pool on the Songs screen. Counts only. */
export interface PoolSummary {
  /** Songs in the pool. */
  total: number;
  /** Pool songs on the blocklist. */
  blocked: number;
  /** Pool songs (not blocked) that an earlier game or this game already played. */
  played: number;
  /** Pool songs that can still be picked right now. */
  available: number;
}

export function summarizePool(
  pool: readonly { id: string }[],
  f: { blocked: Iterable<string>; played: Iterable<string> },
): PoolSummary {
  const blocked = new Set(f.blocked);
  const played = new Set(f.played);
  let b = 0, p = 0, a = 0;
  for (const s of pool) {
    if (blocked.has(s.id)) b++;
    else if (played.has(s.id)) p++;
    else a++;
  }
  return { total: pool.length, blocked: b, played: p, available: a };
}

export interface BlockedEntry {
  id: string;
  /** False when the id is no longer in the song list (the entry can still be restored). */
  known: boolean;
  title: string;
  artist: string;
}

/** The restore list: blocked ids joined to the pool, sorted by title. Unknown ids stay listed so they can be cleared. */
export function blockedEntries(pool: readonly Song[], blockedIds: Iterable<string>): BlockedEntry[] {
  const byId = new Map(pool.map((s) => [s.id, s]));
  const out: BlockedEntry[] = [];
  for (const id of new Set(blockedIds)) {
    const s = byId.get(id);
    out.push(s
      ? { id, known: true, title: s.title, artist: s.artists.join(', ') }
      : { id, known: false, title: 'Song no longer in the list', artist: id });
  }
  return out.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
}

/** Words for the host when no song can be picked. */
export function exhaustedMessage(resetWouldHelp: boolean): string {
  return resetWouldHelp
    ? 'Every song left has already been played in an earlier game. Make them all available again to keep going.'
    : 'There are no songs left to play. Check the Songs screen for blocked songs you could restore.';
}
