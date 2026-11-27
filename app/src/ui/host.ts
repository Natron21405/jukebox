import {
  CONFIG, MODE_LABELS, checkCanStart, normalizeSettings, stepSetting, type GameMode, type LobbySettings,
} from '../logic';
import {
  HostSession, createHostRoom, forgetHost, loadPublicState, resumeHost, watchRoom,
  type Backend, type KV, type PlayerRow, type PublicRoomState,
} from '../net';
import type { GameSong } from '../logic';
import { h, show } from './dom';
import { createHostGame, htmlClipPlayer, type ClipPlayer, type HostGame } from './hostGame';
import { createHostTimeline } from './hostTimeline';
import { openSongsScreen } from './hostSongs';
import { qrElement } from './qr';
import { joinAddressText, joinUrl } from './route';

export interface HostDeps {
  backend: Backend;
  kv: KV;
  /** The address of this page, used to build the join link and QR code. */
  pageUrl: () => string;
  /** Loads the song list for Closest Year. Defaults to fetching songs.json next to the app. */
  loadPool?: () => Promise<GameSong[]>;
  /** Plays the clip on this device (injectable for tests). */
  player?: ClipPlayer;
  now?: () => number;
  rng?: () => number;
}
export interface HostApp { stop(): Promise<void> }

/** songs.json is built by the song pipeline and shipped next to the app (a list of songs, or an object holding one). */
async function defaultLoadPool(): Promise<GameSong[]> {
  const res = await fetch(`${import.meta.env.BASE_URL}songs.json`);
  if (!res.ok) throw new Error('songs.json not available');
  const data = await res.json() as GameSong[] | { songs: GameSong[] };
  return Array.isArray(data) ? data : data.songs;
}

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
  let songs: { close(): void } | null = null; // the Songs screen, while it is open
  // One controller per mode; each draws only while the room is in its own mode and not in the lobby.
  let games: Record<GameMode, HostGame> | null = null;
  const inGame = (s: PublicRoomState) => s.room.status !== 'lobby';

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

  const nameHue = (n: string) => [...n].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
  const initialOf = (n: string) => (n.trim()[0] ?? '?').toUpperCase();

  function playerItem(p: PlayerRow) {
    const armed = kickArmed === p.id;
    return h('li', { class: `player${p.connected ? '' : ' away'}`, 'data-player': p.name },
      h('span', { class: 'avatar', style: `--hue:${nameHue(p.name)}`, 'aria-hidden': 'true' }, initialOf(p.name),
        h('span', { class: `dot ${p.connected ? 'on' : 'off'}` })),
      h('span', { class: 'player-info' },
        h('span', { class: 'player-name', title: p.name }, p.name),
        !p.connected && h('span', { class: 'player-status' }, 'Reconnecting…'),
      ),
      h('button', {
        class: `btn small kick ${armed ? 'danger' : 'ghost'}`, 'data-action': 'kick',
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
          onclick: () => void act(() => games![mode].start()),
        }, 'Start game'),
        !check.ok && h('p', { class: 'hint' }, check.reason),
        h('button', { class: 'btn ghost', 'data-action': 'open-songs', onclick: openSongs }, 'Song settings'),
      ),
    );
  }

  function openSongs() {
    if (!session) return;
    songs?.close();
    songs = openSongsScreen(root, {
      session, loadPool: deps.loadPool ?? defaultLoadPool,
      onBack: () => { songs?.close(); songs = null; render(); },
    });
  }

  function render() {
    if (stopped) return;
    if (!state) return;
    games?.closest_year.onPublic(state); // each also resets itself when the room goes back to the lobby
    games?.timeline.onPublic(state);
    if (songs && !inGame(state)) return; // the Songs screen draws itself
    if (songs) { songs.close(); songs = null; }
    if (!inGame(state)) show(root, lobbyView(state)); // in a game, the game's own screens draw themselves
  }

  // ------------------------------------------------------------------ lifecycle
  async function open(creds: { code: string; roomId: string; hostToken: string }) {
    session = new HostSession(backend, creds);
    if (games) { games.closest_year.stop(); games.timeline.stop(); }
    const gameDeps = {
      session, player: deps.player ?? htmlClipPlayer(), now: deps.now, rng: deps.rng,
      loadPool: deps.loadPool ?? defaultLoadPool,
      joinStrip: () => joinStrip(creds.code, true),
      onLobby: () => void act(() => session!.updateRoom({ status: 'lobby' })),
    };
    games = { closest_year: createHostGame(root, gameDeps), timeline: createHostTimeline(root, gameDeps) };
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
    if (resumed && resumed.state.room.status === 'over') {
      // Opening the host page after a finished game must not land on that game's winner screen: start the same room fresh
      // (same code, players keep their seats). If this fails we still open the room, and Play Again is there.
      try { await new HostSession(backend, resumed.creds).newGame(); } catch { /* fall through */ }
    }
    if (resumed) await open(resumed.creds); else renderCreate();
  } catch {
    renderCreate('Could not reach the game server.', true);
  }

  return {
    async stop() {
      stopped = true;
      songs?.close();
      games?.closest_year.stop(); games?.timeline.stop();
      clearTimeout(kickTimer);
      document.removeEventListener('visibilitychange', onVisible);
      await teardown();
    },
  };
}
