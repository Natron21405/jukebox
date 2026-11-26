// Simulation harness (run through tools/simulate.mjs). Host + bot phones against the real Supabase project.
// Output is counts and timings only. Never log anything from a song record: violations use round numbers and bot numbers.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG, correctSlots, matchArtist, type GameSong } from '../app/src/logic';
import {
  ClosestYearGame, TimelineGame, gamePhase, phoneView, sendAnswer, sendTimelineAnswer, timelinePhoneView,
} from '../app/src/game';
import {
  HostSession, createHostRoom, createSupabaseBackend, joinGame, memoryKV, resumeHost, resumeSeat, startPhoneSession, watchRoom,
  type Backend, type KV, type MyState, type PhoneSession, type PublicRoomState, type StoredSeat, type Unsubscribe,
} from '../app/src/net';

// ---------------------------------------------------------------- options
const argv = process.argv.slice(2).filter((a) => a !== '--');
const opt = (name: string, def: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : def; };
const QUICK = argv.includes('--quick'); // 20 phones, 2 rounds per mode, one deliberate refresh (see tools/simulate.mjs)
const OPTS = {
  quick: QUICK,
  modes: opt('modes', 'timeline,closest_year').split(',') as Array<'timeline' | 'closest_year'>,
  bots: Math.min(CONFIG.maxPlayers, Math.max(2, Number(opt('bots', QUICK ? String(CONFIG.maxPlayers) : '12')))),
  rounds: Number(opt('rounds', QUICK ? '2' : '6')), // rounds per mode (Closest Year has a minimum of 5, so --quick stops both modes after this many)
  target: Number(opt('target', QUICK ? '12' : '6')), // Timeline target cards
  seconds: Number(opt('seconds', '15')), // round timer (lobby minimum is 15)
  dwellMs: Number(opt('dwell', '1200')), // pause after a reveal before the host starts the next round
  gameTimeoutMs: Number(opt('timeout', '420000')),
};
const URL_ = process.env.SIM_URL!;
const KEY = process.env.SIM_KEY!;
const ROOT = process.env.SIM_ROOT!;

// ---------------------------------------------------------------- small helpers
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
const pickOne = <T,>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)];
const gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
const withTimeout = <T,>(p: Promise<T>, ms: number): Promise<T | undefined> => Promise.race([p, sleep(ms).then(() => undefined)]);
const pct = (xs: number[], p: number) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const fmt = (xs: number[]) => (xs.length ? `n=${xs.length} min=${Math.round(Math.min(...xs))} med=${Math.round(pct(xs, 0.5))} p95=${Math.round(pct(xs, 0.95))} max=${Math.round(Math.max(...xs))}` : 'n=0');

// ---------------------------------------------------------------- Realtime message counting (every WebSocket frame)
const wsStats = {
  opened: 0, open: 0, maxOpen: 0, out: 0,
  inByKind: new Map<string, number>(),
  billablePerSec: new Map<number, number>(),
  joins: 0,
  tables: new Map<string, number>(),
};
const BILLABLE = new Set(['postgres_changes', 'presence_state', 'presence_diff', 'broadcast']);
function classify(data: unknown): string {
  try {
    if (typeof data === 'string') {
      const m = JSON.parse(data);
      if (Array.isArray(m)) {
        if (m[3] === 'postgres_changes') { const t = String(m[4]?.data?.table); wsStats.tables.set(t, (wsStats.tables.get(t) ?? 0) + 1); }
        return m[2] === 'phoenix' ? 'heartbeat' : String(m[3]);
      }
      if (m.event === 'postgres_changes') wsStats.tables.set(String(m.payload?.data?.table), (wsStats.tables.get(String(m.payload?.data?.table)) ?? 0) + 1);
      return m.topic === 'phoenix' ? 'heartbeat' : String(m.event);
    }
  } catch { /* fall through */ }
  return 'binary';
}
class CountingWS extends WebSocket {
  constructor(url: string | URL, protocols?: string | string[]) {
    super(url, protocols);
    wsStats.opened++;
    this.addEventListener('open', () => { wsStats.open++; wsStats.maxOpen = Math.max(wsStats.maxOpen, wsStats.open); });
    this.addEventListener('close', () => { wsStats.open--; });
    this.addEventListener('message', (e: MessageEvent) => {
      const k = classify(e.data);
      wsStats.inByKind.set(k, (wsStats.inByKind.get(k) ?? 0) + 1);
      if (BILLABLE.has(k)) { const s = Math.floor(Date.now() / 1000); wsStats.billablePerSec.set(s, (wsStats.billablePerSec.get(s) ?? 0) + 1); }
    });
  }
  send(d: string | ArrayBufferLike | Blob | ArrayBufferView) {
    wsStats.out++;
    try { if (typeof d === 'string' && d.includes('"phx_join"')) wsStats.joins++; } catch { /* ignore */ }
    super.send(d);
  }
}
const snapshotStats = () => ({
  inByKind: new Map(wsStats.inByKind), out: wsStats.out, joins: wsStats.joins, perSec: new Map(wsStats.billablePerSec), opened: wsStats.opened,
});

// ---------------------------------------------------------------- clients and "killable" backends (a refreshed page stops running)
const allClients = new Set<SupabaseClient>();
function newClient(): SupabaseClient {
  const c = createClient(URL_, KEY, { auth: { persistSession: false }, realtime: { transport: CountingWS as never } });
  allClients.add(c);
  return c;
}
interface Page { sb: SupabaseClient; backend: Backend; kill(): void }
function newPage(): Page {
  const sb = newClient();
  const real = createSupabaseBackend(sb);
  let dead = false;
  const backend = new Proxy(real, {
    get(t, prop) {
      const v = (t as never)[prop];
      if (typeof v !== 'function') return v;
      return (...a: unknown[]) => (dead ? Promise.reject(new Error('page closed')) : (v as (...x: unknown[]) => unknown).apply(t, a));
    },
  }) as Backend;
  return { sb, backend, kill: () => { dead = true; } };
}
/** Drop a page the way a closed tab does: no goodbye to the database, the socket just goes away. */
async function dropPage(p: Page) {
  p.kill();
  try { p.sb.realtime.disconnect(); } catch { /* ignore */ }
}
async function closePage(p: Page) {
  try { await withTimeout(p.sb.removeAllChannels(), 3000); p.sb.realtime.disconnect(); } catch { /* ignore */ }
  allClients.delete(p.sb);
}

// ---------------------------------------------------------------- song pool (never printed)
const pool: GameSong[] = JSON.parse(fs.readFileSync(path.join(ROOT, 'app', 'public', 'songs.json'), 'utf8'));
const songById = new Map(pool.map((s) => [s.id, s]));

// ---------------------------------------------------------------- one game's bookkeeping
type Mode = 'timeline' | 'closest_year';
interface Rec { year: number | null; slot: number | null; artist: string; artistKind: 'exact' | 'typo' | 'wrong' | 'none'; locked: boolean; lockedAt: number }
interface RoundStat { no: number; kind: string; openedAt: number; revealedAt: number; seen: number[]; revealSeen: number[]; lastLockAt: number; answered: number }

class Game {
  mode: Mode;
  violations: string[] = [];
  roomId = ''; code = ''; hostToken = '';
  bots: Bot[] = [];
  oracle = new Map<string, GameSong>(); // roundId -> song (the harness knows the secret, phones do not)
  recs = new Map<string, Map<string, Rec>>(); // roundId -> playerId -> record
  rounds = new Map<string, RoundStat>();
  rejoin = { tried: 0, ok: 0, same: 0, other: 0, stateKept: 0, stateSkipped: 0, oldTokenDead: 0 };
  dup = { tried: 0, rejected: 0, fullTried: 0, fullRejected: 0 };
  hostRefresh = { tried: 0, ok: 0 };
  checks = { reveals: 0, rowsVerified: 0, leakChecks: 0, lockRejects: 0, lockRejectsExpected: 0, postRevealRejects: 0, lateRejects: 0, afkRounds: 0, timerEnds: 0 };
  completed = false;
  quickStopped = false;
  roundsPlayed = 0;
  suddenRounds = 0;
  playedIds = new Set<string>();
  constructor(mode: Mode) { this.mode = mode; }
  violate(msg: string) { this.violations.push(`${this.mode}: ${msg}`); }
  rec(roundId: string): Map<string, Rec> { let m = this.recs.get(roundId); if (!m) this.recs.set(roundId, (m = new Map())); return m; }
}

// ---------------------------------------------------------------- a bot phone
class Bot {
  page!: Page;
  kv: KV = memoryKV();
  seat!: StoredSeat;
  phone: PhoneSession | null = null;
  unwatch: Unsubscribe | null = null;
  gen = 0; // bumps on every refresh; work started by an older page stops
  acting = new Set<string>();
  seen = new Set<string>();
  sawResult = new Set<string>();
  pub: PublicRoomState | null = null;
  lastKey = '';
  reacting = false; again = false;
  refreshing = false; stable = true; // stable: not refreshing and not about to be
  afkRound: number | null = null;
  refreshTimer: ReturnType<typeof setTimeout> | null = null;
  inflight: Promise<void> | null = null;
  stopped = false;
  constructor(readonly g: Game, readonly n: number, readonly name: string, readonly skill: number) {}

  tag() { return `bot${this.n}`; }

  async start(code: string): Promise<void> {
    this.page = newPage();
    const r = await joinGame(this.page.backend, this.kv, { code, name: this.name });
    if (!r.ok) throw new Error(`${this.tag()} could not join: ${r.reason}`);
    if (r.kind !== 'new') this.g.violate(`${this.tag()} first join returned ${r.kind}`);
    this.seat = r.seat;
    await this.attach();
    if (!OPTS.quick) this.scheduleRefresh(); // --quick refreshes exactly one bot, from playGame
  }

  /** Presence + heartbeat + room watch: what the phone screen does once it has a seat. */
  private async attach() {
    const gen = ++this.gen;
    const backend = this.page.backend;
    this.phone = await startPhoneSession(backend, this.seat);
    this.unwatch = await watchRoom(backend, this.seat.roomId, (s) => {
      if (gen !== this.gen) return;
      this.pub = s;
      const key = `${s.room.status}|${s.room.game_no}|${s.round?.id ?? ''}|${s.round?.status ?? ''}`;
      if (key === this.lastKey) return;
      this.lastKey = key;
      void this.react();
    });
    void this.react();
  }

  async react() {
    if (this.reacting) { this.again = true; return; }
    this.reacting = true;
    try { do { this.again = false; await this.look(); } while (this.again && !this.stopped); } catch { /* page closed or network blip: the next change retries */ } finally { this.reacting = false; }
  }

  view(st: MyState) {
    if (this.g.mode === 'timeline') { const v = timelinePhoneView(st); return { stage: v.stage, input: v.input, timeline: v.timeline }; }
    const v = phoneView(st); return { stage: v.stage, input: 'year' as const, timeline: [] as { year: number; songId: string }[] };
  }

  private async look() {
    const gen = this.gen; const phone = this.phone;
    if (!phone) return;
    const st = await phone.state();
    if (gen !== this.gen || !st) return;
    const r = st.round; if (!r) return;
    const v = this.view(st);
    const song = this.g.oracle.get(r.id);
    if (song && r.status !== 'revealed' && r.status !== 'skipped') {
      this.g.checks.leakChecks++;
      const text = JSON.stringify([st, this.pub]);
      if (text.includes(song.id) || (song.title.length >= 6 && text.includes(song.title))) this.g.violate(`song details visible to ${this.tag()} before the reveal (round id ${r.round_no})`);
    }
    const stat = this.g.rounds.get(r.id);
    if (v.stage === 'answer' && !this.acting.has(r.id) && r.status === 'open') {
      this.acting.add(r.id);
      if (stat && !this.seen.has(r.id)) { this.seen.add(r.id); stat.seen.push(Date.now() - stat.openedAt); }
      void this.act(r.id, r.round_no, v, gen);
    }
    if (v.stage === 'result' && !this.sawResult.has(r.id)) {
      this.sawResult.add(r.id);
      if (stat && stat.revealedAt) stat.revealSeen.push(Date.now() - stat.revealedAt);
    }
  }

  private async oracleFor(roundId: string): Promise<GameSong | null> {
    for (let i = 0; i < 100; i++) { const s = this.g.oracle.get(roundId); if (s) return s; await sleep(50); }
    return null;
  }

  private async act(roundId: string, roundNo: number, v: { input: 'slot' | 'year'; timeline: readonly { year: number }[] }, gen: number) {
    const g = this.g;
    const song = await this.oracleFor(roundId);
    if (!song) { g.violate(`${this.tag()} round ${roundNo} had no song registered`); return; }
    if (this.afkRound === roundNo) { g.checks.afkRounds++; return; } // plays no part this round: the timer ends it
    const phone = this.phone!;
    await sleep(rand(500, 4500));
    if (gen !== this.gen) return;

    const sd = (1 - this.skill) * 18 + 0.4;
    const year = Math.round(song.year + gauss() * sd);
    let slot: number | null = null;
    if (v.input === 'slot') {
      const tl = v.timeline.map((c) => ({ year: c.year, songId: '' }));
      const good = correctSlots(tl as never, song.year);
      if (Math.random() < this.skill) slot = pickOne(good);
      else { const bad = Array.from({ length: tl.length + 1 }, (_, i) => i).filter((i) => !good.includes(i)); slot = bad.length ? pickOne(bad) : pickOne(good); }
    }
    const roll = Math.random();
    let artist = ''; let kind: Rec['artistKind'] = 'none';
    if (roll < this.skill * 0.7) { artist = song.artists[0]; kind = 'exact'; if (Math.random() < 0.2 && artist.replace(/\s/g, '').length >= 6) { const i = 1 + Math.floor(Math.random() * (artist.length - 2)); artist = artist.slice(0, i) + artist.slice(i + 1); kind = 'typo'; } }
    else if (roll < 0.85) { artist = pickOne(['zzqx wvk', 'qqq jjj', 'xyzzy plugh']); kind = 'wrong'; }

    const send = async (lock: boolean) => {
      const r = this.g.mode === 'timeline'
        ? await sendTimelineAnswer(phone, roundId, { slot: v.input === 'slot' ? slot : null, year: v.input === 'year' ? year : null, artist, lock })
        : await sendAnswer(phone, roundId, { year, artist, lock });
      if (r.ok) g.rec(roundId).set(this.seat.playerId, { year: this.g.mode === 'timeline' && v.input === 'slot' ? null : year, slot: v.input === 'slot' ? slot : null, artist, artistKind: kind, locked: r.locked, lockedAt: r.locked ? Date.now() : 0 });
      return r;
    };
    try {
      const d = await send(false); // a draft first, like the phone saving after each change
      if (!d.ok) { this.rejected(d.reason, roundNo); return; }
      await sleep(rand(300, 900));
      if (gen !== this.gen) return;
      const f = await send(true);
      if (!f.ok) { this.rejected(f.reason, roundNo); return; }
      const stat = g.rounds.get(roundId); if (stat) { stat.lastLockAt = Math.max(stat.lastLockAt, Date.now()); stat.answered++; }
      // A locked answer must not change: try to change it now and then.
      if (Math.random() < 0.35) {
        g.checks.lockRejectsExpected++;
        const again = await phone.submit(roundId, { slot: slot === null ? null : (slot + 1), year: year + 7, artist: 'changed after lock', lock: true });
        if (again.ok) g.violate(`${this.tag()} changed an answer after locking in (round ${roundNo})`);
        else { g.checks.lockRejects++; if (again.reason !== 'already-locked' && again.reason !== 'round-closed') g.violate(`${this.tag()} odd reject reason after lock (round ${roundNo})`); }
      }
    } catch (e) {
      if (gen === this.gen && !this.stopped) g.violate(`${this.tag()} submit failed in round ${roundNo}: ${(e as Error).message.slice(0, 80)}`);
    }
  }

  private rejected(reason: string, roundNo: number) {
    if (reason === 'round-closed') { this.g.checks.lateRejects++; return; } // the round ended while this bot was away or slow
    this.g.violate(`${this.tag()} answer rejected (${reason}) in round ${roundNo}`);
  }

  // ------------------------------------------------------------ refresh and rejoin
  scheduleRefresh() {
    if (this.stopped) return;
    this.refreshTimer = setTimeout(() => { this.inflight = this.refresh(); void this.inflight.finally(() => this.scheduleRefresh()); }, rand(6000, 16000));
  }

  async refresh(forceKind?: 'same' | 'other') {
    if (this.refreshing || this.stopped || !this.phone) return;
    this.refreshing = true; this.stable = false;
    const g = this.g;
    const kind = forceKind ?? (Math.random() < 0.7 ? 'same' : 'other');
    g.rejoin.tried++;
    try {
      const before = await this.phone!.state();
      const old = this.page;
      const oldSeat = this.seat;
      this.gen++; // older work stops
      await this.unwatch?.(); this.unwatch = null;
      const oldPhone = this.phone!; this.phone = null;
      if (kind === 'same') {
        await dropPage(old); // closed tab: no goodbye
        void withTimeout(oldPhone.stop(), 2000);
        await sleep(rand(200, 1500));
      } else {
        await oldPhone.stop(); // phone says goodbye (seat marked away), player moves to another device
        if (process.env.SIM_DEBUG) {
          const probe = newClient();
          const trace: string[] = [];
          const t = Date.now();
          for (let i = 0; i < 12; i++) {
            const { data } = await probe.from('players').select('connected').eq('id', oldSeat.playerId).single();
            trace.push(`${Date.now() - t}ms:${data?.connected ? 'C' : 'd'}`);
            await sleep(100);
          }
          console.log(`DEBUG ${this.tag()} after goodbye ${trace.join(' ')}`);
          await closePage({ sb: probe } as Page);
        }
        await closePage(old);
        this.kv = memoryKV();
        await sleep(rand(200, 1000));
      }
      this.page = newPage();
      this.acting.clear();
      let ok = false;
      if (kind === 'same') {
        if (Math.random() < 0.5) {
          const r = await resumeSeat(this.page.backend, this.kv);
          ok = !!r && r.seat.playerId === oldSeat.playerId && r.seat.seatToken === oldSeat.seatToken;
          if (r) this.seat = r.seat;
        } else {
          const r = await joinGame(this.page.backend, this.kv, { code: oldSeat.code, name: this.name });
          ok = r.ok && r.kind === 'resumed' && r.seat.playerId === oldSeat.playerId;
          if (r.ok) this.seat = r.seat;
        }
        if (ok) g.rejoin.same++;
      } else {
        const r = await joinGame(this.page.backend, this.kv, { code: oldSeat.code, name: `  ${this.name.toUpperCase()} ` });
        if (!r.ok) g.violate(`${this.tag()} other-device join refused: ${r.reason}`);
        else if (r.kind !== 'reclaimed') g.violate(`${this.tag()} other-device join returned ${r.kind}`);
        ok = r.ok && r.kind === 'reclaimed' && r.seat.playerId === oldSeat.playerId && r.seat.seatToken !== oldSeat.seatToken;
        if (r.ok) this.seat = r.seat;
        if (ok) {
          g.rejoin.other++;
          const stale = await this.page.backend.getMyState(oldSeat.seatToken);
          if (stale === null) g.rejoin.oldTokenDead++; else g.violate(`${this.tag()} old seat token still works after the seat was reclaimed`);
        }
      }
      if (!ok) { g.violate(`${this.tag()} rejoin (${kind}) did not return to the same seat`); return; }
      g.rejoin.ok++;
      await this.attach();
      const after = await this.phone!.state();
      if (before && after && before.round?.id === after.round?.id && before.round?.status === after.round?.status && before.room.game_no === after.room.game_no) {
        const same = JSON.stringify([before.player.score, before.player.timeline, before.player.artist_hits]) === JSON.stringify([after.player.score, after.player.timeline, after.player.artist_hits]);
        if (same) g.rejoin.stateKept++; else g.violate(`${this.tag()} score or timeline changed across a refresh`);
      } else g.rejoin.stateSkipped++;
    } catch (e) {
      g.violate(`${this.tag()} rejoin (${kind}) threw: ${(e as Error).message.slice(0, 80)}`);
    } finally { this.refreshing = false; this.stable = true; }
  }

  async stop() {
    this.stopped = true;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    if (this.inflight) await withTimeout(this.inflight, 15000); // let a rejoin that is under way finish and be counted
    this.gen++;
    try { await withTimeout(this.unwatch?.() as Promise<void>, 2000); } catch { /* ignore */ }
    try { await withTimeout(this.phone?.stop() as Promise<void>, 3000); } catch { /* ignore */ }
    await closePage(this.page);
  }
}

// ---------------------------------------------------------------- the host screen
class Host {
  page!: Page;
  kv: KV = memoryKV();
  session!: HostSession;
  game!: ClosestYearGame | TimelineGame;
  stopPresence: (() => Promise<void>) | null = null;
  unwatch: Unsubscribe | null = null;
  tick: ReturnType<typeof setInterval> | null = null;
  checking = false;
  revealed: ((v: unknown) => void) | null = null;
  gen = 0;
  constructor(readonly g: Game) {}

  private makeGame() {
    const deps = { session: this.session, pool, rng: Math.random };
    this.game = this.g.mode === 'timeline' ? new TimelineGame(deps) : new ClosestYearGame(deps);
  }

  async create() {
    this.page = newPage();
    const creds = await createHostRoom(this.page.backend, this.kv, this.g.mode, { roundSeconds: OPTS.seconds, rounds: OPTS.rounds, targetCards: OPTS.target });
    this.g.roomId = creds.roomId; this.g.code = creds.code; this.g.hostToken = creds.hostToken;
    this.session = new HostSession(this.page.backend, creds);
    this.makeGame();
    await this.attach();
  }

  private async attach() {
    const gen = ++this.gen;
    this.stopPresence = await this.session.mirrorPresence();
    this.unwatch = await watchRoom(this.page.backend, this.g.roomId, () => { if (gen === this.gen) void this.check(); });
    this.tick = setInterval(() => { if (gen === this.gen) void this.check(); }, CONFIG.host.tickMs);
  }

  async check() {
    if (this.checking) return;
    this.checking = true;
    const gen = this.gen;
    try {
      const r = await this.game.checkAutoEnd();
      if (r && gen === this.gen) this.revealed?.(r);
      else if (r) this.revealed?.(r);
    } catch { /* page closed or blip: next tick retries */ } finally { this.checking = false; }
  }

  /** Refresh the host screen: everything is rebuilt from the database and the saved room credentials. */
  async refresh(): Promise<boolean> {
    const g = this.g;
    g.hostRefresh.tried++;
    const before = await this.session.state();
    this.gen++;
    if (this.tick) clearInterval(this.tick);
    const old = this.page;
    await dropPage(old);
    void withTimeout(this.stopPresence?.() as Promise<void>, 2000);
    void withTimeout(this.unwatch?.() as Promise<void>, 2000);
    await sleep(rand(300, 1500));
    this.page = newPage();
    this.checking = false;
    const r = await resumeHost(this.page.backend, this.kv);
    if (!r || r.creds.code !== g.code) { g.violate('host could not resume after a refresh'); return false; }
    this.session = new HostSession(this.page.backend, r.creds);
    this.makeGame();
    await this.attach();
    const after = await this.session.state();
    const keep = before.round?.id === after.round?.id && before.room.game_no === after.room.game_no && before.players.length === after.players.length;
    if (!keep) { g.violate('host state differed after a refresh'); return false; }
    g.hostRefresh.ok++;
    void closePage(old);
    return true;
  }

  async stop() {
    this.gen++;
    if (this.tick) clearInterval(this.tick);
    try { await withTimeout(this.stopPresence?.() as Promise<void>, 2000); } catch { /* ignore */ }
    try { await withTimeout(this.unwatch?.() as Promise<void>, 2000); } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------- independent checks of a revealed round
const pointsFor = (d: number | null): number => { if (d === null) return 0; for (const r of CONFIG.closestYear.pointsTable) if (d <= r.maxDistance) return r.points; return 0; };
const slotOk = (tl: readonly { year: number }[], slot: number | null, year: number) =>
  slot !== null && Number.isInteger(slot) && slot >= 0 && slot <= tl.length && (slot === 0 || tl[slot - 1].year <= year) && (slot === tl.length || year <= tl[slot].year);

async function verifyRound(g: Game, host: Host, roundId: string, before: Awaited<ReturnType<HostSession['state']>>, songId: string) {
  const song = songById.get(songId)!;
  const pub = await host.session.state(); // includes players after
  const rrow = pub.round!;
  const reveal = rrow.reveal as { kind: string; song: { id: string; year: number }; rows: Array<Record<string, unknown>> } | null;
  const no = rrow.round_no;
  if (rrow.id !== roundId || rrow.status !== 'revealed' || !reveal) { g.violate(`round ${no} not revealed as expected`); return; }
  g.checks.reveals++;
  if (reveal.song.id !== song.id || reveal.song.year !== song.year) g.violate(`round ${no} reveal shows a different song than the one played`);
  const sudden = rrow.kind === 'sudden_death';
  if (reveal.kind !== rrow.kind) g.violate(`round ${no} reveal kind differs from round kind`);

  // Answers stored vs what each bot was told was saved.
  const dbAnswers = await host.session.answers(roundId);
  const recs = g.rec(roundId);
  for (const a of dbAnswers) {
    const r = recs.get(a.player_id);
    if (!r) { g.violate(`round ${no} has a stored answer nobody sent`); continue; }
    const same = a.year === (r.year ?? null) && a.slot === (r.slot ?? null) && a.artist_guess === r.artist && a.locked === r.locked;
    if (!same) g.violate(`round ${no} stored answer differs from what was saved (bot ${g.bots.findIndex((b) => b.seat.playerId === a.player_id) + 1})`);
  }
  for (const [pid, r] of recs) if (!dbAnswers.some((a) => a.player_id === pid)) g.violate(`round ${no} an acknowledged answer is missing (bot ${g.bots.findIndex((b) => b.seat.playerId === pid) + 1})`);

  const contenders = (before.room.settings.suddenDeath as string[] | undefined) ?? [];
  const rowOf = new Map(reveal.rows.map((r) => [r.playerId as string, r]));
  for (const pb of before.players) {
    const pa = pub.players.find((p) => p.id === pb.id);
    const row = rowOf.get(pb.id);
    const who = `bot ${g.bots.findIndex((b) => b.seat.playerId === pb.id) + 1}`;
    if (!pa) { g.violate(`round ${no} ${who} vanished`); continue; }
    const rec = recs.get(pb.id);
    const inRound = g.mode === 'timeline' ? pb.timeline.length > 0 && (!sudden || contenders.includes(pb.id)) : true;
    if (!inRound) { if (row) g.violate(`round ${no} ${who} scored but was not in the round`); continue; }
    if (!row) { g.violate(`round ${no} ${who} has no reveal row`); continue; }
    g.checks.rowsVerified++;
    // Artist: exact primary name must count, nonsense and nothing must not; typos may go either way.
    const hit = row.artistHit === true;
    if (sudden) { if (hit) g.violate(`round ${no} ${who} artist counted in sudden death`); }
    else if (rec?.artistKind === 'exact' && !hit) g.violate(`round ${no} ${who} exact artist not counted`);
    if (!sudden && (rec?.artistKind === 'wrong' || rec?.artistKind === 'none' || !rec) && hit) g.violate(`round ${no} ${who} artist counted without a correct guess`);
    if (!sudden && rec && (rec.artistKind === 'typo' || rec.artistKind === 'exact') && matchArtist(rec.artist, song).matched !== (row.autoMatched === true)) g.violate(`round ${no} ${who} matcher disagrees with itself`);

    if (g.mode === 'closest_year') {
      const usable = rec?.year != null && rec.year >= CONFIG.closestYear.guessYearMin && rec.year <= CONFIG.closestYear.guessYearMax ? rec.year : null;
      const d = usable === null ? null : Math.abs(usable - song.year);
      const expectYearPts = pointsFor(d);
      const expectTotal = sudden ? 0 : expectYearPts + (hit ? CONFIG.artistBonus : 0);
      if (row.year !== usable || row.distance !== d) g.violate(`round ${no} ${who} guess or distance wrong in reveal`);
      if (!sudden && row.yearPoints !== expectYearPts) g.violate(`round ${no} ${who} year points wrong`);
      if (row.total !== expectTotal) g.violate(`round ${no} ${who} round total wrong`);
      if (pa.score !== pb.score + expectTotal) g.violate(`round ${no} ${who} running score wrong`);
    } else if (!sudden) {
      const slot = rec?.slot ?? null;
      const ok = slotOk(pb.timeline, slot, song.year);
      if (row.correct !== ok) g.violate(`round ${no} ${who} placement judged wrong`);
      const expect = ok ? [...pb.timeline.map((c) => c.year)].toSpliced(slot!, 0, song.year) : pb.timeline.map((c) => c.year);
      const got = pa.timeline.map((c) => c.year);
      if (JSON.stringify(expect) !== JSON.stringify(got)) g.violate(`round ${no} ${who} timeline after the round is wrong`);
      for (let i = 1; i < got.length; i++) if (got[i] < got[i - 1]) { g.violate(`round ${no} ${who} timeline out of order`); break; }
      if (pa.artist_hits !== pb.artist_hits + (hit ? 1 : 0)) g.violate(`round ${no} ${who} artist hits wrong`);
    } else {
      const d = rec?.year != null ? Math.abs(rec.year - song.year) : null;
      if (row.distance !== d) g.violate(`round ${no} ${who} sudden-death distance wrong`);
      if (JSON.stringify(pa.timeline) !== JSON.stringify(pb.timeline)) g.violate(`round ${no} ${who} timeline changed in sudden death`);
    }
  }
}

// ---------------------------------------------------------------- run one full game
async function playGame(mode: Mode): Promise<Game> {
  const g = new Game(mode);
  const host = new Host(g);
  const t0 = Date.now();
  try {
    await host.create();
    // All phones join at once (a few of them with a lot of luck being first, like a real crowd).
    const skills = Array.from({ length: OPTS.bots }, (_, i) => 0.15 + (0.8 * i) / Math.max(1, OPTS.bots - 1)).sort(() => Math.random() - 0.5);
    g.bots = skills.map((s, i) => new Bot(g, i + 1, `Sim ${String.fromCharCode(65 + i)}${Math.floor(rand(10, 99))}`, s));
    await Promise.all(g.bots.map((b) => b.start(g.code)));
    for (let i = 0; i < 40; i++) {
      const s = await host.session.state();
      if (s.players.length === OPTS.bots && s.players.every((p) => p.connected)) break;
      await sleep(500);
      if (i === 39) g.violate('not every bot showed as connected in the lobby');
    }
    const lobby = await host.session.state();
    if (new Set(lobby.players.map((p) => p.name.toLowerCase())).size !== lobby.players.length) g.violate('two players share a name');

    // A phone must not read the secret tables or the answers.
    const anon = newClient();
    for (const t of ['answers', 'round_secrets', 'player_secrets', 'room_secrets']) {
      const { data } = await anon.from(t).select('*').limit(1);
      if (data && data.length) g.violate(`anon key can read ${t}`);
    }
    allClients.delete(anon);

    await host.game.begin();
    g.bots[Math.floor(Math.random() * g.bots.length)].afkRound = 3; // one bot sits out round 3: exercises the timer path
    const hostRefreshAt = OPTS.quick ? new Set<number>() : new Set([2, Math.max(4, Math.ceil(OPTS.rounds / 2) + 1)]);
    let quickRefreshDone = false;
    let dupDone = false;

    for (;;) {
      if (Date.now() - t0 > OPTS.gameTimeoutMs) { g.violate('game timed out'); break; }
      const pre = await host.session.state();
      if (gamePhase(pre) === 'over') break;
      if (OPTS.quick && g.roundsPlayed >= OPTS.rounds) { g.quickStopped = true; break; } // quick: no need to finish the game
      const next = await host.game.nextRound();
      if (next.status === 'not-now' && next.phase === 'over') break;
      if (next.status !== 'started') { g.violate(`could not start a round (${next.status})`); break; }
      const roundNo = next.roundNo;
      const openedAt = Date.now();
      const song = songById.get(next.songId)!;
      g.oracle.set(next.roundId, song);
      g.rounds.set(next.roundId, { no: roundNo, kind: next.kind, openedAt, revealedAt: 0, seen: [], revealSeen: [], lastLockAt: 0, answered: 0 });
      if (next.kind === 'sudden_death') g.suddenRounds++; else g.roundsPlayed++;
      const before = await host.session.state();
      if (g.playedIds.has(song.id)) g.violate(`round ${roundNo} repeated a song`);
      g.playedIds.add(song.id);
      if (!before.played_this_game.includes(song.id)) g.violate(`round ${roundNo} song missing from play history`);

      const waitReveal = new Promise<unknown>((resolve) => { host.revealed = resolve; });
      // Mid-round extras
      void (async () => {
        if (OPTS.quick && !quickRefreshDone && roundNo === 1) {
          quickRefreshDone = true;
          await sleep(rand(2500, 4500));
          const b = g.bots[g.bots.length - 1];
          if (b.stable) await b.refresh('same');
        }
        if (hostRefreshAt.has(roundNo) && next.kind === 'normal') {
          await sleep(rand(2500, 4500));
          if ((await host.session.state()).round?.status === 'open') await host.refresh().catch((e) => g.violate(`host refresh threw: ${(e as Error).message.slice(0, 80)}`));
        }
        if (!dupDone && roundNo >= 2) {
          dupDone = true;
          await sleep(rand(1000, 2500));
          await duplicateNameAttempt(g);
        }
      })();
      const timeout = sleep(OPTS.seconds * 1000 + 30000).then(() => 'timeout' as const);
      const res = await Promise.race([waitReveal, timeout]);
      if (res === 'timeout') { g.violate(`round ${roundNo} did not finish`); break; }
      const revealedAt = Date.now();
      const stat = g.rounds.get(next.roundId)!; stat.revealedAt = revealedAt;
      if (revealedAt - openedAt >= OPTS.seconds * 1000 - 500) g.checks.timerEnds++;
      await verifyRound(g, host, next.roundId, before, next.songId);
      await sleep(OPTS.dwellMs);
      // A bot that is not mid-refresh tries to change the answer of the round that just ended.
      const late = g.bots.find((b) => b.stable && b.phone);
      if (late) {
        try {
          const r = await late.phone!.submit(next.roundId, { slot: 0, year: 1999, artist: 'late', lock: true });
          if (r.ok) g.violate(`round ${roundNo} accepted an answer after the reveal`); else g.checks.postRevealRejects++;
        } catch { /* a refresh raced this check */ }
      }
    }

    // Final checks
    const fin = await host.session.state();
    const settings = fin.room.settings as { winnerId?: string | null };
    if (g.quickStopped) {
      // --quick: stopped on purpose after a few rounds, so there is no winner to check.
      if (g.roundsPlayed !== OPTS.rounds) g.violate(`played ${g.roundsPlayed} normal rounds, expected ${OPTS.rounds}`);
      if (fin.players.length !== OPTS.bots) g.violate(`expected ${OPTS.bots} players, found ${fin.players.length}`);
      g.completed = g.roundsPlayed === OPTS.rounds;
      return g;
    }
    if (fin.room.status !== 'over') g.violate('game did not reach the over state');
    const winner = fin.players.find((p) => p.id === settings.winnerId);
    if (!winner) g.violate('game over without a winner');
    else if (mode === 'closest_year') {
      if (g.roundsPlayed !== OPTS.rounds) g.violate(`played ${g.roundsPlayed} normal rounds, expected ${OPTS.rounds}`);
      if (winner.score !== Math.max(...fin.players.map((p) => p.score))) g.violate('winner does not have the top score');
    } else {
      const maxCards = Math.max(...fin.players.map((p) => p.timeline.length));
      if (winner.timeline.length < OPTS.target || winner.timeline.length !== maxCards) g.violate('winner does not hold the most cards at the target');
    }
    if (fin.players.length !== OPTS.bots) g.violate(`expected ${OPTS.bots} players, found ${fin.players.length}`);
    g.completed = fin.room.status === 'over' && !!winner && g.violations.length === 0 || (fin.room.status === 'over' && !!winner);
  } catch (e) {
    g.violate(`game crashed: ${(e as Error).message.slice(0, 120)}`);
  } finally {
    // Clean up: bots and host leave, the throwaway room is deleted.
    await Promise.all(g.bots.map((b) => b.stop().catch(() => undefined)));
    await host.stop();
    if (g.roomId) {
      try {
        await host.session.deleteRoom(false);
        const gone = await createSupabaseBackend(newClient()).getRoom(g.roomId);
        if (gone) g.violate('room was not deleted at the end');
      } catch (e) { g.violate(`cleanup failed: ${(e as Error).message.slice(0, 80)}`); }
    }
    await closePage(host.page);
  }
  return g;
}

/** One new phone tries a name that is already in use (twice, once with different capitals), then one more name when the room is full. */
async function duplicateNameAttempt(g: Game) {
  const bot = g.bots.find((b) => b.stable && b.phone && !b.refreshing);
  if (!bot) return;
  bot.stable = false; // keep it from refreshing during the attempt
  const page = newPage();
  try {
    for (const name of [bot.name, `${bot.name.toUpperCase()}  `]) {
      g.dup.tried++;
      const r = await joinGame(page.backend, memoryKV(), { code: g.code, name });
      if (!r.ok && r.reason === 'taken') g.dup.rejected++;
      else g.violate(`duplicate name was not rejected (${r.ok ? r.kind : r.reason})`);
    }
    if (g.bots.length >= CONFIG.maxPlayers) {
      g.dup.fullTried++;
      const r = await joinGame(page.backend, memoryKV(), { code: g.code, name: 'Latecomer' });
      if (!r.ok && r.reason === 'full') g.dup.fullRejected++;
      else g.violate(`a player over the limit was not turned away (${r.ok ? r.kind : r.reason})`);
    }
  } catch (e) {
    g.violate(`duplicate-name attempt threw: ${(e as Error).message.slice(0, 80)}`);
  } finally { bot.stable = true; await closePage(page); }
}

// ---------------------------------------------------------------- main
const cleanupRooms: Array<() => Promise<void>> = [];
process.on('SIGINT', () => { void Promise.all(cleanupRooms.map((f) => f())).finally(() => process.exit(130)); });

async function main() {
  const lines: string[] = [];
  let completed = 0; let violations = 0;
  const totals = { tried: 0, ok: 0 };
  let billable = 0; let peak = 0; const allKinds = new Map<string, number>();
  const modeMsgs: Record<string, number> = {};
  console.log(`simulation: modes=${OPTS.modes.join('+')} bots=${OPTS.bots} rounds=${OPTS.rounds} target=${OPTS.target} seconds=${OPTS.seconds}`);
  for (const mode of OPTS.modes) {
    const s0 = snapshotStats();
    const started = Date.now();
    const g = await playGame(mode);
    const s1 = snapshotStats();
    const kinds = new Map<string, number>();
    for (const [k, v] of s1.inByKind) kinds.set(k, v - (s0.inByKind.get(k) ?? 0));
    let gameBillable = 0; for (const [k, v] of kinds) { if (BILLABLE.has(k)) gameBillable += v; allKinds.set(k, (allKinds.get(k) ?? 0) + v); }
    const gamePeak = Math.max(0, ...[...s1.perSec].filter(([s]) => s >= Math.floor(started / 1000)).map(([, v]) => v));
    billable += gameBillable; peak = Math.max(peak, gamePeak); modeMsgs[mode] = gameBillable;
    const rs = [...g.rounds.values()].filter((r) => r.revealedAt);
    const dur = rs.map((r) => r.revealedAt - r.openedAt);
    const lockToReveal = rs.filter((r) => r.lastLockAt).map((r) => r.revealedAt - r.lastLockAt);
    const seen = rs.flatMap((r) => r.seen); const rev = rs.flatMap((r) => r.revealSeen);
    const secs = Math.round((Date.now() - started) / 1000);
    if (g.completed) completed++;
    violations += g.violations.length;
    totals.tried += g.rejoin.tried; totals.ok += g.rejoin.ok;
    lines.push(
      `[${mode}] completed=${g.completed ? 1 : 0} players=${g.bots.length} normalRounds=${g.roundsPlayed} suddenDeath=${g.suddenRounds} duration=${secs}s violations=${g.violations.length}`,
      `[${mode}] rejoins ok=${g.rejoin.ok}/${g.rejoin.tried} (same-device=${g.rejoin.same} other-device=${g.rejoin.other}) stateKept=${g.rejoin.stateKept} stateSkipped=${g.rejoin.stateSkipped} oldTokenRevoked=${g.rejoin.oldTokenDead}`,
      `[${mode}] hostRefresh ok=${g.hostRefresh.ok}/${g.hostRefresh.tried} dupNameRejected=${g.dup.rejected}/${g.dup.tried} fullRoomRejected=${g.dup.fullRejected}/${g.dup.fullTried}`,
      `[${mode}] checks reveals=${g.checks.reveals} rows=${g.checks.rowsVerified} leakChecks=${g.checks.leakChecks} lockedAnswerRejects=${g.checks.lockRejects}/${g.checks.lockRejectsExpected} afterRevealRejects=${g.checks.postRevealRejects} lateRejects=${g.checks.lateRejects} afkRounds=${g.checks.afkRounds} timerEnds=${g.checks.timerEnds}`,
      `[${mode}] round ms (open->reveal) ${fmt(dur)}`,
      `[${mode}] last lock->reveal ms ${fmt(lockToReveal)}; phone sees round ms ${fmt(seen)}; phone sees reveal ms ${fmt(rev)}`,
      `[${mode}] realtime msgs to clients: billable=${gameBillable} (${Math.round(gameBillable / Math.max(1, secs) * 60)}/min) peak=${gamePeak}/s all-frames=${[...kinds.values()].reduce((a, b) => a + b, 0)} sent=${s1.out - s0.out} channelJoins=${s1.joins - s0.joins}`,
    );
    for (const v of g.violations) lines.push(`  VIOLATION ${v}`);
  }
  console.log(lines.join('\n'));
  console.log(`realtime kinds: ${[...allKinds].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  console.log(`postgres_changes by table: ${[...wsStats.tables].map(([k, v]) => `${k}=${v}`).join(' ')}`);
  const over = [...wsStats.billablePerSec.values()].filter((v) => v > 100).length;
  console.log(`seconds above 100 msgs/s: ${over} of ${wsStats.billablePerSec.size} active seconds`);
  console.log(`realtime peak connections=${wsStats.maxOpen} sockets opened=${wsStats.opened} billable total=${billable}`);
  console.log(`SUMMARY games=${completed}/${OPTS.modes.length} rejoins=${totals.ok}/${totals.tried} violations=${violations}`);
  for (const c of allClients) { try { await withTimeout(c.removeAllChannels(), 2000); c.realtime.disconnect(); } catch { /* ignore */ } }
  process.exit(completed === OPTS.modes.length && violations === 0 && totals.ok === totals.tried ? 0 : 1);
}

main().catch((e) => { console.error(`simulation crashed: ${(e as Error).message}`); process.exit(2); });
