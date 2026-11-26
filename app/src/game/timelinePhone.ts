import type { Card, TimelineRevealRow } from '../logic';
import type { AnswerInput, MyState, PhoneSession, SubmitRaw } from '../net';
import type { PhoneStage } from './phone';
import { suddenDeathContenders } from './closestYear';
import type { TimelineReveal } from './timeline';

export interface TimelinePhoneView {
  stage: PhoneStage;
  /** What the answer screen asks for: a slot in the timeline (normal round) or a year (sudden death). */
  input: 'slot' | 'year';
  over: boolean;
  /** This player's own timeline, and nobody else's. */
  timeline: Card[];
  artistHits: number;
  /** This player's line from the reveal (only once revealed). */
  mine: TimelineRevealRow | null;
}

/**
 * What a Timeline phone shows, from nothing but what the phone may read (getMyState): its own timeline, and the
 * song only inside the reveal. A seat with no cards (joined mid-round) waits for the next round.
 */
export function timelinePhoneView(s: MyState): TimelinePhoneView {
  const { player, room, round, answer } = s;
  const base = {
    over: room.status === 'over', timeline: player.timeline, artistHits: player.artist_hits,
    mine: null as TimelineRevealRow | null, input: 'slot' as 'slot' | 'year',
  };
  if (room.status === 'lobby' || !round || round.game_no !== room.game_no || round.status === 'skipped') {
    return { ...base, stage: 'waiting' };
  }
  if (round.status === 'revealed') {
    const reveal = round.reveal as TimelineReveal | null;
    return { ...base, input: round.kind === 'sudden_death' ? 'year' : 'slot', stage: 'result', mine: reveal?.rows.find((r) => r.playerId === player.id) ?? null };
  }
  if (round.kind === 'sudden_death') {
    const input = 'year' as const;
    if (!suddenDeathContenders(room.settings).includes(player.id)) return { ...base, input, stage: 'watching' };
    return { ...base, input, stage: round.status === 'closed' || answer?.locked ? 'locked' : 'answer' };
  }
  if (player.timeline.length === 0) return { ...base, stage: 'waiting' };
  return { ...base, stage: round.status === 'closed' || answer?.locked ? 'locked' : 'answer' };
}

/** Send the chosen slot (or, in sudden death, the year) and typed artist, optionally locking in. Safe to repeat until Lock In. */
export function sendTimelineAnswer(
  phone: PhoneSession, roundId: string, a: { slot?: number | null; year?: number | null; artist: string; lock?: boolean },
): Promise<SubmitRaw> {
  const input: AnswerInput = { slot: a.slot ?? null, year: a.year ?? null, artist: a.artist, lock: a.lock ?? false };
  return phone.submit(roundId, input);
}
