import { CONFIG } from './config';
import { yearDistance } from './scoring';

export type Outcome =
  | { status: 'continue' }
  | { status: 'winner'; winnerId: string; decidedBy: 'target' | 'artistHits' | 'score' | 'suddenDeath' }
  | { status: 'suddenDeath'; contenders: string[] };

// ---------- Timeline ----------

export interface TimelinePlayer {
  id: string;
  /** Cards in the timeline, starting cards included. */
  cards: number;
  /** Correct artist guesses over the whole game. */
  artistHits: number;
}

/**
 * Call after each round's placements are applied.
 * Anyone at the target is a finisher (they all reached it this round, since the game stops at the first).
 * One finisher wins. Several: most artist hits wins; still tied: sudden death among those tied.
 */
export function timelineOutcome(players: readonly TimelinePlayer[], targetCards: number = CONFIG.timeline.targetCards): Outcome {
  const finishers = players.filter((p) => p.cards >= targetCards);
  if (finishers.length === 0) return { status: 'continue' };
  if (finishers.length === 1) return { status: 'winner', winnerId: finishers[0].id, decidedBy: 'target' };
  const best = Math.max(...finishers.map((p) => p.artistHits));
  const top = finishers.filter((p) => p.artistHits === best);
  if (top.length === 1) return { status: 'winner', winnerId: top[0].id, decidedBy: 'artistHits' };
  return { status: 'suddenDeath', contenders: top.map((p) => p.id) };
}

/** Standings: more cards first, then more artist hits. Equal entries keep input order. */
export function rankTimeline<T extends TimelinePlayer>(players: readonly T[]): T[] {
  return [...players].sort((a, b) => b.cards - a.cards || b.artistHits - a.artistHits);
}

// ---------- Closest Year ----------

export interface ScoredPlayer {
  id: string;
  score: number;
}

export function isClosestYearOver(roundsPlayed: number, rounds: number = CONFIG.closestYear.rounds): boolean {
  return roundsPlayed >= rounds;
}

/** Call after the last round: top score wins; a tie at the top goes straight to sudden death among those players. */
export function closestYearOutcome(players: readonly ScoredPlayer[]): Outcome {
  if (players.length === 0) return { status: 'continue' };
  const best = Math.max(...players.map((p) => p.score));
  const top = players.filter((p) => p.score === best);
  if (top.length === 1) return { status: 'winner', winnerId: top[0].id, decidedBy: 'score' };
  return { status: 'suddenDeath', contenders: top.map((p) => p.id) };
}

export function rankClosestYear<T extends ScoredPlayer>(players: readonly T[]): T[] {
  return [...players].sort((a, b) => b.score - a.score);
}

// ---------- Sudden death (both modes) ----------

export interface SuddenDeathGuess {
  id: string;
  /** null = no answer, which loses to any answer. */
  year: number | null;
}

/**
 * One sudden-death round among the contenders only. Closest year wins.
 * Still tied on distance (including nobody answering): returns the tied players for another round with a new song.
 */
export function resolveSuddenDeathRound(guesses: readonly SuddenDeathGuess[], truthYear: number): Outcome {
  if (guesses.length === 0) throw new Error('sudden death needs at least one contender');
  if (guesses.length === 1) return { status: 'winner', winnerId: guesses[0].id, decidedBy: 'suddenDeath' };
  const dist = (g: SuddenDeathGuess) => (g.year == null ? Infinity : yearDistance(g.year, truthYear));
  const best = Math.min(...guesses.map(dist));
  const top = guesses.filter((g) => dist(g) === best);
  if (top.length === 1) return { status: 'winner', winnerId: top[0].id, decidedBy: 'suddenDeath' };
  return { status: 'suddenDeath', contenders: top.map((g) => g.id) };
}
