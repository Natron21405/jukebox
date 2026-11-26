import { blockedEntries, summarizePool, type GameSong } from '../logic';
import type { HostSession, HostState } from '../net';
import { h, show } from './dom';
import { RESET_EXPLAIN, confirmButton } from './songTools';

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/**
 * The host's Songs screen: how many songs are still fresh, "Reset played songs", and the blocked list with Restore.
 * Titles show here on purpose: blocked songs were already revealed in play.
 */
export function openSongsScreen(root: HTMLElement, o: {
  session: HostSession;
  loadPool: () => Promise<GameSong[]>;
  onBack: () => void;
}): { close(): void } {
  let closed = false;
  let pool: GameSong[] = [];
  let hs: HostState | null = null;
  let notice = '';
  let message = '';

  const reload = async () => {
    hs = await o.session.state();
  };
  const act = async (fn: () => Promise<unknown>, done = '') => {
    notice = ''; message = '';
    try { await fn(); message = done; await reload(); } catch { notice = 'That did not work. Check the connection and try again.'; }
    draw();
  };

  function draw() {
    if (closed) return;
    if (!hs) { show(root, h('main', { class: 'screen host center' }, h('p', { class: 'lead' }, notice || 'Loading songs…'),
      notice && h('button', { class: 'btn ghost', 'data-action': 'songs-back', onclick: o.onBack }, 'Back'))); return; }
    const earlier = hs.played_earlier;
    const sum = summarizePool(pool, { blocked: hs.blocked, played: [...earlier, ...hs.played_this_game] });
    const entries = blockedEntries(pool, hs.blocked);
    show(root, h('main', { class: 'screen host songs', 'data-stage': 'songs' },
      h('header', { class: 'game-head' },
        h('h1', {}, 'Song settings'),
        h('button', { class: 'btn ghost', 'data-action': 'songs-back', onclick: o.onBack }, 'Back to lobby')),
      h('section', { class: 'songs-panel' },
        h('p', { class: 'lead', 'data-available': String(sum.available) }, `${sum.available} of ${sum.total} songs are still fresh`),
        h('p', { class: 'hint' }, `${plural(sum.played, 'song')} already played, ${plural(sum.blocked, 'song')} blocked.`),
        confirmButton({
          action: 'reset-played', label: 'Reset played songs', confirmLabel: 'Yes, reset played songs',
          explain: RESET_EXPLAIN, cls: 'btn primary',
          onConfirm: () => void act(() => o.session.resetPlayed(), 'All played songs are available again.'),
        }),
        message && h('p', { class: 'hint', role: 'status', 'data-message': '' }, message)),
      h('section', { class: 'blocked-panel' },
        h('h2', {}, 'Blocked songs ', h('span', { class: 'count', 'data-blocked-count': String(entries.length) }, String(entries.length))),
        entries.length === 0
          ? h('p', { class: 'empty' }, 'Nothing blocked. Use "Remove from future games" on a reveal screen to block a song.')
          : h('ul', { class: 'blocked-list' }, ...entries.map((e) => h('li', { class: 'blocked-row', 'data-blocked': e.id },
              h('span', { class: 'blocked-title' }, e.title),
              h('span', { class: 'blocked-artist' }, e.artist),
              h('button', { class: 'btn small ghost', 'data-action': 'restore', 'aria-label': `Restore ${e.title}`,
                onclick: () => void act(() => o.session.unblockSong(e.id)) }, 'Restore'))))),
      notice && h('p', { class: 'notice', role: 'alert' }, notice)));
  }

  draw();
  void Promise.all([o.loadPool().catch(() => [] as GameSong[]), o.session.state()])
    .then(([p, s]) => { pool = p; hs = s; draw(); })
    .catch(() => { notice = 'Could not load the song list.'; draw(); });

  return { close() { closed = true; } };
}
