import { CONFIG } from './config';
import { matchArtist } from './matcher';
import { scoreClosestYearRound } from './scoring';
import type { Song } from './types';

/** A song as the game uses it: the Song record plus the optional band list the matcher reads. */
export type GameSong = Song & { groupArtists?: string[] };

/** One player's answer for a round, as stored (year may be junk from a bad client: it is validated here). */
export interface RoundAnswer {
  playerId: string;
  year: number | null;
  artist: string;
  /** Host override: true = count it, false = do not, null/undefined = let the matcher decide. */
  override?: boolean | null;
}

/** One line of a round reveal. This is what the host screen and the phones show after the reveal. */
export interface RevealRow {
  playerId: string;
  /** The year guess if it was a usable year, else null (no answer). */
  year: number | null;
  distance: number | null;
  yearPoints: number;
  /** What the player typed (empty if nothing). Shown on the reveal so the host can judge borderline guesses. */
  typed: string;
  /** What the matcher said on its own. */
  autoMatched: boolean;
  override: boolean | null;
  /** Final: override if set, otherwise autoMatched. */
  artistHit: boolean;
  artistPoints: number;
  /** Points added to the player's score (0 in sudden death, which does not score). */
  total: number;
}

/** The public reveal payload stored in rounds.reveal. It is the only place the answer ever reaches phones. */
export interface RevealPayload {
  kind: 'normal' | 'sudden_death';
  song: { id: string; title: string; artists: string[]; featuredArtists: string[]; year: number; artworkUrl?: string };
  rows: RevealRow[];
}

export function isUsableYear(y: unknown): y is number {
  return typeof y === 'number' && Number.isInteger(y) && y >= CONFIG.closestYear.guessYearMin && y <= CONFIG.closestYear.guessYearMax;
}

/** Does the typed artist count? A host override beats the matcher. An empty guess never counts, even if overridden. */
export function artistResult(typed: string, song: GameSong, override: boolean | null | undefined): { autoMatched: boolean; hit: boolean } {
  const text = (typed ?? '').trim();
  const autoMatched = text !== '' && matchArtist(text, song).matched;
  if (text === '') return { autoMatched: false, hit: false };
  return { autoMatched, hit: override == null ? autoMatched : override };
}

/**
 * Score a round for the given players. Players without an answer get a row of zeros, so every player always has a
 * row. In sudden death nothing is scored (total 0): only the distance matters.
 */
export function buildReveal(
  song: GameSong,
  kind: 'normal' | 'sudden_death',
  playerIds: readonly string[],
  answers: readonly RoundAnswer[],
): RevealPayload {
  const byPlayer = new Map(answers.map((a) => [a.playerId, a]));
  const rows = playerIds.map((playerId): RevealRow => {
    const a = byPlayer.get(playerId);
    const year = a && isUsableYear(a.year) ? a.year : null;
    const typed = (a?.artist ?? '').trim();
    const { autoMatched, hit } = artistResult(typed, song, a?.override);
    const s = scoreClosestYearRound(year, song.year, hit);
    return {
      playerId, year, distance: s.distance, yearPoints: s.yearPoints, typed, autoMatched,
      override: a?.override ?? null, artistHit: hit, artistPoints: s.artistPoints,
      total: kind === 'sudden_death' ? 0 : s.total,
    };
  });
  return {
    kind,
    song: {
      id: song.id, title: song.title, artists: song.artists, featuredArtists: song.featuredArtists,
      year: song.year, artworkUrl: song.artworkUrl,
    },
    rows,
  };
}

/** Change one player's host override on an existing reveal, re-scoring that row. Returns the new reveal and the point/hit changes. */
export function applyOverride(
  reveal: RevealPayload,
  song: GameSong,
  playerId: string,
  override: boolean | null,
): { reveal: RevealPayload; scoreDelta: number; hitDelta: number } {
  let scoreDelta = 0;
  let hitDelta = 0;
  const rows = reveal.rows.map((r) => {
    if (r.playerId !== playerId) return r;
    const { hit } = artistResult(r.typed, song, override);
    const s = scoreClosestYearRound(r.year, song.year, hit);
    const total = reveal.kind === 'sudden_death' ? 0 : s.total;
    scoreDelta = total - r.total;
    hitDelta = (hit ? 1 : 0) - (r.artistHit ? 1 : 0);
    return { ...r, override, artistHit: hit, artistPoints: s.artistPoints, total };
  });
  return { reveal: { ...reveal, rows }, scoreDelta, hitDelta };
}

/**
 * Has everyone who is expected locked in? Expected = players currently connected, plus anyone in `alsoExpected` (the
 * players who were connected when the round began: a phone that sleeps mid-round is flagged away, but it must not
 * let the others end the round early; the timer still ends it). A player who was away from the start never holds up
 * the round. Narrowed to the contenders in sudden death. Nobody expected = never early.
 */
export function everyoneLocked(
  players: ReadonlyArray<{ id: string; connected: boolean }>,
  lockedIds: readonly string[],
  contenders?: readonly string[] | null,
  alsoExpected?: ReadonlySet<string> | null,
): boolean {
  const locked = new Set(lockedIds);
  const expected = players.filter((p) => (p.connected || !!alsoExpected?.has(p.id)) && (!contenders || contenders.includes(p.id)));
  return expected.length > 0 && expected.every((p) => locked.has(p.id));
}

/** Has the round timer run out? (ends_at is an ISO string; null = no timer.) */
export function timerExpired(endsAt: string | null, nowMs: number): boolean {
  return endsAt != null && nowMs >= Date.parse(endsAt);
}
