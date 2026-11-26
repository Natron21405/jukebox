import { CONFIG, ordinal, rankOf, yearRangeOf, type RevealRow } from '../logic';
import { phoneView, sendAnswer, winnerOf, type PhoneView } from '../game';
import type { MyState, PhoneSession, PlayerRow, PublicRoomState, StoredSeat } from '../net';
import { h, show } from './dom';
import { createYearPicker, type YearPicker } from './yearPicker';

export interface PhoneGameDeps {
  phone: PhoneSession;
  seat: StoredSeat;
  /** Wall clock in ms (injected so tests control the countdown). */
  now?: () => number;
}
export interface PhoneGame {
  /** Feed every public room update here; the phone re-reads its own state only when the round or room changes. */
  onPublic(s: PublicRoomState): void;
  /** Re-read now (page became visible again). */
  refresh(): Promise<void>;
  stop(): void;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/**
 * The Closest Year screens on a phone: waiting, the answer screen (year picker + artist box + Lock In), locked in,
 * and the result. It redraws only when the stage or round changes, so typing and dragging are never interrupted.
 */
export function createPhoneGame(root: HTMLElement, deps: PhoneGameDeps): PhoneGame {
  const { phone, seat } = deps;
  const now = deps.now ?? Date.now;
  let stopped = false;
  let my: MyState | null = null;
  let pub: PublicRoomState | null = null;
  let seq = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let lastKey = '';
  let drawn = '';
  let lastYear: number | null = null; // this player's last guess, so the next round starts where they left off
  let picker: YearPicker | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let tick: ReturnType<typeof setInterval> | undefined;
  let draft: { roundId: string; year: number; artist: string } | null = null;
  let localLock: { roundId: string; year: number; artist: string } | null = null;

  const clearTimers = () => { clearTimeout(saveTimer); clearInterval(tick); tick = undefined; picker?.destroy(); picker = null; };

  // ------------------------------------------------------------------ data
  async function refresh() {
    const mine = ++seq;
    const next = await phone.state().catch(() => null);
    if (stopped || mine !== seq) return;
    if (!next) { retryLater(); return; } // never stay on an old screen because one read failed
    my = next;
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
    if (s.room.mode !== 'closest_year' || s.room.status === 'lobby') { lastKey = ''; drawn = ''; my = null; clearTimers(); return; }
    const key = `${s.room.status}|${s.room.game_no}|${s.room.mode}|${s.round?.id ?? ''}|${s.round?.status ?? ''}|${s.players.find((p) => p.id === seat.playerId)?.score ?? ''}`; // my score changes when the host overrides an artist
    if (key !== lastKey) { lastKey = key; void refresh(); }
  }

  // ------------------------------------------------------------------ sending
  function save(lock: boolean) {
    if (!draft) return Promise.resolve(null);
    clearTimeout(saveTimer);
    return sendAnswer(phone, draft.roundId, { year: draft.year, artist: draft.artist, lock });
  }
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { void save(false).catch(() => undefined); }, CONFIG.yearPicker.saveDebounceMs);
  };

  // ------------------------------------------------------------------ screens
  const header = (view: PhoneView, extra?: Node | null) => h('div', { class: 'phone-head' },
    h('span', { class: 'you-small', 'data-you': seat.name }, seat.name),
    extra,
    h('span', { class: 'score-chip', 'data-score': String(view.score) }, plural(view.score, 'pt')),
  );

  function secondsLeft(): number | null {
    const ends = my?.round?.ends_at;
    return ends ? Math.max(0, Math.ceil((Date.parse(ends) - now()) / 1000)) : null;
  }
  function countdownEl() {
    const el = h('span', { class: 'countdown', 'data-countdown': '' });
    const paint = () => { const s = secondsLeft(); el.textContent = s === null ? '' : `${s}s`; el.classList.toggle('low', s !== null && s <= 10); };
    paint();
    clearInterval(tick);
    tick = setInterval(paint, 500);
    return el;
  }

  function screen(stage: string, ...kids: Array<Node | null | false>) {
    return h('main', { class: 'screen phone game', 'data-stage': stage }, ...kids);
  }

  function waitingScreen(view: PhoneView) {
    return screen('waiting',
      header(view),
      h('div', { class: 'big-message' },
        h('p', { class: 'lead' }, 'Get ready for the next song…'),
        h('p', { class: 'hint' }, 'Listen to the big screen.')),
    );
  }

  function watchingScreen(view: PhoneView) {
    return screen('watching', header(view), h('div', { class: 'big-message' },
      h('p', { class: 'lead' }, 'Sudden death!'),
      h('p', { class: 'hint' }, 'Only the tied players guess this one. Watch the big screen.')));
  }

  function lockedScreen(view: PhoneView, year: number | null, artist: string, timeUp: boolean) {
    return screen('locked',
      header(view, timeUp ? null : countdownEl()),
      h('div', { class: 'big-message' },
        h('p', { class: 'locked-badge' }, timeUp ? 'Time is up' : 'Locked in ✓'),
        h('p', { class: 'locked-year', 'data-locked-year': String(year ?? '') }, year === null ? 'No year' : String(year)),
        artist && h('p', { class: 'locked-artist' }, `Artist: ${artist}`),
        h('p', { class: 'hint' }, timeUp ? 'Waiting for the results…' : 'Waiting for the others…')),
    );
  }

  function answerScreen(view: PhoneView, state: MyState) {
    const round = state.round!;
    const range = yearRangeOf(state.room.settings);
    const roundId = round.id;
    const saved = state.answer;
    const startAt = saved?.year ?? lastYear;
    const startArtist = saved?.artist_guess ?? '';
    draft = { roundId, year: 0, artist: startArtist };

    picker = createYearPicker({
      range, initial: startAt,
      onChange: (y) => { draft!.year = y; lastYear = y; scheduleSave(); },
    });
    draft.year = picker.value();

    const artist = h('input', {
      class: 'field', id: 'artist', name: 'artist', type: 'text', autocomplete: 'off', autocapitalize: 'words',
      autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'done', maxlength: 100, value: startArtist,
      placeholder: 'Artist (optional, +2 points)', 'aria-label': 'Artist, optional', 'data-role': 'artist',
    });
    artist.addEventListener('input', () => { draft!.artist = artist.value; scheduleSave(); });

    const message = h('p', { class: 'notice', role: 'alert', 'data-message': 'answer' });
    message.hidden = true;
    const lockBtn = h('button', { class: 'btn primary huge', type: 'button', 'data-action': 'lock' }, 'Lock in');

    lockBtn.addEventListener('click', () => {
      if (!draft) return;
      const d = { ...draft, year: picker!.value(), artist: artist.value };
      draft = d;
      lockBtn.disabled = true; lockBtn.textContent = 'Locking in…';
      message.hidden = true;
      void (async () => {
        let r;
        try { r = await save(true); } catch { r = null; }
        if (stopped) return;
        if (r && (r.ok || r.reason === 'already-locked')) {
          lastYear = d.year;
          localLock = { roundId, year: d.year, artist: d.artist };
          drawn = ''; draw(); // show the locked-in confirmation right away
          void refresh();
        } else if (r && !r.ok && r.reason === 'round-closed') {
          void refresh();
        } else {
          message.textContent = 'That did not go through. Check your connection and tap Lock in again.';
          message.hidden = false;
          lockBtn.disabled = false; lockBtn.textContent = 'Lock in';
        }
      })();
    });

    return screen('answer',
      header(view, countdownEl()),
      h('p', { class: 'label center-text' }, 'What year was this song released?'),
      picker.el,
      h('label', { class: 'label', for: 'artist' }, 'Who sings it?'),
      artist,
      message,
      lockBtn,
      h('p', { class: 'hint' }, 'Your pick is saved as you go. After you lock in it cannot be changed.'),
    );
  }

  function resultScreen(view: PhoneView, state: MyState) {
    const reveal = state.round?.reveal as { song?: { year: number } } | null;
    const year = reveal?.song?.year;
    const row: RevealRow | null = view.mine;
    const lines: Node[] = [];
    if (row && row.year !== null) {
      lines.push(h('p', { class: 'result-line' }, `You said ${row.year}`, row.distance === 0 ? ' · spot on!' : ` · off by ${plural(row.distance ?? 0, 'year')}`));
    } else {
      lines.push(h('p', { class: 'result-line' }, 'You did not answer this one.'));
    }
    if (row && row.typed) {
      lines.push(h('p', { class: 'result-line', 'data-artist-hit': String(row.artistHit) }, row.artistHit ? `Artist ✓ ${row.typed}` : `Artist ✗ ${row.typed}`));
    }
    const sudden = state.round?.kind === 'sudden_death';
    return screen('result',
      header(view),
      h('div', { class: 'big-message' },
        year !== undefined && h('p', { class: 'label' }, 'The year was'),
        year !== undefined && h('p', { class: 'locked-year', 'data-answer-year': String(year) }, String(year)),
        ...lines,
        sudden
          ? h('p', { class: 'points' }, 'Sudden death: no points')
          : h('p', { class: 'points', 'data-points': String(row?.total ?? 0) }, `+${plural(row?.total ?? 0, 'point')}`),
        h('p', { class: 'hint' }, `Total: ${plural(view.score, 'point')}`),
        ownRank(state),
        view.over && finalLine(view, state)),
    );
  }

  /** The player's own place, ties sharing, e.g. "You are 3rd of 12". */
  function ownRank(state: MyState) {
    const players: PlayerRow[] = pub?.players ?? [state.player];
    const rank = rankOf('closestYear', players.map((p) => ({ id: p.id, name: p.name, total: p.score })), state.player.id);
    return rank === null ? null : h('p', { class: 'own-rank', 'data-own-rank': String(rank) }, `You are ${ordinal(rank)} of ${players.length}`);
  }

  function finalLine(view: PhoneView, state: MyState) {
    const players: PlayerRow[] = pub?.players ?? [state.player];
    const sorted = [...players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    const win = winnerOf(state.room.settings);
    const winner = players.find((p) => p.id === win?.winnerId);
    const place = sorted.findIndex((p) => p.id === state.player.id) + 1;
    const ord = place === 1 ? '1st' : place === 2 ? '2nd' : place === 3 ? '3rd' : `${place}th`;
    return h('div', { class: 'final-line', 'data-final': '' },
      h('p', { class: 'label' }, 'Game over'),
      winner && h('p', { class: 'lead', 'data-winner': winner.name }, winner.id === state.player.id ? 'You won! 🎉' : `${winner.name} wins`),
      h('p', { class: 'hint' }, `You finished ${ord} with ${plural(view.score, 'point')}. Waiting for the host to play again…`));
  }

  function overScreen(view: PhoneView, state: MyState) {
    const players: PlayerRow[] = pub?.players ?? [state.player];
    const sorted = [...players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    const win = winnerOf(state.room.settings);
    const winner = players.find((p) => p.id === win?.winnerId);
    const place = sorted.findIndex((p) => p.id === state.player.id) + 1;
    return screen('over',
      header(view),
      h('div', { class: 'big-message' },
        h('p', { class: 'label' }, 'Game over'),
        winner && h('p', { class: 'locked-year', 'data-winner': winner.name }, winner.id === state.player.id ? 'You won! 🎉' : `${winner.name} wins`),
        h('p', { class: 'lead' }, `You finished ${place === 1 ? '1st' : place === 2 ? '2nd' : place === 3 ? '3rd' : `${place}th`} with ${plural(view.score, 'point')}`),
        h('p', { class: 'hint' }, 'Waiting for the host to play again…')),
    );
  }

  // ------------------------------------------------------------------ choose and draw
  function draw() {
    if (stopped || !my || my.room.mode !== 'closest_year') return;
    const view = phoneView(my);
    const round = my.round;
    // Forget a local lock from an older round.
    if (localLock && localLock.roundId !== round?.id) localLock = null;

    let stage: string = view.stage;
    const locallyLocked = localLock && round && localLock.roundId === round.id && stage === 'answer';
    if (view.over && view.stage !== 'result') stage = 'over';
    if (view.over && view.stage === 'result') stage = 'result';
    if (locallyLocked) stage = 'locked';
    const key = `${stage}|${round?.id ?? ''}|${view.score}|${stage === 'locked' ? round?.status : ''}|${view.mine ? view.mine.total : ''}`;
    if (key === drawn) return;
    drawn = key;
    clearTimers();

    let node: Node;
    if (stage === 'over') node = overScreen(view, my);
    else if (stage === 'result') node = resultScreen(view, my);
    else if (stage === 'watching') node = watchingScreen(view);
    else if (stage === 'locked') {
      const a = my.answer;
      const l = localLock;
      node = lockedScreen(view, a?.locked ? a.year : l?.year ?? a?.year ?? null, a?.locked ? a.artist_guess : l?.artist ?? a?.artist_guess ?? '', round?.status === 'closed');
    } else if (stage === 'answer' && round) node = answerScreen(view, my);
    else node = waitingScreen(view);
    show(root, node);
  }

  return {
    onPublic,
    refresh,
    stop() { stopped = true; clearTimeout(retryTimer); clearTimers(); },
  };
}
