import { exhaustedMessage } from '../logic';
import { h } from './dom';

/**
 * A two-step button: the first tap asks "are you sure?", the second does it. Keeps its own state in the element, so it
 * works without a redraw (and a redraw simply puts it back to the first step).
 */
export function confirmButton(o: {
  action: string;
  label: string;
  confirmLabel: string;
  explain: string;
  onConfirm: () => void;
  cls?: string;
}): HTMLElement {
  const box = h('div', { class: 'confirm-box', 'data-confirm': o.action });
  const first = () => {
    box.replaceChildren(h('button', { class: o.cls ?? 'btn ghost', 'data-action': o.action, onclick: ask }, o.label));
  };
  const ask = () => {
    box.replaceChildren(
      h('p', { class: 'hint', 'data-confirm-text': '' }, o.explain),
      h('div', { class: 'row-actions' },
        h('button', { class: 'btn danger', 'data-action': `${o.action}-confirm`, onclick: () => { first(); o.onConfirm(); } }, o.confirmLabel),
        h('button', { class: 'btn ghost', 'data-action': `${o.action}-cancel`, onclick: first }, 'Cancel')));
  };
  first();
  return box;
}

export const RESET_EXPLAIN = 'This makes every song available again, including ones played in earlier games. Songs from the current game still will not repeat. Blocked songs stay blocked.';

/** Reveal-screen control: remove this song from all future games, with an undo. */
export function removeSongControl(blocked: boolean, onBlock: () => void, onUndo: () => void): HTMLElement {
  return blocked
    ? h('span', { class: 'removed', 'data-removed': 'true' },
        h('span', { class: 'hint' }, 'Removed from future games'),
        h('button', { class: 'btn ghost', 'data-action': 'unblock', onclick: onUndo }, 'Undo'))
    : h('button', { class: 'btn ghost', 'data-action': 'block', onclick: onBlock }, 'Remove from future games');
}

/** Shown when no song can be picked. Offers the reset only if it would help. */
export function exhaustedPanel(resetWouldHelp: boolean, onReset: () => void): HTMLElement {
  return h('section', { class: 'notice exhausted', role: 'alert', 'data-exhausted': String(resetWouldHelp) },
    h('p', {}, exhaustedMessage(resetWouldHelp)),
    resetWouldHelp && confirmButton({
      action: 'reset-played', label: 'Make all songs available again', confirmLabel: 'Yes, reset played songs',
      explain: RESET_EXPLAIN, onConfirm: onReset, cls: 'btn primary',
    }));
}
