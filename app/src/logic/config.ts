// Every tunable number for the game lives here. Pure data, no imports.

export const CONFIG = {
  maxPlayers: 20,
  /** Rows on the host answer-screen leaderboard. */
  leaderboardSize: 5,
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
    /** Year guesses outside this range are ignored (treated as no answer). The upper bound is generous on purpose. */
    guessYearMin: 1900,
    guessYearMax: 2100,
    /** Checked in order: first row whose maxDistance >= distance wins. Beyond the last row: 0 points. */
    pointsTable: [
      { maxDistance: 0, points: 5 },
      { maxDistance: 1, points: 3 },
      { maxDistance: 3, points: 2 },
      { maxDistance: 5, points: 1 },
    ] as ReadonlyArray<{ maxDistance: number; points: number }>,
  },

  artistBonus: 2,

  /** Year picker on the phone (Closest Year). */
  yearPicker: {
    /** Press-and-hold on the plus/minus buttons: wait this long, then repeat every holdRepeatMs. */
    holdDelayMs: 350,
    holdRepeatMs: 110,
    /** After this many repeats the hold speeds up to holdFastRepeatMs. */
    holdFastAfter: 10,
    holdFastRepeatMs: 55,
    /** Pause after the last change before the phone saves the answer (it is saved at once on Lock In). */
    saveDebounceMs: 400,
    /** Tick labels under the slider: every 10 years, or every 5 when the range is this short or shorter. */
    shortRangeYears: 40,
  },

  host: {
    /** How often the host screen redraws the countdown and checks whether the round should end. */
    tickMs: 1000,
  },

  /** Host lobby: what the host may choose, and when the Start button turns on. */
  lobby: {
    minPlayersToStart: 2,
    roomCodeLength: 4,
    /** Timeline: first to this many cards wins. */
    targetCards: { min: 4, max: 20, step: 1 },
    /** Closest Year: number of rounds. */
    rounds: { min: 5, max: 30, step: 1 },
    /** Seconds to answer each song. */
    roundSeconds: { min: 15, max: 90, step: 5 },
  },


  net: {
    /** Phones ping this often so the database knows the seat is alive (seat is "live" for 60 s after a ping). */
    heartbeatSeconds: 20,
    /** The host re-syncs the connected flags from presence this often, on top of every presence change. */
    presenceSyncSeconds: 15,
  },

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
