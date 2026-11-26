import type { Card } from '../logic';

export type Mode = 'timeline' | 'closest_year';
export type RoomStatus = 'lobby' | 'playing' | 'over';
export type RoundStatus = 'open' | 'closed' | 'revealed' | 'skipped';
export type RoundKind = 'normal' | 'sudden_death';

/** Rows as stored (snake_case, exactly what the database returns). */
export interface RoomRow {
  id: string;
  code: string;
  mode: Mode;
  status: RoomStatus;
  game_no: number;
  round_no: number;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface PlayerRow {
  id: string;
  room_id: string;
  name: string;
  connected: boolean;
  score: number;
  artist_hits: number;
  timeline: Card[];
  joined_at: string;
}

/** Public round row. `reveal` stays null until the host reveals the round; it never holds anything before that. */
export interface RoundRow {
  id: string;
  room_id: string;
  game_no: number;
  round_no: number;
  kind: RoundKind;
  status: RoundStatus;
  started_at: string;
  ends_at: string | null;
  reveal: unknown | null;
}

export interface LockRow {
  round_id: string;
  player_id: string;
  room_id: string;
}

export interface AnswerRow {
  round_id: string;
  player_id: string;
  slot: number | null;
  year: number | null;
  artist_guess: string;
  locked: boolean;
  artist_override: boolean | null;
}

export interface AnswerInput {
  slot?: number | null;
  year?: number | null;
  artist?: string;
  lock?: boolean;
}

export interface PlayerResult {
  id: string;
  score?: number;
  artist_hits?: number;
  timeline?: Card[];
}

export type JoinFailReason = 'no-room' | 'empty' | 'too-long' | 'taken' | 'full';
export type JoinKind = 'new' | 'resumed' | 'reclaimed';

/** What the backend returns for a join attempt. */
export type JoinRaw =
  | { ok: true; kind: JoinKind; room_id: string; player_id: string; seat_token: string; name: string }
  | { ok: false; reason: JoinFailReason };

export type SubmitRaw = { ok: true; locked: boolean } | { ok: false; reason: 'no-seat' | 'no-round' | 'round-closed' | 'already-locked' };

export interface CreatedRoom {
  room_id: string;
  code: string;
  host_token: string;
}

/** What a phone gets to rebuild itself: never the song, never other players' answers. */
export interface MyState {
  player: PlayerRow;
  room: RoomRow;
  round: RoundRow | null;
  answer: AnswerRow | null;
}

/** What the host screen gets to rebuild itself (includes the secret current song id and all answers). */
export interface HostState {
  room: RoomRow;
  players: PlayerRow[];
  round: (RoundRow & { song_id: string }) | null;
  answers: AnswerRow[];
  locked_player_ids: string[];
  played_this_game: string[];
  played_earlier: string[];
  blocked: string[];
}

export type Change =
  | { table: 'rooms'; event: 'INSERT' | 'UPDATE' | 'DELETE'; row: RoomRow }
  | { table: 'players'; event: 'INSERT' | 'UPDATE' | 'DELETE'; row: PlayerRow }
  | { table: 'rounds'; event: 'INSERT' | 'UPDATE' | 'DELETE'; row: RoundRow }
  | { table: 'round_locks'; event: 'INSERT' | 'UPDATE' | 'DELETE'; row: LockRow };

export type Unsubscribe = () => void | Promise<void>;
