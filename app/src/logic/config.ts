// Every tunable number for the game lives here. Pure data, no imports.

export const CONFIG = {
  maxPlayers: 12,
  maxNameLength: 20,
  roundSeconds: 40,

  /** Host year-range setting: lower bound default. The upper bound is the current year (see defaultYearMax). */
  songYearMin: 1950,

  timeline: {
    /** First player to hold this many cards wins (starting cards included). */
    targetCards: 12,
    startingCards: 2,
    startYearMin: 1970,
    startYearMax: 2015,
  },

  closestYear: {
    rounds: 15,
    /** Checked in order: first row whose maxDistance >= distance wins. Beyond the last row: 0 points. */
    pointsTable: [
      { maxDistance: 0, points: 5 },
      { maxDistance: 1, points: 3 },
      { maxDistance: 3, points: 2 },
      { maxDistance: 5, points: 1 },
    ] as ReadonlyArray<{ maxDistance: number; points: number }>,
  },

  artistBonus: 2,

  matcher: {
    /** Typo tolerance by length of the (spaceless, normalised) target. Last row whose minLength <= length applies. */
    editsByLength: [
      { minLength: 0, maxEdits: 0 },
      { minLength: 5, maxEdits: 1 },
      { minLength: 11, maxEdits: 2 },
    ] as ReadonlyArray<{ minLength: number; maxEdits: number }>,
    /** A surname alone is accepted only if it has at least this many letters. */
    minSurnameLength: 4,
  },
};

export type Config = typeof CONFIG;

export function defaultYearMax(now: Date = new Date()): number {
  return now.getFullYear();
}
