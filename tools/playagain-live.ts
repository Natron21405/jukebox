// Live check of Play Again against the real project: a host watcher and a phone watcher (real Realtime) see the new game.
// Made-up songs, throwaway room. Prints phases and counts only.
import { createClient } from '@supabase/supabase-js';
import { seededRng, type GameSong } from '../app/src/logic';
import { HostSession, createHostRoom, createSupabaseBackend, joinGame, memoryKV, startPhoneSession, watchRoom, type PublicRoomState } from '../app/src/net';
import { ClosestYearGame } from '../app/src/game/closestYear';
import { gamePhase } from '../app/src/game/closestYear';

const URL_ = process.env.SIM_URL!, KEY = process.env.SIM_KEY!;
const POOL: GameSong[] = Array.from({ length: 30 }, (_, n) => ({
  id: `p-${String(n).padStart(3, '0')}`, title: `Zanzibar ${n}x`, artists: [`Plonk ${n}x`], featuredArtists: [], year: 1960 + ((n * 7) % 55),
}));
const mk = () => createSupabaseBackend(createClient(URL_, KEY, { auth: { persistSession: false } }));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const hostB = mk(), watchB = mk(), phoneB = mk();
  const creds = await createHostRoom(hostB, memoryKV(), 'closest_year', { marker: 'playagain-live' });
  const host = new HostSession(hostB, creds);
  const j = await joinGame(phoneB, memoryKV(), { code: creds.code, name: 'Ana' });
  if (!j.ok) throw new Error('join');
  const phone = await startPhoneSession(phoneB, j.seat);
  let pub: PublicRoomState | null = null; const log: string[] = [];
  const stop = await watchRoom(watchB, creds.roomId, (s) => { pub = s; log.push(`${s.room.status}/g${s.room.game_no}/${s.round ? `r${s.round.game_no}.${s.round.round_no}:${s.round.status}` : '-'}`); });
  try {
    const game = new ClosestYearGame({ session: host, pool: POOL, rng: seededRng(3) });
    await game.begin();
    const n = await game.nextRound();
    if (n.status !== 'started') throw new Error('round');
    await phone.state();
    await game.endRound();
    await sleep(1500);
    console.log('before:', log.length, 'changes; last =', log[log.length - 1]);
    const mark = log.length;
    await game.playAgain();
    await sleep(2500);
    const after = log.slice(mark);
    console.log('after play again:', after.join(' | '));
    const hs = await host.state();
    console.log('host RPC: status', hs.room.status, 'game', hs.room.game_no, 'round', hs.round ? `${hs.round.game_no}.${hs.round.round_no}:${hs.round.status}` : 'none', 'phase', gamePhase(hs));
    const p = pub as unknown as PublicRoomState;
    console.log('watcher: status', p.room.status, 'game', p.room.game_no, 'round', p.round ? `${p.round.game_no}.${p.round.round_no}:${p.round.status}` : 'none', 'locked', p.locked.length);
    const ps = await phone.state();
    console.log('phone state: round', ps?.round ? `${ps.round.game_no}.${ps.round.round_no}:${ps.round.status}` : 'none', 'score', ps?.player.score);
  } finally {
    await stop(); await phone.stop(); await host.deleteRoom();
  }
  process.exit(0);
}
main().catch((e) => { console.error('FAIL', e?.message ?? e); process.exit(1); });
