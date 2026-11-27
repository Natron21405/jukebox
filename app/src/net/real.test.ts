import { createClient } from '@supabase/supabase-js';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { backendContract } from './contract';
import { createSupabaseBackend } from './supabaseBackend';

// Integration test against the real project. OPT-IN: it only runs with RUN_REAL_TESTS=1 (and the browser env vars),
// so a plain `npm test` never touches the real project.
// It only uses rows it creates: throwaway rooms (deleted afterwards) and test-only song ids ('test-...').
// Anything global is skipped: the played-songs history is shared by all games, so `resetPlayed` (which deletes the
// history of every other room) is NOT run here; it is covered by the fake backend contract.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
const enabled = Boolean(url && key) && process.env.RUN_REAL_TESTS === '1';

if (!enabled) {
  describe.skip('real Supabase project (opt-in: RUN_REAL_TESTS=1)', () => { it('needs RUN_REAL_TESTS=1 plus VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY', () => undefined); });
} else {
  vi.setConfig({ testTimeout: 30_000 }); // realtime subscriptions take a moment
  const sb = createClient(url!, key!, { auth: { persistSession: false } });
  afterAll(async () => { await sb.removeAllChannels(); });
  const sbPhone = createClient(url!, key!, { auth: { persistSession: false } });
  afterAll(async () => { await sbPhone.removeAllChannels(); });
  backendContract('real Supabase project', () => createSupabaseBackend(sb), { makeOther: () => createSupabaseBackend(sbPhone), skipGlobal: true });

  describe('real Supabase project: row level security', () => {
    const backend = createSupabaseBackend(sb);
    it('keeps private tables and writes closed to the anon key', async () => {
      const creds = await backend.createRoom('timeline', {});
      try {
        await backend.hostStartRound(creds.room_id, creds.host_token, { songId: 'test-rls' });
        for (const t of ['room_secrets', 'player_secrets', 'round_secrets', 'answers', 'play_history', 'blocklist']) {
          const { data, error } = await sb.from(t).select('*').limit(1);
          expect(error === null ? data : []).toEqual([]); // denied outright or filtered to nothing
        }
        const ins = await sb.from('rooms').insert({ code: 'HACK' });
        expect(ins.error).not.toBeNull();
        const upd = await sb.from('players').update({ score: 99 }).eq('room_id', creds.room_id);
        expect(upd.error).not.toBeNull();
        const del = await sb.from('rooms').delete().eq('id', creds.room_id);
        expect(del.error).not.toBeNull();
        expect(await backend.getRoom(creds.room_id)).not.toBeNull();
        // The public round row carries no song id.
        const { data } = await sb.from('rounds').select('*').eq('room_id', creds.room_id);
        expect(JSON.stringify(data)).not.toContain('test-rls');
      } finally {
        await backend.hostDeleteRoom(creds.room_id, creds.host_token);
      }
      expect(await backend.getRoom(creds.room_id)).toBeNull();
    });
  });
}
