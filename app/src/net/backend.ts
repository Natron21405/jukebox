import type {
  AnswerInput, AnswerRow, Change, CreatedRoom, HostState, JoinRaw, LockRow, Mode, MyState,
  PlayerResult, PlayerRow, RoomRow, RoomStatus, RoundRow, SubmitRaw, Unsubscribe,
} from './types';

/**
 * The thin seam between game code and Supabase. `supabaseBackend.ts` implements it over RPC + Realtime;
 * `fakeBackend.ts` implements it in memory for tests. Nothing else in `net/` imports supabase-js.
 */
export interface Backend {
  // ---- rooms
  createRoom(mode: Mode, settings: Record<string, unknown>): Promise<CreatedRoom>;

  // ---- public reads (rooms, players, rounds, round_locks are world-readable by design)
  getRoomByCode(code: string): Promise<RoomRow | null>;
  getRoom(roomId: string): Promise<RoomRow | null>;
  getPlayers(roomId: string): Promise<PlayerRow[]>;
  getLatestRound(roomId: string): Promise<RoundRow | null>;
  getLocks(roundId: string): Promise<LockRow[]>;
  /** Row changes for one room. Resolves once the subscription is live. */
  subscribe(roomId: string, onChange: (c: Change) => void): Promise<Unsubscribe>;

  // ---- presence (who has a page open right now)
  /** Phones call this with their player id; leaving or closing the page removes them. */
  trackPresence(code: string, playerId: string): Promise<Unsubscribe>;
  /** The host listens: called with the set of player ids currently present. */
  watchPresence(code: string, onPresent: (playerIds: string[]) => void): Promise<Unsubscribe>;

  // ---- phones (seat token)
  joinRoom(a: { code: string; name: string; seatToken?: string | null; maxPlayers: number; maxNameLength: number }): Promise<JoinRaw>;
  seatPing(seatToken: string, connected: boolean): Promise<boolean>;
  getMyState(seatToken: string): Promise<MyState | null>;
  submitAnswer(seatToken: string, roundId: string, a: AnswerInput): Promise<SubmitRaw>;

  // ---- host (host token)
  hostGetState(roomId: string, token: string): Promise<HostState>;
  hostGetAnswers(roomId: string, token: string, roundId: string): Promise<AnswerRow[]>;
  hostUpdateRoom(roomId: string, token: string, patch: { mode?: Mode; status?: RoomStatus; settings?: Record<string, unknown> }): Promise<RoomRow>;
  hostStartRound(roomId: string, token: string, a: { songId: string; kind?: 'normal' | 'sudden_death'; seconds?: number }): Promise<RoundRow & { song_id: string }>;
  hostCloseRound(roomId: string, token: string, roundId: string, status?: 'closed' | 'skipped'): Promise<RoundRow | null>;
  hostRevealRound(roomId: string, token: string, roundId: string, reveal: unknown, players?: PlayerResult[]): Promise<RoundRow>;
  hostUpdatePlayers(roomId: string, token: string, players: PlayerResult[]): Promise<void>;
  hostSetOverride(roomId: string, token: string, roundId: string, playerId: string, value: boolean | null): Promise<boolean>;
  hostSetConnected(roomId: string, token: string, connectedIds: string[]): Promise<void>;
  hostBlockSong(roomId: string, token: string, songId: string): Promise<void>;
  hostUnblockSong(roomId: string, token: string, songId: string): Promise<void>;
  hostResetPlayed(roomId: string, token: string): Promise<number>;
  hostNewGame(roomId: string, token: string): Promise<RoomRow>;
  hostDeleteRoom(roomId: string, token: string, keepHistory?: boolean): Promise<void>;
}
