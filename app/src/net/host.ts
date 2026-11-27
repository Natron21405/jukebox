import { CONFIG } from '../logic';
import type { Backend } from './backend';
import type { StoredHost } from './storage';
import type { Mode, HostState, PlayerResult, RoomRow, RoundRow } from './types';

/** Create a room. The credentials live only in the host page's memory: a refresh ends the game, as in Jackbox. */
export async function createHostRoom(backend: Backend, mode: Mode, settings: Record<string, unknown> = {}): Promise<StoredHost> {
  const r = await backend.createRoom(mode, settings);
  return { code: r.code, roomId: r.room_id, hostToken: r.host_token };
}

/** Every host-only operation, with the room id and token filled in. */
export class HostSession {
  constructor(private readonly backend: Backend, readonly creds: StoredHost) {}
  private get a(): [string, string] { return [this.creds.roomId, this.creds.hostToken]; }

  state(): Promise<HostState> { return this.backend.hostGetState(...this.a); }
  answers(roundId: string) { return this.backend.hostGetAnswers(...this.a, roundId); }
  updateRoom(patch: { mode?: Mode; status?: RoomRow['status']; settings?: Record<string, unknown> }) {
    return this.backend.hostUpdateRoom(...this.a, patch);
  }
  startRound(songId: string, o: { kind?: 'normal' | 'sudden_death'; seconds?: number } = {}) {
    return this.backend.hostStartRound(...this.a, { songId, kind: o.kind, seconds: o.seconds ?? CONFIG.roundSeconds });
  }
  closeRound(roundId: string, status: 'closed' | 'skipped' = 'closed'): Promise<RoundRow | null> {
    return this.backend.hostCloseRound(...this.a, roundId, status);
  }
  /** Publishes the song details and writes the new scores and timelines in one step. */
  reveal(roundId: string, reveal: unknown, players?: PlayerResult[]) {
    return this.backend.hostRevealRound(...this.a, roundId, reveal, players);
  }
  updatePlayers(players: PlayerResult[]) { return this.backend.hostUpdatePlayers(...this.a, players); }
  setArtistOverride(roundId: string, playerId: string, value: boolean | null) {
    return this.backend.hostSetOverride(...this.a, roundId, playerId, value);
  }
  /** Remove a player (lobby kick). Their phone drops back to the join screen. */
  kickPlayer(playerId: string) { return this.backend.hostKickPlayer(...this.a, playerId); }
  blockSong(songId: string) { return this.backend.hostBlockSong(...this.a, songId); }
  unblockSong(songId: string) { return this.backend.hostUnblockSong(...this.a, songId); }
  resetPlayed() { return this.backend.hostResetPlayed(...this.a); }
  newGame() { return this.backend.hostNewGame(...this.a); }
  deleteRoom(keepHistory = false) { return this.backend.hostDeleteRoom(...this.a, keepHistory); }

  /**
   * Mirror presence into players.connected: on every presence change and on a timer (so seats that stayed silent
   * past the database grace period are flipped later). Returns a stop function.
   */
  async mirrorPresence(): Promise<() => Promise<void>> {
    let ids: string[] = [];
    const push = () => { void this.backend.hostSetConnected(...this.a, ids).catch(() => undefined); };
    const unwatch = await this.backend.watchPresence(this.creds.code, (present) => { ids = present; push(); });
    const timer = setInterval(push, CONFIG.net.presenceSyncSeconds * 1000);
    return async () => { clearInterval(timer); await unwatch(); };
  }
}
