import { CONFIG, NAME_TAKEN_MESSAGE } from '../logic';
import type { Backend } from './backend';
import type { KV, StoredSeat } from './storage';
import { seatStore } from './storage';
import type { AnswerInput, JoinFailReason, JoinKind, MyState, SubmitRaw, Unsubscribe } from './types';

export const JOIN_MESSAGES: Record<JoinFailReason, string> = {
  'no-room': "We can't find that room. Check the code on the big screen.",
  empty: 'Please type a name.',
  'too-long': `That name is too long (max ${CONFIG.maxNameLength} letters).`,
  taken: NAME_TAKEN_MESSAGE,
  full: 'This room is full.',
};

export type JoinResult =
  | { ok: true; kind: JoinKind; seat: StoredSeat }
  | { ok: false; reason: JoinFailReason; message: string };

/**
 * Join a room from a phone. If this browser remembers a seat for the same room code it is offered first (so a
 * refresh puts the player back). Otherwise it joins by name: a name held by a connected player is rejected, a name
 * whose player has dropped is taken over. The seat is saved to storage on success.
 */
export async function joinGame(backend: Backend, kv: KV, a: { code: string; name: string }): Promise<JoinResult> {
  const store = seatStore(kv);
  const code = a.code.trim().toUpperCase();
  const remembered = store.load();
  const seatToken = remembered && remembered.code === code ? remembered.seatToken : null;
  const r = await backend.joinRoom({
    code, name: a.name, seatToken, maxPlayers: CONFIG.maxPlayers, maxNameLength: CONFIG.maxNameLength,
  });
  if (!r.ok) return { ok: false, reason: r.reason, message: JOIN_MESSAGES[r.reason] };
  const seat: StoredSeat = { code, roomId: r.room_id, playerId: r.player_id, seatToken: r.seat_token, name: r.name };
  store.save(seat);
  return { ok: true, kind: r.kind, seat };
}

/** On page load: the remembered seat plus fresh state, or null (and the stale seat is forgotten) if it is gone. */
export async function resumeSeat(backend: Backend, kv: KV, onlyCode = ''): Promise<{ seat: StoredSeat; state: MyState } | null> {
  const store = seatStore(kv);
  const seat = store.load();
  if (!seat) return null;
  // An address that names a different room (a new QR code) means "join that one", not "go back to the old seat".
  if (onlyCode && seat.code !== onlyCode) return null;
  const state = await backend.getMyState(seat.seatToken);
  if (!state) { store.clear(); return null; }
  // A rotated token (seat reclaimed elsewhere) fails the lookup above, so reaching here means the seat is still ours.
  await backend.seatPing(seat.seatToken, true);
  return { seat, state };
}

export function leaveSeat(kv: KV): void { seatStore(kv).clear(); }

export interface PhoneSession {
  seat: StoredSeat;
  submit(roundId: string, a: AnswerInput): Promise<SubmitRaw>;
  state(): Promise<MyState | null>;
  /** Stop presence and heartbeat, and tell the database this seat is away. */
  stop(): Promise<void>;
}

/** Keep a seat alive: presence (instant) plus a heartbeat (works even if the host screen is not open). */
export async function startPhoneSession(backend: Backend, seat: StoredSeat): Promise<PhoneSession> {
  const untrack = await backend.trackPresence(seat.code, seat.playerId);
  const beat = () => { void backend.seatPing(seat.seatToken, true).catch(() => undefined); };
  beat();
  const timer = setInterval(beat, CONFIG.net.heartbeatSeconds * 1000);
  let stopped = false;
  return {
    seat,
    submit: (roundId, a) => backend.submitAnswer(seat.seatToken, roundId, a),
    state: () => backend.getMyState(seat.seatToken),
    async stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      await (untrack as () => Promise<void> | void)();
      await backend.seatPing(seat.seatToken, false).catch(() => undefined);
    },
  };
}

export type { Unsubscribe };
