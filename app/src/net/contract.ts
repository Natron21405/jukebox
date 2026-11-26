import { afterEach, describe, expect, it } from 'vitest';
import { CONFIG, NAME_TAKEN_MESSAGE } from '../logic';
import type { Backend } from './backend';
import { createHostRoom, HostSession, resumeHost } from './host';
import { memoryKV } from './storage';
import { joinGame, resumeSeat, startPhoneSession } from './room';
import { loadPublicState, watchRoom, type PublicRoomState } from './watch';

/** Opaque made-up ids, never real songs. */
export const SONG_A = 'test-001';
export const SONG_B = 'test-002';

export async function until<T>(read: () => T | Promise<T>, ok: (v: T) => boolean, ms = 8000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await read();
    if (ok(v)) return v;
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 100));
  }
}

/**
 * The behaviour every Backend must have. Run against the in-memory fake (fast, always) and against the real
 * Supabase project (throwaway rooms, deleted afterwards), so the fake cannot drift from the database.
 */
export function backendContract(label: string, make: () => Backend, opts: { after?: () => Promise<void>; makeOther?: () => Backend } = {}) {
  describe(`backend contract: ${label}`, () => {
    const backend = make();
    const cleanups: Array<() => Promise<unknown> | unknown> = [];
    const rooms: Array<{ roomId: string; hostToken: string }> = [];

    const newRoom = async () => {
      const kv = memoryKV();
      const creds = await createHostRoom(backend, kv, 'timeline', { marker: 'net-test' });
      rooms.push({ roomId: creds.roomId, hostToken: creds.hostToken });
      return { creds, kv, host: new HostSession(backend, creds) };
    };
    const phone = async (code: string, name: string, kv = memoryKV()) => {
      const r = await joinGame(backend, kv, { code, name });
      return { r, kv };
    };

    afterEach(async () => {
      for (const c of cleanups.splice(0).reverse()) await c();
    });
    // Delete throwaway rooms last (a failing test must not leave data behind).
    afterEach(async () => {
      for (const r of rooms.splice(0)) await backend.hostDeleteRoom(r.roomId, r.hostToken).catch(() => undefined);
    });
    it('creates a room with a short code that anyone can look up, case-insensitively', async () => {
      const { creds } = await newRoom();
      expect(creds.code).toMatch(/^[A-Z]{4}$/);
      const room = await backend.getRoomByCode(creds.code.toLowerCase());
      expect(room?.id).toBe(creds.roomId);
      expect(room?.status).toBe('lobby');
    });

    it('joins a new player and remembers the seat', async () => {
      const { creds } = await newRoom();
      const { r, kv } = await phone(creds.code, '  Ana   Test ');
      expect(r.ok && r.kind).toBe('new');
      if (!r.ok) return;
      expect(r.seat.name).toBe('Ana Test');
      expect((await backend.getPlayers(creds.roomId)).map((p) => p.name)).toEqual(['Ana Test']);
      // Refresh: same storage, same seat, no name needed.
      const back = await resumeSeat(backend, kv);
      expect(back?.seat.playerId).toBe(r.seat.playerId);
      expect(back?.state.room.id).toBe(creds.roomId);
    });

    it('rejects an unknown room, an empty name and an over-long name with friendly messages', async () => {
      const { creds } = await newRoom();
      if (!(await backend.getRoomByCode('QQQQ'))) {
        const none = await phone('QQQQ', 'Ana');
        expect(!none.r.ok && none.r.reason).toBe('no-room');
      }
      const empty = await phone(creds.code, '   ');
      expect(!empty.r.ok && empty.r.reason).toBe('empty');
      const long = await phone(creds.code, 'x'.repeat(CONFIG.maxNameLength + 1));
      expect(!long.r.ok && long.r.reason).toBe('too-long');
      expect(await backend.getPlayers(creds.roomId)).toHaveLength(0);
    });

    it('rejects a name used by a connected player (case and spacing ignored)', async () => {
      const { creds } = await newRoom();
      const first = await phone(creds.code, 'Sam');
      expect(first.r.ok).toBe(true);
      const dup = await phone(creds.code, ' sAM ');
      expect(dup.r.ok).toBe(false);
      if (!dup.r.ok) {
        expect(dup.r.reason).toBe('taken');
        expect(dup.r.message).toBe(NAME_TAKEN_MESSAGE);
      }
      expect(await backend.getPlayers(creds.roomId)).toHaveLength(1);
    });

    it('lets a disconnected player take the seat back by name; the old token stops working', async () => {
      const { creds } = await newRoom();
      const a = await phone(creds.code, 'Robin');
      if (!a.r.ok) throw new Error('join failed');
      await backend.seatPing(a.r.seat.seatToken, false); // phone closed
      const b = await phone(creds.code, 'robin'); // new browser, no stored seat
      expect(b.r.ok && b.r.kind).toBe('reclaimed');
      if (!b.r.ok) return;
      expect(b.r.seat.playerId).toBe(a.r.seat.playerId);
      expect(b.r.seat.seatToken).not.toBe(a.r.seat.seatToken);
      expect(await backend.getMyState(a.r.seat.seatToken)).toBeNull();
      expect((await backend.getMyState(b.r.seat.seatToken))?.player.connected).toBe(true);
      expect(await backend.getPlayers(creds.roomId)).toHaveLength(1);
      // And now the name is held again.
      const c = await phone(creds.code, 'Robin');
      expect(!c.r.ok && c.r.reason).toBe('taken');
    });

    it('resumes with the remembered seat even if the flag says disconnected', async () => {
      const { creds } = await newRoom();
      const a = await phone(creds.code, 'Kim');
      if (!a.r.ok) throw new Error('join failed');
      await backend.seatPing(a.r.seat.seatToken, false);
      const again = await joinGame(backend, a.kv, { code: creds.code, name: 'whatever' });
      expect(again.ok && again.kind).toBe('resumed');
      if (again.ok) expect(again.seat.seatToken).toBe(a.r.seat.seatToken);
      expect((await backend.getPlayers(creds.roomId))[0].connected).toBe(true);
    });

    it('stops at the player limit', async () => {
      const { creds } = await newRoom();
      for (const n of ['One', 'Two']) {
        const r = await backend.joinRoom({ code: creds.code, name: n, maxPlayers: 2, maxNameLength: 20 });
        expect(r.ok).toBe(true);
      }
      const third = await backend.joinRoom({ code: creds.code, name: 'Three', maxPlayers: 2, maxNameLength: 20 });
      expect(third).toEqual({ ok: false, reason: 'full' });
    });

    it('shows a started round to phones without the song, then publishes the reveal', async () => {
      const { creds, host } = await newRoom();
      const a = await phone(creds.code, 'Pat');
      if (!a.r.ok) throw new Error('join failed');
      const round = await host.startRound(SONG_A);
      expect(round.song_id).toBe(SONG_A);

      const pub = await backend.getLatestRound(creds.roomId);
      expect(pub?.status).toBe('open');
      expect(pub?.reveal).toBeNull();
      expect(JSON.stringify(pub)).not.toContain(SONG_A);
      const mine = await backend.getMyState(a.r.seat.seatToken);
      expect(JSON.stringify(mine)).not.toContain(SONG_A);

      await host.closeRound(round.id);
      await host.reveal(round.id, { title: 'Made Up', artist: 'Nobody', year: 1999 }, [
        { id: a.r.seat.playerId, score: 3, timeline: [{ year: 1999, songId: SONG_A }] },
      ]);
      const after = await backend.getLatestRound(creds.roomId);
      expect(after?.status).toBe('revealed');
      expect(after?.reveal).toEqual({ title: 'Made Up', artist: 'Nobody', year: 1999 });
      const p = (await backend.getPlayers(creds.roomId))[0];
      expect(p.score).toBe(3);
      expect(p.timeline).toEqual([{ year: 1999, songId: SONG_A }]);
    });

    it('takes answers until locked and the round closes; the host sees them, others do not', async () => {
      const { creds, host } = await newRoom();
      const a = await phone(creds.code, 'Ann');
      const b = await phone(creds.code, 'Bo');
      if (!a.r.ok || !b.r.ok) throw new Error('join failed');
      const round = await host.startRound(SONG_A);

      expect(await backend.submitAnswer(a.r.seat.seatToken, round.id, { slot: 1, artist: 'guess one' })).toEqual({ ok: true, locked: false });
      expect(await backend.submitAnswer(a.r.seat.seatToken, round.id, { slot: 2, artist: 'guess two', lock: true })).toEqual({ ok: true, locked: true });
      expect(await backend.submitAnswer(a.r.seat.seatToken, round.id, { slot: 0 })).toEqual({ ok: false, reason: 'already-locked' });
      expect(await backend.submitAnswer('not-a-token', round.id, { slot: 0 })).toEqual({ ok: false, reason: 'no-seat' });

      expect((await backend.getLocks(round.id)).map((l) => l.player_id)).toEqual([a.r.seat.playerId]);
      const mine = await backend.getMyState(a.r.seat.seatToken);
      expect(mine?.answer).toMatchObject({ slot: 2, artist_guess: 'guess two', locked: true });
      expect((await backend.getMyState(b.r.seat.seatToken))?.answer).toBeNull();

      const answers = await host.answers(round.id);
      expect(answers).toHaveLength(1);
      expect(answers[0]).toMatchObject({ player_id: a.r.seat.playerId, slot: 2, artist_guess: 'guess two' });
      expect(await host.setArtistOverride(round.id, a.r.seat.playerId, true)).toBe(true);
      expect((await host.answers(round.id))[0].artist_override).toBe(true);

      await host.closeRound(round.id);
      expect(await backend.submitAnswer(b.r.seat.seatToken, round.id, { slot: 0 })).toEqual({ ok: false, reason: 'round-closed' });
    });

    it('rejects host actions without the right token', async () => {
      const { creds } = await newRoom();
      const other = await newRoom();
      await expect(backend.hostGetState(creds.roomId, 'wrong')).rejects.toThrow();
      await expect(backend.hostGetState(creds.roomId, other.creds.hostToken)).rejects.toThrow();
      await expect(backend.hostStartRound(creds.roomId, 'wrong', { songId: SONG_A })).rejects.toThrow();
      expect(await backend.getLatestRound(creds.roomId)).toBeNull();
    });

    it('rebuilds the host screen from the database after a reload', async () => {
      const { creds, kv, host } = await newRoom();
      const a = await phone(creds.code, 'Ann');
      const b = await phone(creds.code, 'Bo');
      if (!a.r.ok || !b.r.ok) throw new Error('join failed');
      const r1 = await host.startRound(SONG_A);
      await host.closeRound(r1.id);
      await host.reveal(r1.id, { note: 'first' }, [{ id: a.r.seat.playerId, score: 2, artist_hits: 1, timeline: [{ year: 2001, songId: SONG_A }] }]);
      const r2 = await host.startRound(SONG_B);
      await backend.submitAnswer(b.r.seat.seatToken, r2.id, { slot: 0, artist: 'x', lock: true });
      await host.blockSong('test-blocked');

      // "Reload": every in-memory object is gone, only storage (the credentials) survives.
      const resumed = await resumeHost(backend, kv);
      if (!resumed) throw new Error('resume failed');
      const s = resumed.state;
      expect(s.room.id).toBe(creds.roomId);
      expect(s.room.round_no).toBe(2);
      expect(s.room.status).toBe('playing');
      expect(s.players.map((p) => p.name).sort()).toEqual(['Ann', 'Bo']);
      expect(s.players.find((p) => p.name === 'Ann')).toMatchObject({ score: 2, artist_hits: 1, timeline: [{ year: 2001, songId: SONG_A }] });
      expect(s.round).toMatchObject({ id: r2.id, status: 'open', song_id: SONG_B, round_no: 2 });
      expect(s.answers).toHaveLength(1);
      expect(s.locked_player_ids).toEqual([b.r.seat.playerId]);
      expect(s.played_this_game.sort()).toEqual([SONG_A, SONG_B]);
      expect(s.blocked).toContain('test-blocked');
    });

    it('forgets a deleted room when the host reloads', async () => {
      const { kv, host } = await newRoom();
      await host.deleteRoom();
      expect(await resumeHost(backend, kv)).toBeNull();
      expect(kv.getItem('jukebox.host')).toBeNull();
    });

    it('lets the host kick a player: the seat is gone and the name is free again', async () => {
      const { creds, host } = await newRoom();
      const a = await phone(creds.code, 'Kick Me');
      if (!a.r.ok) throw new Error('join failed');
      await host.kickPlayer(a.r.seat.playerId);
      expect((await host.state()).players).toHaveLength(0);
      expect(await backend.getMyState(a.r.seat.seatToken)).toBeNull();
      expect((await resumeSeat(backend, a.kv))).toBeNull();
      expect((await phone(creds.code, 'Kick Me')).r.ok).toBe(true);
    });

    it('resetting played songs keeps the current game songs', async () => {
      const { host } = await newRoom();
      await host.startRound(SONG_A);
      expect(await host.resetPlayed()).toBe(0);
      expect((await host.state()).played_this_game).toEqual([SONG_A]);
    });

    it('plays again: new game clears scores and timelines, keeps players, history becomes "earlier"', async () => {
      const { creds, host } = await newRoom();
      const a = await phone(creds.code, 'Ann');
      if (!a.r.ok) throw new Error('join failed');
      const r = await host.startRound(SONG_A);
      await host.reveal(r.id, { note: 'x' }, [{ id: a.r.seat.playerId, score: 5, timeline: [{ year: 1990 }] }]);
      const room = await host.newGame();
      expect(room).toMatchObject({ game_no: 2, round_no: 0, status: 'lobby' });
      const s = await host.state();
      expect(s.players).toHaveLength(1);
      expect(s.players[0]).toMatchObject({ score: 0, timeline: [] });
      expect(s.played_this_game).toEqual([]);
      expect(s.played_earlier).toContain(SONG_A);
      expect(s.round).toMatchObject({ round_no: 1, game_no: 1 }); // latest round is still the old game's until a new one starts
    });

    it('keeps a public view in step with changes (watchRoom)', async () => {
      const { creds, host } = await newRoom();
      let last: PublicRoomState | null = null;
      const stop = await watchRoom(backend, creds.roomId, (s) => { last = s; });
      cleanups.push(stop);
      const a = await phone(creds.code, 'Watcher');
      if (!a.r.ok) throw new Error('join failed');
      await until(() => last, (s) => s?.players.length === 1);
      const round = await host.startRound(SONG_A);
      await until(() => last, (s) => s?.round?.id === round.id);
      await backend.submitAnswer(a.r.seat.seatToken, round.id, { slot: 0, lock: true });
      await until(() => last, (s) => s?.locked.length === 1);
      await host.closeRound(round.id);
      await host.reveal(round.id, { note: 'r' });
      const done = await until(() => last, (s) => s?.round?.status === 'revealed');
      expect(done?.round?.reveal).toEqual({ note: 'r' });
      expect(await loadPublicState(backend, creds.roomId)).toMatchObject({ locked: [a.r.seat.playerId], round: { status: 'revealed' } });
    });

    it('mirrors presence into the connected flag', async () => {
      const { creds, host } = await newRoom();
      const a = await phone(creds.code, 'Pres');
      if (!a.r.ok) throw new Error('join failed');
      await backend.seatPing(a.r.seat.seatToken, false); // flag says away, but the page is about to be open
      expect((await backend.getPlayers(creds.roomId))[0].connected).toBe(false);
      const stopMirror = await host.mirrorPresence();
      cleanups.push(stopMirror);
      // The phone is a different browser from the host, so it gets its own connection when the backend needs that.
      const phoneSide = opts.makeOther?.() ?? backend;
      const untrack = await phoneSide.trackPresence(creds.code, a.r.seat.playerId);
      cleanups.push(untrack);
      const seen = await until(() => backend.getPlayers(creds.roomId), (ps) => ps[0]?.connected === true);
      expect(seen[0].connected).toBe(true);
    });

    it('starts and stops a phone session without errors', async () => {
      const { creds } = await newRoom();
      const a = await phone(creds.code, 'Sess');
      if (!a.r.ok) throw new Error('join failed');
      const sess = await startPhoneSession(backend, a.r.seat);
      expect((await sess.state())?.player.name).toBe('Sess');
      await sess.stop();
      expect((await backend.getPlayers(creds.roomId))[0].connected).toBe(false);
    });

    if (opts.after) it('cleans up', async () => { await opts.after!(); });
  });
}
