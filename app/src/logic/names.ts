import { CONFIG } from './config';

export interface Seat {
  id: string;
  name: string;
  connected: boolean;
}

export const NAME_TAKEN_MESSAGE = 'That name is already taken, please choose another.';

export type JoinDecision =
  | { kind: 'new' }
  | { kind: 'reclaim'; seatId: string }
  | { kind: 'rejected'; reason: 'empty' | 'too-long' | 'taken' | 'full' };

export const nameKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Join by name (used when the phone has lost its remembered seat).
 * A name held by a currently connected player is rejected; a disconnected seat is taken back.
 */
export function decideJoin(seats: readonly Seat[], name: string): JoinDecision {
  const key = nameKey(name);
  if (!key) return { kind: 'rejected', reason: 'empty' };
  if (key.length > CONFIG.maxNameLength) return { kind: 'rejected', reason: 'too-long' };
  const existing = seats.find((s) => nameKey(s.name) === key);
  if (existing) {
    return existing.connected ? { kind: 'rejected', reason: 'taken' } : { kind: 'reclaim', seatId: existing.id };
  }
  if (seats.length >= CONFIG.maxPlayers) return { kind: 'rejected', reason: 'full' };
  return { kind: 'new' };
}
