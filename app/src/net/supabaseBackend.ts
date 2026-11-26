import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import type { Backend } from './backend';
import type { AnswerRow, Change, HostState, JoinRaw, LockRow, MyState, PlayerRow, RoomRow, RoundRow, SubmitRaw } from './types';

/** Backend over a real Supabase project: reads are plain selects, writes are RPC calls (see supabase/migrations). */
export function createSupabaseBackend(sb: SupabaseClient): Backend {
  const rpc = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
    const { data, error } = await sb.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return data as T;
  };
  const rows = async <T>(q: PromiseLike<{ data: unknown; error: { message: string } | null }>, what: string): Promise<T> => {
    const { data, error } = await q;
    if (error) throw new Error(`${what}: ${error.message}`);
    return data as T;
  };

  const channelReady = (ch: RealtimeChannel, what: string) =>
    new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`${what}: subscribe timeout`)), 15000);
      ch.subscribe((status) => {
        if (status === 'SUBSCRIBED') { clearTimeout(t); resolve(); }
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { clearTimeout(t); reject(new Error(`${what}: ${status}`)); }
      });
    });
  const closer = (ch: RealtimeChannel) => async () => { await sb.removeChannel(ch); };

  return {
    createRoom: (mode, settings) => rpc('create_room', { p_mode: mode, p_settings: settings }),

    async getRoomByCode(code) {
      const d = await rows<RoomRow[]>(sb.from('rooms').select('*').eq('code', code.trim().toUpperCase()).limit(1), 'getRoomByCode');
      return d[0] ?? null;
    },
    async getRoom(id) {
      const d = await rows<RoomRow[]>(sb.from('rooms').select('*').eq('id', id).limit(1), 'getRoom');
      return d[0] ?? null;
    },
    getPlayers: (roomId) => rows<PlayerRow[]>(sb.from('players').select('*').eq('room_id', roomId).order('joined_at'), 'getPlayers'),
    async getLatestRound(roomId) {
      const d = await rows<RoundRow[]>(
        sb.from('rounds').select('*').eq('room_id', roomId).order('game_no', { ascending: false }).order('round_no', { ascending: false }).limit(1),
        'getLatestRound',
      );
      return d[0] ?? null;
    },
    getLocks: (roundId) => rows<LockRow[]>(sb.from('round_locks').select('*').eq('round_id', roundId), 'getLocks'),

    async subscribe(roomId, onChange) {
      const ch = sb.channel(`db:${roomId}:${Math.random().toString(36).slice(2, 8)}`);
      const on = (table: Change['table'], filter: string) =>
        ch.on('postgres_changes', { event: '*', schema: 'public', table, filter }, (p) => {
          const row = (p.eventType === 'DELETE' ? p.old : p.new) as never;
          onChange({ table, event: p.eventType, row } as Change);
        });
      on('rooms', `id=eq.${roomId}`);
      on('players', `room_id=eq.${roomId}`);
      on('rounds', `room_id=eq.${roomId}`);
      on('round_locks', `room_id=eq.${roomId}`);
      await channelReady(ch, 'subscribe');
      return closer(ch);
    },

    async trackPresence(code, playerId) {
      const ch = sb.channel(`presence:${code.toUpperCase()}`, { config: { presence: { key: playerId } } });
      await channelReady(ch, 'trackPresence');
      await ch.track({ at: Date.now() });
      return closer(ch);
    },
    async watchPresence(code, onPresent) {
      const ch = sb.channel(`presence:${code.toUpperCase()}`, { config: { presence: { key: `host-${Math.random().toString(36).slice(2, 8)}` } } });
      ch.on('presence', { event: 'sync' }, () => onPresent(Object.keys(ch.presenceState())));
      await channelReady(ch, 'watchPresence');
      onPresent(Object.keys(ch.presenceState()));
      return closer(ch);
    },

    joinRoom: (a) =>
      rpc<JoinRaw>('join_room', {
        p_code: a.code, p_name: a.name, p_seat_token: a.seatToken ?? null,
        p_max_players: a.maxPlayers, p_max_name: a.maxNameLength,
      }),
    seatPing: (token, connected) => rpc('seat_ping', { p_seat_token: token, p_connected: connected }),
    getMyState: (token) => rpc<MyState | null>('get_my_state', { p_seat_token: token }),
    submitAnswer: (token, roundId, a) =>
      rpc<SubmitRaw>('submit_answer', {
        p_seat_token: token, p_round: roundId, p_slot: a.slot ?? null, p_year: a.year ?? null,
        p_artist: a.artist ?? '', p_lock: a.lock ?? false,
      }),

    hostGetState: (room, token) => rpc<HostState>('host_get_state', { p_room: room, p_token: token }),
    hostGetAnswers: (room, token, round) => rpc<AnswerRow[]>('host_get_answers', { p_room: room, p_token: token, p_round: round }),
    hostUpdateRoom: (room, token, patch) =>
      rpc<RoomRow>('host_update_room', { p_room: room, p_token: token, p_mode: patch.mode ?? null, p_status: patch.status ?? null, p_settings: patch.settings ?? null }),
    hostStartRound: (room, token, a) =>
      rpc('host_start_round', { p_room: room, p_token: token, p_song_id: a.songId, p_kind: a.kind ?? 'normal', p_seconds: a.seconds ?? 40 }),
    hostCloseRound: (room, token, round, status = 'closed') =>
      rpc('host_close_round', { p_room: room, p_token: token, p_round: round, p_status: status }),
    hostRevealRound: (room, token, round, reveal, players) =>
      rpc('host_reveal_round', { p_room: room, p_token: token, p_round: round, p_reveal: reveal, p_players: players ?? null }),
    async hostUpdatePlayers(room, token, players) { await rpc('host_update_players', { p_room: room, p_token: token, p_players: players }); },
    hostSetOverride: (room, token, round, player, value) =>
      rpc('host_set_override', { p_room: room, p_token: token, p_round: round, p_player: player, p_value: value }),
    async hostSetConnected(room, token, ids) { await rpc('host_set_connected', { p_room: room, p_token: token, p_connected_ids: ids }); },
    async hostBlockSong(room, token, songId) { await rpc('host_block_song', { p_room: room, p_token: token, p_song_id: songId }); },
    async hostUnblockSong(room, token, songId) { await rpc('host_unblock_song', { p_room: room, p_token: token, p_song_id: songId }); },
    hostResetPlayed: (room, token) => rpc('host_reset_played', { p_room: room, p_token: token }),
    hostNewGame: (room, token) => rpc('host_new_game', { p_room: room, p_token: token }),
    async hostDeleteRoom(room, token, keep = false) { await rpc('host_delete_room', { p_room: room, p_token: token, p_keep_history: keep }); },
  };
}
