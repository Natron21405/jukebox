import type { BoardMode, BoardRow } from '../logic';
import { h } from './dom';

/** How one player's round went, for the answer-screen leaderboard. */
export interface RoundMark {
  /** Closest Year: points earned this round. Absent in Timeline and in sudden death. */
  points?: number;
  /** Timeline: was the placement right? null = no answer. Absent in Closest Year and in sudden death. */
  placed?: boolean | null;
  /** 'none' = nothing was typed. */
  artist: 'hit' | 'miss' | 'none';
  /** Sudden death only: a short note such as "off by 2". */
  note?: string;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Big icon + colour + words, so it reads across a room and does not rely on colour alone. */
function verdict(kind: string, ok: boolean, okText: string, badText: string) {
  return h('span', { class: `lb-mark ${ok ? 'right' : 'wrong'}`, 'data-mark': kind, 'data-ok': String(ok) },
    h('span', { class: 'lb-icon', 'aria-hidden': 'true' }, ok ? '✓' : '✗'),
    h('span', { class: 'lb-mark-text' }, ok ? okText : badText));
}

/** The single top-N list on the host answer screen. */
export function leaderboardList(mode: BoardMode, rows: readonly BoardRow[], marks: ReadonlyMap<string, RoundMark>, highlight?: string | null) {
  const timeline = mode === 'timeline';
  return h('ol', { class: `leaderboard${timeline ? ' tl' : ''}`, 'data-leaderboard': String(rows.length), 'data-mode': mode },
    ...rows.map((r) => {
      const m = marks.get(r.id);
      return h('li', {
        class: `lb-row${r.id === highlight ? ' winner' : ''}`,
        'data-player': r.name, 'data-rank': String(r.rank), 'data-total': String(r.total), 'data-hits': String(r.hits),
      },
        h('span', { class: 'lb-rank' }, String(r.rank)),
        h('span', { class: 'lb-name' }, r.name),
        h('span', { class: 'lb-total', title: timeline ? 'Cards' : 'Points' },
          h('strong', {}, String(r.total)), ` ${timeline ? (r.total === 1 ? 'card' : 'cards') : (r.total === 1 ? 'pt' : 'pts')}`),
        timeline && h('span', { class: 'lb-hits', title: 'Artists guessed right so far', 'data-lb-hits': String(r.hits) }, `♪ ${plural(r.hits, 'artist')}`),
        h('span', { class: 'lb-round' },
          m?.note && h('span', { class: 'lb-note' }, m.note),
          m && m.points !== undefined && h('span', { class: 'lb-points', 'data-points': String(m.points) }, `+${m.points}`),
          m && m.placed !== undefined && (m.placed === null
            ? verdict('placement', false, '', 'No answer')
            : verdict('placement', m.placed, 'Placed', 'Missed')),
          m && m.artist !== 'none' && verdict('artist', m.artist === 'hit', 'Artist', 'Artist'),
          m && m.artist === 'none' && !m.note && h('span', { class: 'lb-none', 'data-mark': 'artist', 'data-ok': 'none' }, 'no artist')));
    }));
}
