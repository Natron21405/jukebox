import { h } from './dom';

export interface RevealedSong { title?: string; artists?: string[]; featuredArtists?: string[]; year?: number }

/** The right answer for a phone's result screen: the song and its artist(s). Only called once the reveal is out. */
export function answerBlock(song: RevealedSong | undefined): Node | null {
  if (!song || (!song.title && !song.artists?.length)) return null;
  const artists = [...(song.artists ?? []), ...(song.featuredArtists ?? []).map((a) => `feat. ${a}`)].join(', ');
  return h('div', { class: 'answer-block', 'data-answer-block': '' },
    song.title && h('p', { class: 'answer-title', 'data-answer-song': '' }, song.title),
    artists && h('p', { class: 'answer-artists', 'data-answer-artist': '' }, artists));
}
