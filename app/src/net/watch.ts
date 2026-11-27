import { CONFIG } from '../logic';
import type { Backend } from './backend';
import type { Change, LockRow, PlayerRow, RoomRow, RoundRow, Unsubscribe } from './types';

/** What anyone with the room code can see (the public tables). */
export interface PublicRoomState {
  room: RoomRow;
  players: PlayerRow[];
  round: RoundRow | null;
  /** Player ids that have locked in for the current round. */
  locked: string[];
}

const newer = (a: RoundRow, b: RoundRow) => a.game_no > b.game_no || (a.game_no === b.game_no && a.round_no > b.round_no);

/** Pure: fold one realtime change into the state. Unknown or stale rows are ignored. */
export function applyChange(s: PublicRoomState, c: Change): PublicRoomState {
  switch (c.table) {
    case 'rooms': {
      if (c.row.id !== s.room.id || c.event === 'DELETE') return s;
      // A new game (Play Again) makes the old game's round stale, even if its DELETE never reaches us.
      const stale = s.round !== null && s.round.game_no < c.row.game_no;
      return { ...s, room: c.row, round: stale ? null : s.round, locked: stale ? [] : s.locked };
    }
    case 'players': {
      if (c.row.room_id !== undefined && c.row.room_id !== s.room.id) return s;
      const rest = s.players.filter((p) => p.id !== c.row.id);
      if (c.event === 'DELETE') return { ...s, players: rest };
      const known = s.players.some((p) => p.id === c.row.id);
      return { ...s, players: known ? s.players.map((p) => (p.id === c.row.id ? c.row : p)) : [...rest, c.row] };
    }
    case 'rounds': {
      if (c.event === 'DELETE') return c.row.id === s.round?.id ? { ...s, round: null, locked: [] } : s;
      if (!s.round || c.row.id === s.round.id) return { ...s, round: c.row };
      return newer(c.row, s.round) ? { ...s, round: c.row, locked: [] } : s;
    }
    case 'round_locks': {
      const row: LockRow = c.row;
      if (c.event === 'DELETE') return { ...s, locked: s.locked.filter((id) => id !== row.player_id) };
      if (row.round_id !== s.round?.id || s.locked.includes(row.player_id)) return s;
      return { ...s, locked: [...s.locked, row.player_id] };
    }
  }
}

export async function loadPublicState(backend: Backend, roomId: string): Promise<PublicRoomState | null> {
  const room = await backend.getRoom(roomId);
  if (!room) return null;
  const [players, round] = await Promise.all([backend.getPlayers(roomId), backend.getLatestRound(roomId)]);
  const locks = round ? await backend.getLocks(round.id) : [];
  return { room, players, round, locked: locks.map((l) => l.player_id) };
}

/**
 * Subscribe first, then load, then replay anything that arrived during the load: no gap where a change is missed.
 * `onState` is called with the full state after every change. Returns a stop function.
 *
 * Safety net: realtime can silently drop events (sleeping phone, flaky wifi, a channel that reconnects without telling
 * us). So the state is also re-read from the database every `resyncSeconds`, when the page comes back, and when the
 * network returns. If the re-read differs from what we hold, `onState` gets the fresh state. A re-read that raced a
 * live change is thrown away (the live change is newer).
 */
export async function watchRoom(
  backend: Backend,
  roomId: string,
  onState: (s: PublicRoomState) => void,
  opts: { resyncSeconds?: number } = {},
): Promise<Unsubscribe> {
  let state: PublicRoomState | null = null;
  let version = 0;
  let stopped = false;
  const queued: Change[] = [];
  const unsub = await backend.subscribe(roomId, (c) => {
    if (!state) { queued.push(c); return; }
    version++;
    state = applyChange(state, c);
    onState(state);
  });
  const first = await loadPublicState(backend, roomId);
  if (!first) { await unsub(); throw new Error('room not found'); }
  state = queued.reduce(applyChange, first);
  onState(state);

  let resyncing = false;
  const resync = async () => {
    if (stopped || resyncing) return;
    resyncing = true;
    const seen = version;
    try {
      const fresh = await loadPublicState(backend, roomId);
      if (stopped || !fresh || seen !== version) return;
      if (JSON.stringify(fresh) !== JSON.stringify(state)) { version++; state = fresh; onState(fresh); }
    } catch { /* offline: the next tick tries again */ } finally { resyncing = false; }
  };
  const every = opts.resyncSeconds ?? CONFIG.net.resyncSeconds;
  const timer = every > 0 ? setInterval(() => void resync(), every * 1000) : undefined;
  // Realtime can say SUBSCRIBED slightly before changes flow, so a change right after start-up can be missed.
  // One early re-read closes that gap without waiting for the first regular tick.
  const early = every > 0 ? setTimeout(() => void resync(), CONFIG.net.firstResyncSeconds * 1000) : undefined;
  const onVisible = () => { if (typeof document === 'undefined' || document.visibilityState === 'visible') void resync(); };
  const onOnline = () => void resync();
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
  if (typeof window !== 'undefined') window.addEventListener('online', onOnline);

  return async () => {
    stopped = true;
    clearInterval(timer);
    clearTimeout(early);
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
    if (typeof window !== 'undefined') window.removeEventListener('online', onOnline);
    await unsub();
  };
}
