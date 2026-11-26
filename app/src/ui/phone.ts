import { CONFIG, MODE_LABELS, cleanRoomCode, normalizeSettings, type GameMode } from '../logic';
import {
  JOIN_MESSAGES, joinGame, leaveSeat, resumeSeat, startPhoneSession, watchRoom,
  type Backend, type KV, type PhoneSession, type PublicRoomState, type StoredSeat,
} from '../net';
import { h, show } from './dom';
import { createPhoneGame, type PhoneGame } from './phoneGame';

export interface PhoneDeps {
  backend: Backend;
  kv: KV;
  /** Code from the join link (`#/join/ABCD`), if any. */
  initialCode: string;
}
export interface PhoneApp { stop(): Promise<void> }

/**
 * The phone side of the lobby: type the code and a name, then wait for the host. A refresh restores the seat from
 * the remembered token, and if the host removes this player the phone goes back to the join form.
 */
export async function mountPhone(root: HTMLElement, deps: PhoneDeps): Promise<PhoneApp> {
  const { backend, kv } = deps;
  let session: PhoneSession | null = null;
  let unwatch: (() => unknown) | null = null;
  let state: PublicRoomState | null = null;
  let seat: StoredSeat | null = null;
  let stopped = false;
  let game: PhoneGame | null = null;
  const inClosestYear = (s: PublicRoomState | null) => !!s && s.room.mode === 'closest_year' && s.room.status !== 'lobby';

  const endSession = async () => {
    const s = session, u = unwatch;
    game?.stop(); game = null;
    session = null; unwatch = null; state = null; seat = null;
    if (u) await Promise.resolve(u()).catch(() => undefined);
    if (s) await s.stop().catch(() => undefined);
  };

  // ------------------------------------------------------------------ join form
  /** Built once per visit, so typing is never interrupted by a re-render. */
  function renderJoin(message = '', prefill?: { code?: string; name?: string }) {
    const code = h('input', {
      class: 'field code-field', id: 'code', name: 'code', type: 'text', inputmode: 'text', autocomplete: 'off',
      autocapitalize: 'characters', autocorrect: 'off', spellcheck: 'false', maxlength: CONFIG.lobby.roomCodeLength,
      placeholder: 'ABCD', value: prefill?.code ?? deps.initialCode, 'aria-label': 'Room code',
    });
    const name = h('input', {
      class: 'field', id: 'name', name: 'name', type: 'text', autocomplete: 'off', autocapitalize: 'words',
      maxlength: CONFIG.maxNameLength, placeholder: 'Your name', value: prefill?.name ?? '', 'aria-label': 'Your name',
    });
    const msg = h('p', { class: 'notice', role: 'alert', 'data-message': 'join' }, message);
    msg.hidden = !message;
    const btn = h('button', { class: 'btn primary huge', type: 'submit', 'data-action': 'join' }, 'Join');

    code.addEventListener('input', () => { const c = cleanRoomCode(code.value); if (c !== code.value) code.value = c; });

    const say = (text: string) => { msg.textContent = text; msg.hidden = !text; };
    const form = h('form', { class: 'join-form', novalidate: true },
      h('label', { class: 'label', for: 'code' }, 'Room code'), code,
      h('label', { class: 'label', for: 'name' }, 'Your name'), name,
      msg, btn,
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      void (async () => {
        if (cleanRoomCode(code.value).length < CONFIG.lobby.roomCodeLength) {
          say(`The room code is ${CONFIG.lobby.roomCodeLength} letters. It is on the big screen.`);
          return;
        }
        say(''); btn.disabled = true; btn.textContent = 'Joining…';
        try {
          const r = await joinGame(backend, kv, { code: code.value, name: name.value });
          if (stopped) return;
          if (!r.ok) { say(r.message || JOIN_MESSAGES[r.reason]); btn.disabled = false; btn.textContent = 'Join'; return; }
          await enter(r.seat);
        } catch {
          say('Could not reach the game. Check your connection and try again.');
          btn.disabled = false; btn.textContent = 'Join';
        }
      })();
    });

    show(root, h('main', { class: 'screen phone' },
      h('h1', { class: 'logo small' }, 'Jukebox'),
      h('p', { class: 'lead' }, 'Join the party'),
      form,
    ));
  }

  // ------------------------------------------------------------------ in the room
  function renderSeat() {
    if (!seat) return;
    const s = state;
    const lobby = !s || s.room.status === 'lobby';
    const others = s ? s.players.filter((p) => p.id !== seat!.playerId) : [];
    show(root, h('main', { class: 'screen phone center' },
      h('p', { class: 'label' }, `Room ${seat.code}`),
      h('h1', { class: 'you', 'data-you': seat.name }, seat.name),
      lobby
        ? h('p', { class: 'lead waiting', 'data-state': 'waiting' }, 'You are in. Waiting for the host to start…')
        : h('p', { class: 'lead', 'data-state': 'playing' }, s!.room.status === 'over' ? 'The game is over.' : 'The game has started.'),
      s && h('p', { class: 'hint' },
        others.length === 0 ? 'You are the first one here.' : `${others.length} other ${others.length === 1 ? 'player' : 'players'} here`),
      s && lobby && h('p', { class: 'hint' },
        `${MODE_LABELS[s.room.mode as GameMode]}: ${s.room.mode === 'timeline'
          ? `first to ${normalizeSettings(s.room.settings).targetCards} cards`
          : `${normalizeSettings(s.room.settings).rounds} rounds`}`),
      h('button', { class: 'btn ghost', 'data-action': 'leave', onclick: () => void leave() }, 'Leave'),
    ));
  }

  async function backToJoin(message: string, keep?: { code?: string; name?: string }) {
    await endSession();
    leaveSeat(kv);
    if (!stopped) renderJoin(message, keep);
  }

  async function leave() {
    const keep = seat ? { code: seat.code } : undefined;
    await backToJoin('', keep);
  }

  function onState(next: PublicRoomState) {
    if (stopped || !seat) return;
    // The host removed this player: the seat is gone.
    if (state && state.players.some((p) => p.id === seat!.playerId) && !next.players.some((p) => p.id === seat!.playerId)) {
      void backToJoin('The host removed you from the room. You can join again with another name.', { code: seat.code, name: seat.name });
      return;
    }
    state = next;
    if (inClosestYear(next) && game) { game.onPublic(next); return; } // the game screens draw themselves
    game?.onPublic(next);
    renderSeat();
  }

  async function enter(found: StoredSeat) {
    await endSession();
    seat = found;
    renderSeat();
    session = await startPhoneSession(backend, found);
    game = createPhoneGame(root, { phone: session, seat: found });
    try {
      unwatch = await watchRoom(backend, found.roomId, onState);
    } catch {
      await backToJoin('That room has ended.', { code: found.code });
    }
  }

  const onVisible = () => {
    if (document.visibilityState !== 'visible' || !seat) return;
    if (inClosestYear(state)) void game?.refresh();
    void backend.getMyState(seat.seatToken).then((m) => {
      if (!m && seat && !stopped) void backToJoin('You are no longer in that room.', { code: seat.code, name: seat.name });
    }).catch(() => undefined);
  };
  document.addEventListener('visibilitychange', onVisible);

  // Start: put a remembered seat straight back, otherwise show the join form.
  show(root, h('main', { class: 'screen phone center' }, h('p', { class: 'lead' }, 'Loading…')));
  try {
    const resumed = await resumeSeat(backend, kv);
    if (resumed) await enter(resumed.seat); else renderJoin();
  } catch {
    renderJoin('Could not reach the game. Check your connection and try again.');
  }

  return {
    async stop() {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisible);
      await endSession();
    },
  };
}
