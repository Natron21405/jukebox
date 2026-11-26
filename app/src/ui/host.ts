import {
  CONFIG, MODE_LABELS, checkCanStart, normalizeSettings, stepSetting, type GameMode, type LobbySettings,
} from '../logic';
import {
  HostSession, createHostRoom, forgetHost, loadPublicState, resumeHost, watchRoom,
  type Backend, type KV, type PlayerRow, type PublicRoomState,
} from '../net';
import { h, show } from './dom';
import { qrElement } from './qr';
import { joinAddressText, joinUrl } from './route';

export interface HostDeps {
  backend: Backend;
  kv: KV;
  /** The address of this page, used to build the join link and QR code. */
  pageUrl: () => string;
}
export interface HostApp { stop(): Promise<void> }

const MODE_BLURB: Record<GameMode, (s: LobbySettings) => string> = {
  timeline: (s) => `Everyone builds their own timeline and places every song. First to ${s.targetCards} cards wins.`,
  closest_year: (s) => `Everyone guesses the year of every song. ${s.rounds} rounds, closest guesses score most.`,
};

/**
 * The host (big screen) side of the lobby: create a room, show the code and QR, list players, choose the mode and
 * settings, remove players, start. Everything it shows is rebuilt from the database, so a refresh restores it.
 */
export async function mountHost(root: HTMLElement, deps: HostDeps): Promise<HostApp> {
  const { backend, kv } = deps;
  let session: HostSession | null = null;
  let state: PublicRoomState | null = null;
  let stops: Array<() => unknown> = [];
  let error = '';
  let kickArmed: string | null = null;
  let kickTimer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const teardown = async () => {
    const list = stops; stops = [];
    for (const s of list) await Promise.resolve(s()).catch(() => undefined);
  };

  // ------------------------------------------------------------------ actions
  const refresh = async () => {
    if (!session || stopped) return;
    const s = await loadPublicState(backend, session.creds.roomId).catch(() => null);
    if (s && !stopped) { state = s; render(); }
  };
  const act = async (fn: () => Promise<unknown>) => {
    if (!session) return;
    error = '';
    try { await fn(); } catch { error = 'That did not work. Check the connection and try again.'; }
    await refresh();
    if (error) render();
  };
  const changeSetting = (key: keyof LobbySettings, direction: 1 | -1) => {
    if (!state || !session) return;
    const cur = normalizeSettings(state.room.settings)[key];
    return act(() => session!.updateRoom({ settings: { [key]: stepSetting(key, cur, direction) } }));
  };
  const kick = (p: PlayerRow) => {
    if (kickArmed !== p.id) {
      kickArmed = p.id; clearTimeout(kickTimer);
      kickTimer = setTimeout(() => { kickArmed = null; render(); }, 4000);
      render();
      return;
    }
    kickArmed = null; clearTimeout(kickTimer);
    void act(() => session!.kickPlayer(p.id));
  };

  // ------------------------------------------------------------------ screens
  function renderCreate(message = '', retry = false) {
    show(root, h('main', { class: 'screen host center' },
      h('h1', { class: 'logo' }, 'Jukebox'),
      h('p', { class: 'lead' }, 'A music party game. Everyone plays at once on their own phone.'),
      message && h('p', { class: 'notice', role: 'alert' }, message),
      h('button', { class: 'btn primary huge', 'data-action': 'create', onclick: () => void create() }, retry ? 'Try again' : 'Create room'),
    ));
  }

  function joinStrip(code: string, small: boolean) {
    const url = joinUrl(deps.pageUrl(), code);
    return h('div', { class: small ? 'join-strip' : 'join-card' },
      h('div', { class: 'join-text' },
        h('div', { class: 'join-line' }, 'Join on your phone at'),
        h('div', { class: 'join-address' }, joinAddressText(deps.pageUrl())),
        h('div', { class: 'join-line' }, 'Room code'),
        h('div', { class: 'room-code', 'data-room-code': code, 'aria-label': `Room code ${code.split('').join(' ')}` }, code),
      ),
      !small && qrElement(url),
    );
  }

  function playerItem(p: PlayerRow) {
    const armed = kickArmed === p.id;
    return h('li', { class: `player${p.connected ? '' : ' away'}`, 'data-player': p.name },
      h('span', { class: `dot ${p.connected ? 'on' : 'off'}`, 'aria-hidden': 'true' }),
      h('span', { class: 'player-name' }, p.name),
      !p.connected && h('span', { class: 'player-status' }, 'reconnecting'),
      h('button', {
        class: `btn small ${armed ? 'danger' : 'ghost'}`, 'data-action': 'kick',
        'aria-label': armed ? `Tap again to remove ${p.name}` : `Remove ${p.name}`,
        onclick: () => kick(p),
      }, armed ? 'Remove?' : '✕'),
    );
  }

  function stepper(label: string, key: keyof LobbySettings, value: number, suffix = '') {
    return h('div', { class: 'stepper', 'data-setting': key },
      h('span', { class: 'stepper-label' }, label),
      h('button', { class: 'btn step', 'aria-label': `Less: ${label}`, onclick: () => void changeSetting(key, -1) }, '−'),
      h('span', { class: 'stepper-value' }, `${value}${suffix}`),
      h('button', { class: 'btn step', 'aria-label': `More: ${label}`, onclick: () => void changeSetting(key, 1) }, '+'),
    );
  }

  function lobbyView(s: PublicRoomState) {
    const mode = s.room.mode as GameMode;
    const settings = normalizeSettings(s.room.settings);
    const check = checkCanStart(s.players);
    const players = [...s.players].sort((a, b) => a.joined_at.localeCompare(b.joined_at));
    const modeButton = (m: GameMode) => h('button', {
      class: `seg${m === mode ? ' on' : ''}`, 'data-mode': m, 'aria-pressed': String(m === mode),
      onclick: () => { if (m !== mode) void act(() => session!.updateRoom({ mode: m })); },
    }, MODE_LABELS[m]);

    return h('main', { class: 'screen host lobby' },
      joinStrip(s.room.code, false),
      h('section', { class: 'players-panel' },
        h('h2', {}, `Players `, h('span', { class: 'count', 'data-count': String(players.length) }, `${players.length} / ${CONFIG.maxPlayers}`)),
        players.length === 0
          ? h('p', { class: 'empty' }, 'Waiting for players. Scan the code or type it in.')
          : h('ul', { class: 'players' }, ...players.map(playerItem)),
      ),
      h('section', { class: 'settings-panel' },
        h('div', { class: 'segmented', role: 'group', 'aria-label': 'Game mode' }, modeButton('timeline'), modeButton('closest_year')),
        h('p', { class: 'blurb' }, MODE_BLURB[mode](settings)),
        h('div', { class: 'steppers' },
          mode === 'timeline'
            ? stepper('Cards to win', 'targetCards', settings.targetCards)
            : stepper('Rounds', 'rounds', settings.rounds),
          stepper('Seconds per song', 'roundSeconds', settings.roundSeconds),
        ),
      ),
      h('section', { class: 'start-panel' },
        error && h('p', { class: 'notice', role: 'alert' }, error),
        h('button', {
          class: 'btn primary huge', 'data-action': 'start', disabled: check.ok ? null : true,
          onclick: () => void act(() => session!.updateRoom({ status: 'playing' })),
        }, 'Start game'),
        !check.ok && h('p', { class: 'hint' }, check.reason),
      ),
    );
  }

  /** Until the game screens exist, a started room shows this (the code stays visible, as the plan requires). */
  function inGameView(s: PublicRoomState) {
    return h('main', { class: 'screen host center' },
      h('h1', { class: 'logo' }, s.room.status === 'over' ? 'Game over' : 'Game on'),
      h('p', { class: 'lead' }, `${s.players.length} players, ${MODE_LABELS[s.room.mode as GameMode]}.`),
      h('button', { class: 'btn ghost', 'data-action': 'back-to-lobby', onclick: () => void act(() => session!.updateRoom({ status: 'lobby' })) }, 'Back to lobby'),
      joinStrip(s.room.code, true),
    );
  }

  function render() {
    if (stopped) return;
    if (!state) return;
    show(root, state.room.status === 'lobby' ? lobbyView(state) : inGameView(state));
  }

  // ------------------------------------------------------------------ lifecycle
  async function open(creds: { code: string; roomId: string; hostToken: string }) {
    session = new HostSession(backend, creds);
    try {
      stops.push(await session.mirrorPresence());
      stops.push(await watchRoom(backend, creds.roomId, (s) => { if (!stopped) { state = s; render(); } }));
    } catch (e) {
      await teardown();
      session = null; state = null;
      if (e instanceof Error && e.message === 'room not found') {
        forgetHost(kv);
        renderCreate('That room has ended. Create a new one.');
      } else {
        renderCreate('Could not reach the game server.', true);
      }
    }
  }

  async function create() {
    try {
      const creds = await createHostRoom(backend, kv, 'timeline', normalizeSettings({}) as unknown as Record<string, unknown>);
      await open(creds);
    } catch {
      renderCreate('Could not create a room. Check the connection.', true);
    }
  }

  const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
  document.addEventListener('visibilitychange', onVisible);

  // Start: rebuild from the database if this browser already hosts a room.
  show(root, h('main', { class: 'screen host center' }, h('p', { class: 'lead' }, 'Loading…')));
  try {
    const resumed = await resumeHost(backend, kv);
    if (resumed) await open(resumed.creds); else renderCreate();
  } catch {
    renderCreate('Could not reach the game server.', true);
  }

  return {
    async stop() {
      stopped = true;
      clearTimeout(kickTimer);
      document.removeEventListener('visibilitychange', onVisible);
      await teardown();
    },
  };
}
