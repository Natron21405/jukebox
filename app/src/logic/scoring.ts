import { CONFIG } from './config';

export function yearDistance(guess: number, truth: number): number {
  return Math.abs(guess - truth);
}

/** Closest Year points for a year guess (no guess = 0). */
export function closestYearPoints(guess: number | null | undefined, truth: number): number {
  if (guess == null) return 0;
  const d = yearDistance(guess, truth);
  for (const row of CONFIG.closestYear.pointsTable) {
    if (d <= row.maxDistance) return row.points;
  }
  return 0;
}

export function artistPoints(artistHit: boolean): number {
  return artistHit ? CONFIG.artistBonus : 0;
}

export interface ClosestYearRoundScore {
  distance: number | null;
  yearPoints: number;
  artistPoints: number;
  total: number;
}

export function scoreClosestYearRound(
  guess: number | null | undefined,
  truth: number,
  artistHit: boolean,
): ClosestYearRoundScore {
  const yearPts = closestYearPoints(guess, truth);
  const artistPts = artistPoints(artistHit);
  return {
    distance: guess == null ? null : yearDistance(guess, truth),
    yearPoints: yearPts,
    artistPoints: artistPts,
    total: yearPts + artistPts,
  };
}
