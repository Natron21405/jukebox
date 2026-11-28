import { CONFIG, ordinal, rankOf, slotLabel, yearRangeOf } from '../logic';
import { sendTimelineAnswer, timelinePhoneView, winnerOf, type TimelinePhoneView, type TimelineReveal } from '../game';
import type { MyState, PlayerRow, PublicRoomState } from '../net';
import { h, show } from './dom';
import { answerBlock } from './answerBlock';
import type { PhoneGame, PhoneGameDeps } from './phoneGame';
import { cardRow, createTimelinePicker, type TimelinePicker } from './timelinePicker';
import { createYearPicker, type YearPicker } from './yearPicker';

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/**
 * The Timeline screens on a phone: waiting, the answer screen (your own timeline with tappable gaps, an artist box,
 * Lock In), locked in, and the result. Sudden death asks for a year with the year picker instead. It redraws only
 * when the stage or round changes, so typing is never interrupted. A pick is saved as you go and can be changed
 * until Lock In (which is final) or until time is up.
 */
export function createPhoneTimeline(root: HTMLElement, deps: PhoneGameDeps): PhoneGame {
  const { phone, seat } = deps;
  const now = deps.now ?? Date.now;
  let stopped = false;
  let my: MyState | null = null;
  let pub: PublicRoomState | null = null;
  let seq = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let lastKey = '';
  let drawn = '';
  let slotPicker: TimelinePicker | null = null;
  let yearPick: YearPicker | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let tick: ReturnType<typeof setInterval> | undefined;
  let draft: { roundId: string; slot: number | null; year: number | null; artist: string } | null = null;
  let localLock: { roundId: string; slot: number | null; year: number | null; artist: string } | null = null;
  let lastYear: number | null = null;

  const clearTimers = () => { clearTimeout(saveTimer); clearInterval(tick); tick = undefined; yearPick?.destroy(); yearPick = null; slotPicker = null; };

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
    if (s.room.mode !== 'timeline' || s.room.status === 'lobby') { lastKey = ''; drawn = ''; my = null; clearTimers(); return; }
    const me = s.players.find((p) => p.id === seat.playerId);
    const key = `${s.room.status}|${s.room.game_no}|${s.round?.id ?? ''}|${s.round?.status ?? ''}|${me?.timeline.length ?? ''}|${me?.artist_hits ?? ''}`; // artist hits change when the host overrides
    if (key !== lastKey) { lastKey = key; void refresh(); }
  }

  // ------------------------------------------------------------------ sending
  function save(lock: boolean) {
    if (!draft) return Promise.resolve(null);
    clearTimeout(saveTimer);
    return sendTimelineAnswer(phone, draft.roundId, { slot: draft.slot, year: draft.year, artist: draft.artist, lock });
  }
  const scheduleSave = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { void save(false).catch(() => undefined); }, CONFIG.yearPicker.saveDebounceMs);
  };

  // ------------------------------------------------------------------ screens
  const header = (view: TimelinePhoneView, extra?: Node | null) => h('div', { class: 'phone-head' },
    h('span', { class: 'you-small', 'data-you': seat.name }, seat.name),
    extra,
    h('span', { class: 'score-chip', 'data-cards': String(view.timeline.length) }, plural(view.timeline.length, 'card')),
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
  const screen = (stage: string, ...kids: Array<Node | null | false>) =>
    h('main', { class: 'screen phone game timeline', 'data-stage': stage }, ...kids);

  const waitingScreen = (view: TimelinePhoneView) => screen('waiting', header(view),
    h('div', { class: 'big-message' },
      h('p', { class: 'lead' }, view.timeline.length === 0 ? 'You are in for the next song…' : 'Get ready for the next song…'),
      h('p', { class: 'hint' }, 'Listen to the big screen.')),
    view.timeline.length > 0 && cardRow(view.timeline));

  const watchingScreen = (view: TimelinePhoneView) => screen('watching', header(view), h('div', { class: 'big-message' },
    h('p', { class: 'lead' }, 'Sudden death!'),
    h('p', { class: 'hint' }, 'Only the tied players guess this one. Watch the big screen.')),
    cardRow(view.timeline));

  function lockedScreen(view: TimelinePhoneView, a: { slot: number | null; year: number | null; artist: string }, timeUp: boolean) {
    const sudden = view.input === 'year';
    const what = sudden
      ? (a.year === null ? 'No year' : String(a.year))
      : (a.slot === null ? 'No placement' : slotLabel(view.timeline, a.slot));
    return screen('locked',
      header(view, timeUp ? null : countdownEl()),
      h('div', { class: 'big-message' },
        h('p', { class: 'locked-badge' }, timeUp ? 'Time is up' : 'Locked in ✓'),
        h('p', { class: 'locked-slot', 'data-locked-slot': String(a.slot ?? ''), 'data-locked-year': String(a.year ?? '') }, what),
        a.artist && h('p', { class: 'locked-artist' }, `Artist: ${a.artist}`),
        h('p', { class: 'hint' }, timeUp ? 'Waiting for the results…' : 'Waiting for the others…')),
      !sudden && cardRow(view.timeline));
  }

  function answerScreen(view: TimelinePhoneView, state: MyState) {
    const round = state.round!;
    const roundId = round.id;
    const sudden = view.input === 'year';
    const saved = state.answer;
    const startArtist = saved?.artist_guess ?? '';
    draft = { roundId, slot: null, year: null, artist: startArtist };

    let picker: Node;
    if (sudden) {
      yearPick = createYearPicker({
        range: yearRangeOf(state.room.settings), initial: saved?.year ?? lastYear,
        onChange: (y) => { draft!.year = y; lastYear = y; scheduleSave(); },
      });
      draft.year = yearPick.value();
      picker = yearPick.el;
    } else {
      slotPicker = createTimelinePicker({
        timeline: view.timeline, initial: saved?.slot ?? null,
        onChange: (s) => { draft!.slot = s; scheduleSave(); },
      });
      draft.slot = slotPicker.value();
      picker = slotPicker.el;
    }

    const artist = h('input', {
      class: 'field', id: 'artist', name: 'artist', type: 'text', autocomplete: 'off', autocapitalize: 'words',
      autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'done', maxlength: 100, value: startArtist,
      placeholder: sudden ? 'Artist (optional)' : 'Artist (optional, breaks ties)', 'aria-label': 'Artist, optional', 'data-role': 'artist',
    });
    artist.addEventListener('input', () => { draft!.artist = artist.value; scheduleSave(); });

    const message = h('p', { class: 'notice', role: 'alert', 'data-message': 'answer' });
    message.hidden = true;
    const lockBtn = h('button', { class: 'btn primary huge', type: 'button', 'data-action': 'lock' }, 'Lock in');

    lockBtn.addEventListener('click', () => {
      if (!draft) return;
      const d = { ...draft, slot: slotPicker ? slotPicker.value() : null, year: yearPick ? yearPick.value() : null, artist: artist.value };
      draft = d;
      lockBtn.disabled = true; lockBtn.textContent = 'Locking in…';
      message.hidden = true;
      void (async () => {
        let r;
        try { r = await save(true); } catch { r = null; }
        if (stopped) return;
        if (r && (r.ok || r.reason === 'already-locked')) {
          localLock = { roundId, slot: d.slot, year: d.year, artist: d.artist };
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
      h('p', { class: 'label center-text' }, sudden ? 'Sudden death: what year was this song released?' : 'Where does this song go in your timeline?'),
      picker,
      !sudden && h('p', { class: 'hint', 'data-slot-hint': '' }, 'Tap a + to place the song. You can change it until you lock in.'),
      h('label', { class: 'label', for: 'artist' }, 'Who sings it?'),
      artist,
      message,
      lockBtn,
      h('p', { class: 'hint' }, 'Your pick is saved as you go. After you lock in it cannot be changed.'),
    );
  }

  function resultScreen(view: TimelinePhoneView, state: MyState) {
    const reveal = state.round?.reveal as TimelineReveal | null;
    const year = reveal?.song.year;
    const row = view.mine;
    const sudden = state.round?.kind === 'sudden_death';
    const lines: Node[] = [];
    if (sudden) {
      lines.push(h('p', { class: 'result-line' }, row && row.year !== null
        ? `You said ${row.year}${row.distance === 0 ? ' · spot on!' : ` · off by ${plural(row.distance ?? 0, 'year')}`}`
        : 'You did not answer this one.'));
    } else if (row) {
      lines.push(h('p', { class: `result-verdict ${row.correct ? 'right' : 'wrong'}`, 'data-correct': String(row.correct) },
        row.correct ? 'Correct! The card is yours.' : row.slot === null ? 'No placement. No card this time.' : 'Not quite. No card this time.'));
    } else {
      lines.push(h('p', { class: 'result-line' }, 'You sat this one out.'));
    }
    if (row && row.typed && !sudden) {
      lines.push(h('p', { class: 'result-line', 'data-artist-hit': String(row.artistHit) }, row.artistHit ? `Artist ✓ ${row.typed}` : `Artist ✗ ${row.typed}`));
    }
    const newest = (c: { songId?: string }) => !!reveal && !sudden && !!row?.correct && c.songId === reveal.song.id;
    return screen('result',
      header(view),
      h('div', { class: 'big-message' },
        year !== undefined && h('p', { class: 'label' }, 'The year was'),
        year !== undefined && h('p', { class: 'locked-year', 'data-answer-year': String(year) }, String(year)),
        answerBlock(reveal?.song),
        ...lines,
        h('p', { class: 'hint' }, `${plural(view.timeline.length, 'card')} in your timeline · ${plural(view.artistHits, 'artist hit')}`),
        ownRank(state)),
      cardRow(view.timeline, newest),
      view.over && finalLine(view, state));
  }

  /** The player's own place, ties sharing, e.g. "You are 3rd of 12". */
  function ownRank(state: MyState) {
    const players: PlayerRow[] = pub?.players ?? [state.player];
    const rank = rankOf('timeline', players.map((p) => ({ id: p.id, name: p.name, total: p.timeline.length, hits: p.artist_hits })), state.player.id);
    return rank === null ? null : h('p', { class: 'own-rank', 'data-own-rank': String(rank) }, `You are ${ordinal(rank)} of ${players.length}`);
  }

  function standing(state: MyState) {
    const players: PlayerRow[] = pub?.players ?? [state.player];
    const sorted = [...players].sort((a, b) => b.timeline.length - a.timeline.length || b.artist_hits - a.artist_hits || a.name.localeCompare(b.name));
    const win = winnerOf(state.room.settings);
    const winner = players.find((p) => p.id === win?.winnerId);
    const place = sorted.findIndex((p) => p.id === state.player.id) + 1;
    return { winner, place };
  }

  function finalLine(view: TimelinePhoneView, state: MyState) {
    const { winner, place } = standing(state);
    return h('div', { class: 'final-line', 'data-final': '' },
      h('p', { class: 'label' }, 'Game over'),
      winner && h('p', { class: 'lead', 'data-winner': winner.name }, winner.id === state.player.id ? 'You won! 🎉' : `${winner.name} wins`),
      h('p', { class: 'hint' }, `You finished ${ordinal(place)} with ${plural(view.timeline.length, 'card')}. Waiting for the host to play again…`));
  }

  function overScreen(view: TimelinePhoneView, state: MyState) {
    const { winner, place } = standing(state);
    return screen('over', header(view),
      h('div', { class: 'big-message' },
        h('p', { class: 'label' }, 'Game over'),
        winner && h('p', { class: 'locked-year', 'data-winner': winner.name }, winner.id === state.player.id ? 'You won! 🎉' : `${winner.name} wins`),
        h('p', { class: 'lead' }, `You finished ${ordinal(place)} with ${plural(view.timeline.length, 'card')}`),
        h('p', { class: 'hint' }, 'Waiting for the host to play again…')),
      cardRow(view.timeline));
  }

  // ------------------------------------------------------------------ choose and draw
  function draw() {
    if (stopped || !my) return;
    const view = timelinePhoneView(my);
    const round = my.round;
    if (localLock && localLock.roundId !== round?.id) localLock = null;

    let stage: string = view.stage;
    if (view.over && view.stage !== 'result') stage = 'over';
    if (localLock && round && localLock.roundId === round.id && stage === 'answer') stage = 'locked';
    const key = `${stage}|${view.over}|${round?.id ?? ''}|${view.timeline.length}|${stage === 'locked' ? round?.status : ''}|${view.mine ? `${view.mine.correct}${view.mine.artistHit}` : ''}`;
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
      const from = a?.locked ? { slot: a.slot, year: a.year, artist: a.artist_guess } : l ?? { slot: a?.slot ?? null, year: a?.year ?? null, artist: a?.artist_guess ?? '' };
      node = lockedScreen(view, { slot: from.slot ?? null, year: from.year ?? null, artist: from.artist ?? '' }, round?.status === 'closed');
    } else if (stage === 'answer' && round) node = answerScreen(view, my);
    else node = waitingScreen(view);
    show(root, node);
  }

  return { onPublic, refresh, stop() { stopped = true; clearTimeout(retryTimer); clearTimers(); } };
}
