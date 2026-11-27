import { h, show } from './dom';
import { HOST_HASH, JOIN_HASH } from './route';

export interface HomeApp { stop(): Promise<void> }

/** The front page: what the game is, and a choice between hosting (big screen) and joining (phone). It holds no state. */
export function mountHome(root: HTMLElement): HomeApp {
  const step = (n: number, text: string) => h('li', {}, h('span', { class: 'step-no', 'aria-hidden': 'true' }, String(n)), h('span', {}, text));
  show(root, h('main', { class: 'screen home', 'data-page': 'home' },
    h('h1', { class: 'logo' }, 'Jukebox'),
    h('p', { class: 'lead' }, 'A music party game. A song plays, and everyone answers at once on their own phone.'),
    h('ol', { class: 'steps' },
      step(1, 'One person hosts on a big screen (a laptop or TV) and plays the music.'),
      step(2, 'Everyone else joins on their phone with the room code or by scanning the QR code.'),
      step(3, 'Guess the year of each song, or build a timeline of songs in the right order. Bonus points for the artist.')),
    h('div', { class: 'home-actions' },
      h('a', { class: 'btn primary huge', href: HOST_HASH, 'data-action': 'go-host' }, 'Host a game'),
      h('a', { class: 'btn huge', href: JOIN_HASH, 'data-action': 'go-join' }, 'Join a game')),
    h('p', { class: 'hint' }, 'Ten or so friends works best. No accounts, nothing to install.')));
  return { async stop() { /* nothing to clean up */ } };
}
