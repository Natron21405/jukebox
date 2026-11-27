/** The seat a phone remembers (so a refresh puts the player straight back), and a host's room credentials (in memory only). */
export interface StoredSeat { code: string; roomId: string; playerId: string; seatToken: string; name: string }
export interface StoredHost { code: string; roomId: string; hostToken: string }

/** The slice of localStorage we use, so tests can pass a plain in-memory object. */
export interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export const SEAT_KEY = 'jukebox.seat';
const OLD_HOST_KEYS = ['jukebox.host', 'jukebox.hosts']; // saved by earlier versions

export function memoryKV(): KV {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

/** localStorage when available (it throws in some private modes), otherwise memory. */
export function browserKV(): KV {
  try {
    const ls = globalThis.localStorage;
    ls.setItem('jukebox.probe', '1');
    ls.removeItem('jukebox.probe');
    return ls;
  } catch {
    return memoryKV();
  }
}

function load<T>(kv: KV, key: string, ok: (v: Record<string, unknown>) => boolean): T | null {
  try {
    const raw = kv.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw) as Record<string, unknown>;
    return v && typeof v === 'object' && ok(v) ? (v as unknown as T) : null;
  } catch {
    return null;
  }
}
const str = (v: unknown) => typeof v === 'string' && v !== '';

export const seatStore = (kv: KV) => ({
  load: () => load<StoredSeat>(kv, SEAT_KEY, (v) => str(v.code) && str(v.roomId) && str(v.playerId) && str(v.seatToken)),
  save: (s: StoredSeat) => kv.setItem(SEAT_KEY, JSON.stringify(s)),
  clear: () => kv.removeItem(SEAT_KEY),
});

/**
 * The host page keeps nothing: a game lives in the open tab, like Jackbox and Kahoot. Earlier versions saved the
 * host's room credentials here, which brought old games back by surprise, so those leftovers are wiped.
 */
export function clearOldHostStorage(kv: KV): void {
  for (const k of OLD_HOST_KEYS) { try { kv.removeItem(k); } catch { /* storage unavailable */ } }
}
