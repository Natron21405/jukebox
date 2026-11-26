import { decideJoin } from '../logic';
import type { Backend } from './backend';
import type {
  AnswerRow, Change, CreatedRoom, HostState, JoinRaw, LockRow, MyState, PlayerResult, PlayerRow, RoomRow, RoundRow,
} from './types';

/** Mirrors `private.seat_is_live` in the SQL: connected flag AND a heartbeat within this window. */
export const LIVE_WINDOW_MS = 60_000;
/** Mirrors the grace period in `host_set_connected`. */
export const PRESENCE_GRACE_MS = 10_000;

interface FakeRoom { row: RoomRow; hostToken: string }
interface FakeSeat { playerId: string; token: string; lastSeen: number }
interface FakeRound { row: RoundRow; songId: string }

export interface FakeBackend extends Backend {
  /** Test helpers. */
  advance(ms: number): void;
  /** Everything a phone could read with the anon key, for "no spoilers" assertions. */
  publicSnapshot(): string;
}

let counter = 0;
const uid = () => `00000000-0000-4000-8000-${(++counter).toString(16).padStart(12, '0')}`;
const tok = () => `tok${(++counter).toString(36)}${Math.random().toString(36).slice(2, 10)}`;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const forbidden = () => new Error('not_host');

/**
 * In-memory stand-in for the database + RPC layer. State lives in plain maps (like tables), so a "host reload" test
 * can throw away every client object and rebuild from the same fake. It reuses decideJoin for the name rules.
 */
export function createFakeBackend(start = Date.UTC(2026, 0, 1)): FakeBackend {
  let clock = start;
  const nowIso = () => new Date(clock).toISOString();

  const rooms = new Map<string, FakeRoom>();
  const players = new Map<string, PlayerRow>();
  const seats = new Map<string, FakeSeat>(); // by player id
  const rounds = new Map<string, FakeRound>();
  const locks: LockRow[] = [];
  const answers: AnswerRow[] = [];
  const history: { songId: string; roomId: string; game: number }[] = [];
  const blocked: { songId: string; roomId: string }[] = [];
  const subs = new Map<string, Set<(c: Change) => void>>();
  const present = new Map<string, Map<string, number>>(); // code -> playerId -> refcount
  const watchers = new Map<string, Set<(ids: string[]) => void>>();

  const emit = (roomId: string, c: Change) => subs.get(roomId)?.forEach((f) => f(clone(c)));
  const touch = (r: FakeRoom) => { r.row.updated_at = nowIso(); emit(r.row.id, { table: 'rooms', event: 'UPDATE', row: clone(r.row) }); };
  const setPlayer = (p: PlayerRow, patch: Partial<PlayerRow>) => {
    Object.assign(p, patch);
    emit(p.room_id, { table: 'players', event: 'UPDATE', row: clone(p) });
  };
  const host = (roomId: string, token: string) => {
    const r = rooms.get(roomId);
    if (!r || r.hostToken !== token) throw forbidden();
    return r;
  };
  const playerBySeat = (token: string) => {
    for (const [pid, s] of seats) if (s.token === token) return players.get(pid) ?? null;
    return null;
  };
  const roomPlayers = (roomId: string) => [...players.values()].filter((p) => p.room_id === roomId);
  const roomRounds = (roomId: string) => [...rounds.values()].filter((r) => r.row.room_id === roomId);
  const latest = (roomId: string) =>
    roomRounds(roomId).sort((a, b) => b.row.game_no - a.row.game_no || b.row.round_no - a.row.round_no)[0] ?? null;
  const live = (p: PlayerRow) => p.connected && clock - (seats.get(p.id)?.lastSeen ?? 0) < LIVE_WINDOW_MS;
  const applyPlayers = (roomId: string, list: PlayerResult[] | null | undefined) => {
    for (const x of list ?? []) {
      const p = players.get(x.id);
      if (!p || p.room_id !== roomId) continue;
      setPlayer(p, {
        score: x.score ?? p.score,
        artist_hits: x.artist_hits ?? p.artist_hits,
        timeline: x.timeline ? clone(x.timeline) : p.timeline,
      });
    }
  };
  const presentIds = (code: string) => [...(present.get(code)?.keys() ?? [])];
  const notifyPresence = (code: string) => watchers.get(code)?.forEach((f) => f(presentIds(code)));

  const api: FakeBackend = {
    advance(ms) { clock += ms; },
    publicSnapshot() {
      return JSON.stringify({
        rooms: [...rooms.values()].map((r) => r.row),
        players: [...players.values()],
        rounds: [...rounds.values()].map((r) => r.row),
        locks,
      });
    },

    async createRoom(mode, settings): Promise<CreatedRoom> {
      const id = uid();
      let code = '';
      do { code = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)]).join(''); }
      while ([...rooms.values()].some((r) => r.row.code === code));
      const row: RoomRow = {
        id, code, mode, status: 'lobby', game_no: 1, round_no: 0, settings: clone(settings ?? {}),
        created_at: nowIso(), updated_at: nowIso(),
      };
      const hostToken = tok();
      rooms.set(id, { row, hostToken });
      return { room_id: id, code, host_token: hostToken };
    },

    async getRoomByCode(code) {
      const r = [...rooms.values()].find((x) => x.row.code === code.trim().toUpperCase());
      return r ? clone(r.row) : null;
    },
    async getRoom(id) { const r = rooms.get(id); return r ? clone(r.row) : null; },
    async getPlayers(roomId) { return clone(roomPlayers(roomId)); },
    async getLatestRound(roomId) { const r = latest(roomId); return r ? clone(r.row) : null; },
    async getLocks(roundId) { return clone(locks.filter((l) => l.round_id === roundId)); },

    async subscribe(roomId, onChange) {
      if (!subs.has(roomId)) subs.set(roomId, new Set());
      subs.get(roomId)!.add(onChange);
      return () => { subs.get(roomId)?.delete(onChange); };
    },

    async trackPresence(code, playerId) {
      const c = code.toUpperCase();
      if (!present.has(c)) present.set(c, new Map());
      const m = present.get(c)!;
      m.set(playerId, (m.get(playerId) ?? 0) + 1);
      notifyPresence(c);
      return () => {
        const n = (m.get(playerId) ?? 1) - 1;
        if (n <= 0) m.delete(playerId); else m.set(playerId, n);
        notifyPresence(c);
      };
    },
    async watchPresence(code, onPresent) {
      const c = code.toUpperCase();
      if (!watchers.has(c)) watchers.set(c, new Set());
      watchers.get(c)!.add(onPresent);
      onPresent(presentIds(c));
      return () => { watchers.get(c)?.delete(onPresent); };
    },

    async joinRoom({ code, name, seatToken, maxPlayers, maxNameLength }): Promise<JoinRaw> {
      const room = [...rooms.values()].find((r) => r.row.code === code.trim().toUpperCase());
      if (!room) return { ok: false, reason: 'no-room' };
      const roomId = room.row.id;

      if (seatToken) {
        const mine = playerBySeat(seatToken);
        if (mine && mine.room_id === roomId) {
          seats.get(mine.id)!.lastSeen = clock;
          if (!mine.connected) setPlayer(mine, { connected: true });
          return { ok: true, kind: 'resumed', room_id: roomId, player_id: mine.id, seat_token: seatToken, name: mine.name };
        }
      }

      const clean = name.trim().replace(/\s+/g, ' ');
      const list = roomPlayers(roomId);
      // decideJoin uses CONFIG limits; the explicit limits passed in are checked as well, like the SQL does.
      const d = decideJoin(list.map((p) => ({ id: p.id, name: p.name, connected: live(p) })), clean);
      if (d.kind === 'rejected') return { ok: false, reason: d.reason };
      if (clean.length > maxNameLength) return { ok: false, reason: 'too-long' };
      if (d.kind === 'reclaim') {
        const p = players.get(d.seatId)!;
        const s = seats.get(p.id)!;
        s.token = tok(); s.lastSeen = clock;
        setPlayer(p, { connected: true });
        return { ok: true, kind: 'reclaimed', room_id: roomId, player_id: p.id, seat_token: s.token, name: p.name };
      }
      if (list.length >= maxPlayers) return { ok: false, reason: 'full' };
      const p: PlayerRow = {
        id: uid(), room_id: roomId, name: clean, connected: true, score: 0, artist_hits: 0, timeline: [], joined_at: nowIso(),
      };
      players.set(p.id, p);
      const s: FakeSeat = { playerId: p.id, token: tok(), lastSeen: clock };
      seats.set(p.id, s);
      emit(roomId, { table: 'players', event: 'INSERT', row: clone(p) });
      return { ok: true, kind: 'new', room_id: roomId, player_id: p.id, seat_token: s.token, name: p.name };
    },

    async seatPing(token, connected) {
      const p = playerBySeat(token);
      if (!p) return false;
      seats.get(p.id)!.lastSeen = clock;
      if (p.connected !== connected) setPlayer(p, { connected });
      return true;
    },

    async getMyState(token): Promise<MyState | null> {
      const p = playerBySeat(token);
      if (!p) return null;
      const room = rooms.get(p.room_id)!.row;
      const r = latest(room.id);
      const a = r ? answers.find((x) => x.round_id === r.row.id && x.player_id === p.id) : undefined;
      return clone({ player: p, room, round: r ? r.row : null, answer: a ?? null });
    },

    async submitAnswer(token, roundId, a) {
      const p = playerBySeat(token);
      if (!p) return { ok: false, reason: 'no-seat' };
      const r = rounds.get(roundId);
      if (!r || r.row.room_id !== p.room_id) return { ok: false, reason: 'no-round' };
      if (r.row.status !== 'open') return { ok: false, reason: 'round-closed' };
      let row = answers.find((x) => x.round_id === roundId && x.player_id === p.id);
      if (row?.locked) return { ok: false, reason: 'already-locked' };
      const next: AnswerRow = {
        round_id: roundId, player_id: p.id, slot: a.slot ?? null, year: a.year ?? null,
        artist_guess: (a.artist ?? '').slice(0, 100), locked: a.lock ?? false, artist_override: row?.artist_override ?? null,
      };
      if (row) Object.assign(row, next); else { row = next; answers.push(row); }
      if (next.locked && !locks.some((l) => l.round_id === roundId && l.player_id === p.id)) {
        const l: LockRow = { round_id: roundId, player_id: p.id, room_id: p.room_id };
        locks.push(l);
        emit(p.room_id, { table: 'round_locks', event: 'INSERT', row: clone(l) });
      }
      return { ok: true, locked: next.locked };
    },

    async hostGetState(roomId, token): Promise<HostState> {
      const room = host(roomId, token);
      const r = latest(roomId);
      const game = room.row.game_no;
      const here = history.filter((h) => h.roomId === roomId && h.game === game).map((h) => h.songId);
      const earlier = history.filter((h) => h.roomId !== roomId || h.game !== game).map((h) => h.songId);
      return clone({
        room: room.row,
        players: roomPlayers(roomId),
        round: r ? { ...r.row, song_id: r.songId } : null,
        answers: r ? answers.filter((a) => a.round_id === r.row.id) : [],
        locked_player_ids: r ? locks.filter((l) => l.round_id === r.row.id).map((l) => l.player_id) : [],
        played_this_game: [...new Set(here)],
        played_earlier: [...new Set(earlier)],
        blocked: blocked.map((b) => b.songId),
      });
    },
    async hostGetAnswers(roomId, token, roundId) {
      host(roomId, token);
      const r = rounds.get(roundId);
      return r && r.row.room_id === roomId ? clone(answers.filter((a) => a.round_id === roundId)) : [];
    },
    async hostUpdateRoom(roomId, token, patch) {
      const room = host(roomId, token);
      if (patch.mode) room.row.mode = patch.mode;
      if (patch.status) room.row.status = patch.status;
      if (patch.settings) room.row.settings = { ...room.row.settings, ...clone(patch.settings) };
      touch(room);
      return clone(room.row);
    },
    async hostStartRound(roomId, token, a) {
      const room = host(roomId, token);
      for (const r of roomRounds(roomId)) {
        if (r.row.status === 'open' || r.row.status === 'closed') {
          r.row.status = 'skipped';
          emit(roomId, { table: 'rounds', event: 'UPDATE', row: clone(r.row) });
        }
      }
      room.row.round_no += 1;
      room.row.status = 'playing';
      touch(room);
      const row: RoundRow = {
        id: uid(), room_id: roomId, game_no: room.row.game_no, round_no: room.row.round_no, kind: a.kind ?? 'normal',
        status: 'open', started_at: nowIso(), ends_at: new Date(clock + (a.seconds ?? 40) * 1000).toISOString(), reveal: null,
      };
      rounds.set(row.id, { row, songId: a.songId });
      history.push({ songId: a.songId, roomId, game: room.row.game_no });
      emit(roomId, { table: 'rounds', event: 'INSERT', row: clone(row) });
      return clone({ ...row, song_id: a.songId });
    },
    async hostCloseRound(roomId, token, roundId, status = 'closed') {
      const room = host(roomId, token);
      const r = rounds.get(roundId);
      touch(room);
      if (!r || r.row.room_id !== roomId || (r.row.status !== 'open' && r.row.status !== 'closed')) return null;
      r.row.status = status;
      emit(roomId, { table: 'rounds', event: 'UPDATE', row: clone(r.row) });
      return clone(r.row);
    },
    async hostRevealRound(roomId, token, roundId, reveal, list) {
      const room = host(roomId, token);
      const r = rounds.get(roundId);
      if (!r || r.row.room_id !== roomId || r.row.status === 'skipped') throw new Error('no_such_round');
      r.row.status = 'revealed';
      r.row.reveal = clone(reveal);
      applyPlayers(roomId, list);
      emit(roomId, { table: 'rounds', event: 'UPDATE', row: clone(r.row) });
      touch(room);
      return clone(r.row);
    },
    async hostUpdatePlayers(roomId, token, list) { const room = host(roomId, token); applyPlayers(roomId, list); touch(room); },
    async hostSetOverride(roomId, token, roundId, playerId, value) {
      host(roomId, token);
      const r = rounds.get(roundId);
      const a = answers.find((x) => x.round_id === roundId && x.player_id === playerId);
      if (!a || !r || r.row.room_id !== roomId) return false;
      a.artist_override = value;
      return true;
    },
    async hostSetConnected(roomId, token, ids) {
      host(roomId, token);
      for (const p of roomPlayers(roomId)) {
        const here = ids.includes(p.id);
        if (here && !p.connected) setPlayer(p, { connected: true });
        else if (!here && p.connected && clock - (seats.get(p.id)?.lastSeen ?? 0) > PRESENCE_GRACE_MS) setPlayer(p, { connected: false });
      }
    },
    async hostKickPlayer(roomId, token, playerId) {
      host(roomId, token);
      const p = players.get(playerId);
      if (!p || p.room_id !== roomId) return;
      players.delete(playerId); seats.delete(playerId);
      for (let i = locks.length - 1; i >= 0; i--) if (locks[i].player_id === playerId) locks.splice(i, 1);
      for (let i = answers.length - 1; i >= 0; i--) if (answers[i].player_id === playerId) answers.splice(i, 1);
      emit(roomId, { table: 'players', event: 'DELETE', row: clone(p) });
    },
    async hostBlockSong(roomId, token, songId) {
      host(roomId, token);
      if (!blocked.some((b) => b.songId === songId)) blocked.push({ songId, roomId });
    },
    async hostUnblockSong(roomId, token, songId) {
      host(roomId, token);
      const i = blocked.findIndex((b) => b.songId === songId);
      if (i >= 0) blocked.splice(i, 1);
    },
    async hostResetPlayed(roomId, token) {
      const room = host(roomId, token);
      const keep = history.filter((h) => h.roomId === roomId && h.game === room.row.game_no);
      const removed = history.length - keep.length;
      history.splice(0, history.length, ...keep);
      return removed;
    },
    async hostNewGame(roomId, token) {
      const room = host(roomId, token);
      room.row.game_no += 1; room.row.round_no = 0; room.row.status = 'lobby';
      for (const p of roomPlayers(roomId)) setPlayer(p, { score: 0, artist_hits: 0, timeline: [] });
      touch(room);
      return clone(room.row);
    },
    async hostDeleteRoom(roomId, token, keep = false) {
      host(roomId, token);
      if (!keep) {
        for (let i = history.length - 1; i >= 0; i--) if (history[i].roomId === roomId) history.splice(i, 1);
        for (let i = blocked.length - 1; i >= 0; i--) if (blocked[i].roomId === roomId) blocked.splice(i, 1);
      }
      for (const r of roomRounds(roomId)) rounds.delete(r.row.id);
      for (const p of roomPlayers(roomId)) { players.delete(p.id); seats.delete(p.id); }
      for (let i = locks.length - 1; i >= 0; i--) if (locks[i].room_id === roomId) locks.splice(i, 1);
      rooms.delete(roomId);
    },
  };
  return api;
}
