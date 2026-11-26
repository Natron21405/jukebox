import type { ClosestYearReveal } from './closestYear';
import { suddenDeathContenders } from './closestYear';
import type { RevealRow } from '../logic';
import type { AnswerInput, MyState, PhoneSession, SubmitRaw } from '../net';

export type PhoneStage =
  /** Not started, or between rounds: nothing to answer. */
  | 'waiting'
  /** A round is open and this player may answer (and change the answer until Lock In). */
  | 'answer'
  /** Locked in, waiting for the others or the timer. */
  | 'locked'
  /** Sudden death and this player is not one of the tied players. */
  | 'watching'
  /** The reveal is out: show this player's own outcome. */
  | 'result';

export interface PhoneView {
  stage: PhoneStage;
  over: boolean;
  /** This player's line from the reveal (only once revealed). */
  mine: RevealRow | null;
  /** Running total. */
  score: number;
}

/**
 * What a phone shows, from nothing but what the phone may read (getMyState). Until the reveal, nothing here can
 * contain the song or the year, because the phone's state does not.
 */
export function phoneView(s: MyState): PhoneView {
  const { player, room, round, answer } = s;
  const base = { over: room.status === 'over', mine: null as RevealRow | null, score: player.score };
  if (room.status === 'lobby' || !round || round.game_no !== room.game_no || round.status === 'skipped') {
    return { ...base, stage: 'waiting' };
  }
  if (round.status === 'revealed') {
    const reveal = round.reveal as ClosestYearReveal | null;
    return { ...base, stage: 'result', mine: reveal?.rows.find((r) => r.playerId === player.id) ?? null };
  }
  const contenders = suddenDeathContenders(room.settings);
  if (round.kind === 'sudden_death' && !contenders.includes(player.id)) return { ...base, stage: 'watching' };
  if (round.status === 'closed' || answer?.locked) return { ...base, stage: 'locked' };
  return { ...base, stage: 'answer' };
}

/** Send the current year pick and typed artist (optionally locking in). Safe to call again to change the answer. */
export function sendAnswer(phone: PhoneSession, roundId: string, a: { year: number | null; artist: string; lock?: boolean }): Promise<SubmitRaw> {
  const input: AnswerInput = { year: a.year, artist: a.artist, lock: a.lock ?? false };
  return phone.submit(roundId, input);
}
