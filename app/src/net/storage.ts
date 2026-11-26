/** The seat a phone remembers (so a refresh puts the player straight back), and the host's room credentials. */
export interface StoredSeat { code: string; roomId: string; playerId: string; seatToken: string; name: string }
export interface StoredHost { code: string; roomId: string; hostToken: string }

/** The slice of localStorage we use, so tests can pass a plain in-memory object. */
export interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

export const SEAT_KEY = 'jukebox.seat';
export const HOST_KEY = 'jukebox.host';

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

export const hostStore = (kv: KV) => ({
  load: () => load<StoredHost>(kv, HOST_KEY, (v) => str(v.code) && str(v.roomId) && str(v.hostToken)),
  save: (s: StoredHost) => kv.setItem(HOST_KEY, JSON.stringify(s)),
  clear: () => kv.removeItem(HOST_KEY),
});
