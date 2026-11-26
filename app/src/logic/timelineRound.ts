import { artistResult, isUsableYear, type GameSong } from './closestYearRound';
import { applyPlacement, type Card } from './timeline';
import { yearDistance } from './scoring';

/** One player's answer for a Timeline round, as stored. Slot is a normal-round answer, year a sudden-death one. */
export interface TimelineAnswer {
  playerId: string;
  slot: number | null;
  year: number | null;
  artist: string;
  override?: boolean | null;
}

/** One line of a Timeline reveal. */
export interface TimelineRevealRow {
  playerId: string;
  /** The slot the player chose (null = no usable answer). Always null in sudden death. */
  slot: number | null;
  /** Sudden death only: the year guessed and how far off it was. */
  year: number | null;
  distance: number | null;
  /** Normal rounds: was the placement right? The card is added exactly when this is true. */
  correct: boolean;
  typed: string;
  autoMatched: boolean;
  override: boolean | null;
  /** Final: override if set, otherwise autoMatched. Counts for the tiebreak only, and not in sudden death. */
  artistHit: boolean;
  /** Cards in the player's timeline after this round. */
  cards: number;
}

/** The public reveal payload stored in rounds.reveal. It is the only place the answer ever reaches phones. */
export interface TimelineRevealPayload {
  kind: 'normal' | 'sudden_death';
  song: { id: string; title: string; artists: string[]; featuredArtists: string[]; year: number; artworkUrl?: string };
  rows: TimelineRevealRow[];
}

export interface TimelinePlayerInput { id: string; timeline: readonly Card[] }

/** Slots are only usable as whole numbers; anything else is no answer (the placement logic also range-checks). */
function usableSlot(s: unknown): number | null {
  return typeof s === 'number' && Number.isInteger(s) && s >= 0 ? s : null;
}

/**
 * Score a Timeline round. Normal round: each player's placement is checked against their own timeline; a correct one
 * inserts the song, a wrong or missing one changes nothing. Sudden death: only the year guess matters, no timeline
 * changes and no artist hit is counted. Returns the reveal and each player's new timeline.
 */
export function buildTimelineReveal(
  song: GameSong,
  kind: 'normal' | 'sudden_death',
  players: readonly TimelinePlayerInput[],
  answers: readonly TimelineAnswer[],
): { reveal: TimelineRevealPayload; timelines: Record<string, Card[]> } {
  const byPlayer = new Map(answers.map((a) => [a.playerId, a]));
  const timelines: Record<string, Card[]> = {};
  const rows = players.map((p): TimelineRevealRow => {
    const a = byPlayer.get(p.id);
    const typed = (a?.artist ?? '').trim();
    const { autoMatched, hit } = artistResult(typed, song, a?.override);
    const base = { playerId: p.id, typed, autoMatched, override: a?.override ?? null };
    if (kind === 'sudden_death') {
      const year = a && isUsableYear(a.year) ? a.year : null;
      timelines[p.id] = [...p.timeline];
      return {
        ...base, slot: null, year, distance: year == null ? null : yearDistance(year, song.year),
        correct: false, artistHit: false, cards: p.timeline.length,
      };
    }
    const slot = usableSlot(a?.slot);
    const placed = applyPlacement(p.timeline, slot, song);
    timelines[p.id] = placed.timeline;
    return {
      ...base, slot, year: null, distance: null, correct: placed.correct, artistHit: hit, cards: placed.timeline.length,
    };
  });
  return {
    reveal: {
      kind,
      song: {
        id: song.id, title: song.title, artists: song.artists, featuredArtists: song.featuredArtists,
        year: song.year, artworkUrl: song.artworkUrl,
      },
      rows,
    },
    timelines,
  };
}

/** Change one player's host override on a reveal. Returns the new reveal and the change in that player's artist hits. */
export function applyTimelineOverride(
  reveal: TimelineRevealPayload,
  song: GameSong,
  playerId: string,
  override: boolean | null,
): { reveal: TimelineRevealPayload; hitDelta: number } {
  let hitDelta = 0;
  const rows = reveal.rows.map((r) => {
    if (r.playerId !== playerId) return r;
    // Sudden-death rounds never count hits, whatever the host says.
    const hit = reveal.kind === 'sudden_death' ? false : artistResult(r.typed, song, override).hit;
    hitDelta = (hit ? 1 : 0) - (r.artistHit ? 1 : 0);
    return { ...r, override, artistHit: hit };
  });
  return { reveal: { ...reveal, rows }, hitDelta };
}
