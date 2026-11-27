import { CONFIG, normalizeSettings, topBoard, type GameSong, type RevealRow } from '../logic';
import {
  ClosestYearGame, gamePhase, suddenDeathContenders, winnerOf, type ClosestYearReveal, type NextRound,
} from '../game';
import type { HostSession, HostState, PlayerRow, PublicRoomState } from '../net';
import { h, show, withTimeout, type Child } from './dom';
import { leaderboardList, type RoundMark } from './leaderboard';
import { exhaustedPanel, removeSongControl } from './songTools';

/** The bit of an audio element the host needs, so tests can swap in a fake. Clips are streamed, never saved. */
export interface ClipPlayer {
  play(url: string): Promise<void>;
  stop(): void;
  /** Called when the clip cannot be loaded or played. */
  onError(fn: () => void): void;
}
export function htmlClipPlayer(): ClipPlayer {
  const a = new Audio();
  a.preload = 'auto';
  let fail: () => void = () => undefined;
  a.addEventListener('error', () => fail());
  return {
    async play(url) { if (a.src !== url) a.src = url; a.currentTime = 0; await a.play(); },
    stop() { a.pause(); },
    onError(fn) { fail = fn; },
  };
}

export interface HostGameDeps {
  session: HostSession;
  /** Loads the song pool (songs.json). Called once, when the game starts. */
  loadPool: () => Promise<GameSong[]>;
  player: ClipPlayer;
  rng?: () => number;
  now?: () => number;
  /** Small join strip (room code), shown on every game screen. */
  joinStrip: () => Node;
  /** Back to the lobby. */
  onLobby: () => void;
}
export interface HostGame {
  /** Feed every public room update. */
  onPublic(s: PublicRoomState): void;
  /** Start a game in this room (from the lobby Start button). */
  start(): Promise<void>;
  stop(): void;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/**
 * Closest Year on the big screen: plays the clip, runs the countdown, ends the round when everyone has locked in or
 * time is up, then shows the reveal and the scoreboard. All state lives in the room, so a refresh picks up where it was.
 */
export function createHostGame(root: HTMLElement, deps: HostGameDeps): HostGame {
  const { session, player } = deps;
  const now = deps.now ?? Date.now;
  let game: ClosestYearGame | null = null;
  let pool: Map<string, GameSong> = new Map();
  let hs: HostState | null = null;
  let pub: PublicRoomState | null = null;
  let stopped = false;
  let busy = false;
  let seq = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let lastKey = '';
  let notice = '';
  let exhausted: { resetWouldHelp: boolean } | null = null;
  let playingRound = '';
  let needTap = false;
  let clipFailed = false;
  let tick: ReturnType<typeof setInterval> | undefined;
  let countdownEl: HTMLElement | null = null;
  let progressEl: HTMLElement | null = null;
  let loading: Promise<void> | null = null;
  let checksOpen = false; // the artist-guess panel is rebuilt on every redraw, so remember whether the host opened it
  let checksRound = '';
  let ackOver = false; // the host has looked at the last round's answer and moved on to the final results

  player.onError(() => { clipFailed = true; draw(); });

  // ------------------------------------------------------------------ data
  async function ensureGame() {
    if (game) return game;
    loading ??= (async () => {
      const songs = await deps.loadPool();
      pool = new Map(songs.map((s) => [s.id, s]));
      game = new ClosestYearGame({ session, pool: songs, rng: deps.rng ?? Math.random, now });
    })();
    try { await loading; } finally { if (!game) loading = null; }
    return game!;
  }

  async function reload() {
    const mine = ++seq;
    const next = await session.state().catch(() => null);
    if (stopped || mine !== seq) return;
    if (!next) { retryLater(); return; } // never stay on an old screen because one read failed
    hs = next;
    draw();
  }

  /** A read failed: forget what we last drew so the same room state is handled again shortly. */
  function retryLater() {
    lastKey = '';
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => { if (!stopped && pub) onPublic(pub); }, CONFIG.net.retrySeconds * 1000);
  }

  function onPublic(s: PublicRoomState) {
    pub = s;
    if (s.room.mode !== 'closest_year' || s.room.status === 'lobby') { stopTick(); lastKey = ''; return; }
    const key = `${s.room.status}|${s.room.game_no}|${s.round?.id ?? ''}|${s.round?.status ?? ''}|${s.locked.length}|${s.players.map((p) => `${p.score}${p.connected ? 1 : 0}`).join(',')}`;
    if (key === lastKey) return;
    lastKey = key;
    void ensureGame().then(async () => { await reload(); startTick(); void autoEnd(); void repair(); }).catch(() => { notice = 'The song list could not be loaded. Trying again…'; draw(); retryLater(); });
  }

  const guarded = async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
    if (busy) return undefined;
    busy = true; notice = ''; exhausted = null;
    try { return await withTimeout(fn(), CONFIG.net.actionTimeoutSeconds * 1000); } catch { notice = 'That did not work. Check the connection and try again.'; return undefined; } finally { busy = false; await reload(); }
  };

  // ------------------------------------------------------------------ timers
  /** The reveal says winner (or sudden death) but the room never got the matching outcome: write it so the game can finish. */
  async function repair() {
    if (!game || stopped) return;
    try { if (await game.repairOutcome()) await reload(); } catch { retryLater(); }
  }
  async function autoEnd() {
    if (!game || stopped) return;
    try { if (await game.checkAutoEnd()) await reload(); } catch { /* try again on the next tick */ }
  }
  function startTick() {
    if (tick) return;
    tick = setInterval(() => { paintTimers(); void autoEnd(); }, CONFIG.host.tickMs);
  }
  function stopTick() { clearInterval(tick); tick = undefined; }

  function secondsLeft(): number | null {
    const ends = hs?.round?.ends_at;
    return ends ? Math.max(0, Math.ceil((Date.parse(ends) - now()) / 1000)) : null;
  }
  function paintTimers() {
    if (countdownEl) {
      const s = secondsLeft();
      countdownEl.textContent = s === null ? '' : String(s);
      countdownEl.classList.toggle('low', s !== null && s <= 10);
    }
    if (progressEl && hs) { const p = ClosestYearGame.progress(hs); progressEl.textContent = `${p.locked} of ${p.expected} locked in`; }
  }

  // ------------------------------------------------------------------ actions
  const next = () => guarded(async () => {
    const g = await ensureGame();
    const r: NextRound = await g.nextRound();
    if (r.status === 'exhausted') exhausted = { resetWouldHelp: r.resetWouldHelp };
  });
  const skip = () => guarded(async () => { await game?.skipRound(); });
  const endNow = () => guarded(async () => { await game?.endRound(); });
  const override = (playerId: string, v: boolean | null) => guarded(async () => { await game?.setArtistOverride(playerId, v); });
  const resetPlayed = () => guarded(async () => { await session.resetPlayed(); });
  const unblockSong = () => guarded(async () => { if (hs?.round) await session.unblockSong(hs.round.song_id); });
  const blockSong = () => guarded(async () => { if (hs?.round) await session.blockSong(hs.round.song_id); });
  // "Final results": make sure the room really is over (repairing a missing outcome), then show the winner screen.
  const finish = () => guarded(async () => { await (await ensureGame()).repairOutcome(); ackOver = true; });
  const again = () => guarded(async () => { await (await ensureGame()).playAgain(); ackOver = false; checksOpen = false; }); // only after it worked, so a failed try stays on the winner screen

  // Start always means a brand-new game: clear the old rounds, scores and results first, so a finished game can never come back.
  async function start() {
    const g = await ensureGame();
    await g.playAgain();
    ackOver = false; checksOpen = false;
    await reload();
  }

  // ------------------------------------------------------------------ audio
  function playClip() {
    const r = hs?.round;
    if (!r) return;
    const url = pool.get(r.song_id)?.previewUrl;
    if (!url) { clipFailed = true; draw(); return; }
    needTap = false;
    player.play(url).then(() => { clipFailed = false; if (needTap) { needTap = false; draw(); } }).catch((e: unknown) => {
      // Browsers block sound until the page has been tapped once. Offer a button rather than failing.
      if (e instanceof DOMException && e.name === 'NotAllowedError') needTap = true; else clipFailed = true;
      draw();
    });
  }

  // ------------------------------------------------------------------ pieces
  const scoreboard = (players: readonly PlayerRow[], gained?: Map<string, number>, highlight?: string | null) => {
    const sorted = [...players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    return h('ol', { class: 'scoreboard', 'data-scoreboard': String(sorted.length) },
      ...sorted.map((p) => h('li', { class: `score-row${p.id === highlight ? ' winner' : ''}`, 'data-player': p.name, 'data-score': String(p.score) },
        h('span', { class: 'sb-name' }, p.name),
        gained && (gained.get(p.id) ?? 0) > 0 && h('span', { class: 'sb-gain' }, `+${gained.get(p.id)}`),
        h('span', { class: 'sb-score' }, p.score))));
  };

  const roundLabel = (s: HostState) => {
    const st = normalizeSettings(s.room.settings);
    const sudden = s.round?.kind === 'sudden_death';
    const played = typeof s.room.settings.roundsPlayed === 'number' ? (s.room.settings.roundsPlayed as number) : 0;
    return sudden ? 'Sudden death' : `Round ${Math.min(played + (gamePhase(s) === 'reveal' ? 0 : 1), st.rounds)} of ${st.rounds}`;
  };

  const frame = (stage: string, s: HostState, ...kids: Array<Node | null | false>) =>
    h('main', { class: 'screen host game', 'data-stage': stage },
      h('header', { class: 'game-head' }, h('span', { class: 'round-label', 'data-round-label': '' }, roundLabel(s)), deps.joinStrip()),
      ...kids,
      exhausted && exhaustedPanel(exhausted.resetWouldHelp, () => void resetPlayed()),
      notice && h('p', { class: 'notice', role: 'alert' }, notice));

  function betweenScreen(s: HostState) {
    const contenders = suddenDeathContenders(s.room.settings);
    const first = !s.room.settings.roundsPlayed;
    const names = s.players.filter((p) => contenders.includes(p.id)).map((p) => p.name);
    return frame('between', s,
      h('section', { class: 'stage-center' },
        contenders.length > 0
          ? h('p', { class: 'lead' }, `Sudden death: ${names.join(' and ')} are tied`)
          : h('p', { class: 'lead' }, first ? 'Everyone ready? Phones out.' : 'Next song coming up'),
        h('button', { class: 'btn primary huge', 'data-action': 'next', disabled: busy ? true : null, onclick: () => void next() },
          first && contenders.length === 0 ? 'Play first song' : 'Play next song')),
      scoreboard(s.players));
  }

  function listeningScreen(s: HostState) {
    const p = ClosestYearGame.progress(s);
    countdownEl = h('div', { class: 'countdown-big', 'data-countdown': '', 'aria-live': 'off' });
    progressEl = h('p', { class: 'progress', 'data-progress': '' }, `${p.locked} of ${p.expected} locked in`);
    const sudden = s.round?.kind === 'sudden_death';
    return frame('listening', s,
      h('section', { class: 'stage-center' },
        h('p', { class: 'lead' }, sudden ? 'Sudden death: guess the year' : 'What year is this song from?'),
        h('div', { class: 'note-art', 'aria-hidden': 'true' }, '♪'),
        countdownEl, progressEl,
        needTap && h('button', { class: 'btn primary huge', 'data-action': 'play', onclick: playClip }, 'Tap to play the song'),
        clipFailed && h('p', { class: 'notice', role: 'alert', 'data-clip': 'failed' }, 'The clip would not play.'),
        h('div', { class: 'row-actions' },
          clipFailed && h('button', { class: 'btn primary', 'data-action': 'skip', onclick: () => void skip() }, 'Skip this song'),
          !clipFailed && h('button', { class: 'btn ghost', 'data-action': 'replay', onclick: playClip }, 'Replay clip'),
          h('button', { class: 'btn ghost', 'data-action': 'end-now', onclick: () => void endNow() }, 'End round now'))),
      scoreboard(s.players));
  }

  function closedScreen(s: HostState) {
    return frame('closed', s, h('section', { class: 'stage-center' }, h('p', { class: 'lead' }, 'Counting up the scores…'),
      h('button', { class: 'btn primary', 'data-action': 'end-now', onclick: () => void endNow() }, 'Show the answer')));
  }

  /** Host-only artist check: what was typed, the verdict, and the override buttons. Not part of the leaderboard. */
  function checkLine(row: RevealRow, name: string) {
    const verdict = row.artistHit ? 'Artist ✓' : 'Artist ✗';
    const btn = (label: string, v: boolean | null, on: boolean) => h('button', {
      class: `btn small ${on ? 'primary' : 'ghost'}`, 'data-override': String(v), 'aria-pressed': String(on),
      onclick: () => void override(row.playerId, v),
    }, label);
    return h('li', { class: 'reveal-row', 'data-player': name, 'data-total': String(row.total) },
      h('span', { class: 'rr-name' }, name),
      h('span', { class: `rr-artist${row.artistHit ? ' hit' : ''}`, 'data-artist-hit': String(row.artistHit) }, `"${row.typed}" ${verdict}`),
      h('span', { class: 'rr-override', 'data-override-for': name },
        btn('Count it', true, row.override === true), btn('Reject', false, row.override === false),
        row.override !== null && btn('Auto', null, false)));
  }

  function revealScreen(s: HostState) {
    const rv = s.round!.reveal as ClosestYearReveal;
    const byId = new Map(s.players.map((p) => [p.id, p]));
    const sudden = rv.kind === 'sudden_death';
    const checks = rv.rows.filter((r) => r.typed !== '').sort((a, b) => (byId.get(a.playerId)?.name ?? '').localeCompare(byId.get(b.playerId)?.name ?? ''));
    const marks = new Map<string, RoundMark>(rv.rows.map((r) => [r.playerId, {
      ...(sudden ? { note: r.year === null ? 'no answer' : r.distance === 0 ? 'spot on' : `off by ${r.distance}` } : { points: r.total }),
      artist: sudden || r.typed === '' ? 'none' : r.artistHit ? 'hit' : 'miss',
    }]));
    const board = topBoard('closestYear', s.players.map((p) => ({ id: p.id, name: p.name, total: p.score })));
    const o = rv.outcome;
    const label = o.status === 'continue' ? 'Next song' : o.status === 'suddenDeath' ? 'Sudden death' : 'Final results';
    const art = rv.song.artworkUrl;
    return frame('reveal', s,
      h('section', { class: 'reveal-card' },
        art && h('img', { class: 'artwork', src: art, alt: '', width: 160, height: 160 }),
        h('div', { class: 'reveal-text' },
          h('p', { class: 'label' }, 'The answer'),
          h('p', { class: 'answer-year', 'data-answer-year': String(rv.song.year) }, String(rv.song.year)),
          h('p', { class: 'answer-song', 'data-answer-song': '' }, `${rv.song.title}`),
          h('p', { class: 'answer-artist' }, [...rv.song.artists, ...rv.song.featuredArtists.map((a) => `feat. ${a}`)].join(', ')))),
      leaderboardList('closestYear', board, marks),
      sudden && h('p', { class: 'hint' }, 'Sudden death does not change scores.'),
      !sudden && checks.length > 0 && checksPanel(s, checks.length,
        h('summary', {}, `Check artist guesses (${checks.length})`),
        h('ul', { class: 'reveal-rows' }, ...checks.map((r) => checkLine(r, byId.get(r.playerId)?.name ?? '?')))),
      h('div', { class: 'row-actions' },
        h('button', { class: 'btn primary huge', 'data-action': 'next', disabled: busy ? true : null,
          onclick: () => { if (o.status === 'winner') void finish(); else void next(); } }, label),
        removeSongControl(!!hs?.round && s.blocked.includes(hs.round.song_id), () => void blockSong(), () => void unblockSong())));
  }

  /** The "check artist guesses" panel. The screen is rebuilt on every update, so its open state lives here, per round. */
  function checksPanel(s: HostState, count: number, ...kids: Child[]) {
    const rid = s.round?.id ?? '';
    if (rid !== checksRound) { checksRound = rid; checksOpen = false; }
    return h('details', {
      class: 'artist-checks', 'data-artist-checks': String(count), open: checksOpen ? true : null,
      ontoggle: (e) => { checksOpen = (e.target as HTMLDetailsElement).open; },
    }, ...kids);
  }

  function overScreen(s: HostState) {
    const w = winnerOf(s.room.settings);
    const winner = s.players.find((p) => p.id === w?.winnerId);
    const tie = w?.decidedBy && w.decidedBy !== 'score' ? w.decidedBy : '';
    return h('main', { class: 'screen host game', 'data-stage': 'over' },
      h('header', { class: 'game-head' }, h('span', { class: 'round-label' }, 'Game over'), deps.joinStrip()),
      h('section', { class: 'stage-center' },
        winner ? h('p', { class: 'winner-line', 'data-winner': winner.name }, `${winner.name} wins!`) : h('p', { class: 'winner-line' }, 'That is the game'),
        tie && h('p', { class: 'hint' }, `Decided by ${tie}`)),
      scoreboard(s.players, undefined, winner?.id ?? null),
      h('div', { class: 'row-actions' },
        h('button', { class: 'btn primary huge', 'data-action': 'play-again', onclick: () => void again() }, 'Play again'),
        h('button', { class: 'btn ghost', 'data-action': 'back-to-lobby', onclick: () => deps.onLobby() }, 'Back to lobby')),
      notice && h('p', { class: 'notice', role: 'alert' }, notice));
  }

  // ------------------------------------------------------------------ draw
  function draw() {
    if (stopped || !hs || hs.room.mode !== 'closest_year') return;
    countdownEl = null; progressEl = null;
    const phase = gamePhase(hs);
    if (phase !== 'listening') { player.stop(); playingRound = ''; needTap = false; clipFailed = false; }
    let node: Node;
    switch (phase) {
      case 'over': node = !ackOver && hs.round?.status === 'revealed' && hs.round.reveal ? revealScreen(hs) : overScreen(hs); break;
      case 'reveal': node = revealScreen(hs); break;
      case 'listening': node = listeningScreen(hs); break;
      case 'closed': node = closedScreen(hs); break;
      default: node = betweenScreen(hs);
    }
    show(root, node);
    paintTimers();
    if (phase === 'listening' && hs.round && playingRound !== hs.round.id) { playingRound = hs.round.id; playClip(); }
  }

  return {
    onPublic,
    start,
    stop() { stopped = true; clearTimeout(retryTimer); stopTick(); player.stop(); },
  };
}
