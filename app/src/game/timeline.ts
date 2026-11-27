import {
  applyTimelineOverride, buildTimelineReveal, chooseNextSong, dealStartingHands, everyoneLocked, normalizeSettings,
  resolveSuddenDeathRound, startingPairKey, timelineOutcome, timerExpired,
  type Card, type GameSong, type LobbySettings, type Outcome, type Rng, type TimelineRevealPayload,
} from '../logic';
import type { AnswerRow, HostSession, HostState, PlayerResult, PlayerRow } from '../net';
import { gamePhase, outcomeMismatch, suddenDeathContenders, type NextRound } from './closestYear';

/** What the Timeline reveal carries on top of the scored rows: where the game stands now. Public only after the reveal. */
export interface TimelineReveal extends TimelineRevealPayload {
  /** Normal rounds played so far, this one included (sudden-death rounds are not counted). */
  roundsPlayed: number;
  targetCards: number;
  outcome: Outcome;
}

export interface TimelineDeps {
  session: HostSession;
  pool: readonly GameSong[];
  rng: Rng;
  /** Wall clock in ms (injected so tests control the timer). */
  now?: () => number;
  yearRange?: { min: number; max: number };
}

/** A player can play once they hold cards. A seat with none joined mid-round and waits for the next round. */
const canPlay = (p: Pick<PlayerRow, 'timeline'>) => p.timeline.length > 0;

/**
 * Timeline, host side. Same shape as ClosestYearGame: no state of its own, everything is read from and written to
 * the room, so a fresh instance after a host refresh carries on. Phones only ever read their own timeline, and the
 * song and every answer reach them only inside the reveal.
 */
export class TimelineGame {
  private readonly songs: Map<string, GameSong>;
  private readonly now: () => number;
  private busy: Promise<unknown> = Promise.resolve();

  constructor(private readonly d: TimelineDeps) {
    this.songs = new Map(d.pool.map((s) => [s.id, s]));
    this.now = d.now ?? Date.now;
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.busy.then(fn, fn);
    this.busy = run.catch(() => undefined);
    return run;
  }

  settings(room: HostState['room']): LobbySettings { return normalizeSettings(room.settings); }

  /** Start (or restart) a game: zero progress, status "playing", and everyone gets two different year cards. */
  begin(): Promise<void> {
    return this.serial(async () => {
      await this.d.session.updateRoom({
        mode: 'timeline', status: 'playing',
        settings: { roundsPlayed: 0, suddenDeath: [], winnerId: null, decidedBy: null },
      });
      await this.dealMissing((await this.d.session.state()).players);
    });
  }

  /** Play Again with the same players: scores and timelines cleared, fresh starting cards, new game number. */
  async playAgain(): Promise<void> {
    await this.d.session.newGame();
    await this.begin();
  }

  /** Give starting cards to every player who has none (late joiners), avoiding pairs already held where possible. */
  private async dealMissing(players: readonly PlayerRow[]): Promise<PlayerRow[]> {
    const needy = players.filter((p) => !canPlay(p));
    if (needy.length === 0) return [...players];
    const used = players.map((p) => startingPairKey(p.timeline)).filter((k): k is string => k != null);
    const hands = dealStartingHands(needy.map((p) => p.id), this.d.rng, used);
    await this.d.session.updatePlayers(needy.map((p) => ({ id: p.id, timeline: hands[p.id] })));
    return players.map((p) => (hands[p.id] ? { ...p, timeline: hands[p.id] } : p));
  }

  /** Pick the next unplayed, unblocked song and open the round. Never repeats a song. */
  nextRound(): Promise<NextRound> {
    return this.serial(async () => {
      const s = await this.d.session.state();
      const phase = gamePhase(s);
      if (phase === 'over' || phase === 'listening' || phase === 'closed') return { status: 'not-now', phase };
      await this.dealMissing(s.players); // late joiners get their two cards before the song plays
      const picked = chooseNextSong(
        this.d.pool,
        { playedThisGame: s.played_this_game, playedEarlier: s.played_earlier, blocked: s.blocked, yearRange: this.d.yearRange },
        this.d.rng,
      );
      if (picked.status === 'exhausted') return { status: 'exhausted', resetWouldHelp: picked.resetWouldHelp };
      const kind = suddenDeathContenders(s.room.settings).length > 0 ? 'sudden_death' : 'normal';
      const round = await this.d.session.startRound(picked.song.id, { kind, seconds: this.settings(s.room).roundSeconds });
      return { status: 'started', roundId: round.id, roundNo: round.round_no, kind, songId: picked.song.id };
    });
  }

  /** The clip would not load: drop the round without penalty. The song stays in play history, so it will not come back. */
  skipRound(): Promise<boolean> {
    return this.serial(async () => {
      const s = await this.d.session.state();
      if (!s.round || (s.round.status !== 'open' && s.round.status !== 'closed')) return false;
      return (await this.d.session.closeRound(s.round.id, 'skipped')) != null;
    });
  }

  /** Players the round waits for: connected, holding cards, and (in sudden death) one of the contenders. */
  private static expected(s: Pick<HostState, 'room' | 'players'>): PlayerRow[] {
    const contenders = suddenDeathContenders(s.room.settings);
    return s.players.filter((p) => p.connected && canPlay(p) && (contenders.length === 0 || contenders.includes(p.id)));
  }

  /** Counts for the host's "N of M answered" line (numbers only, never who answered what). */
  static progress(s: Pick<HostState, 'room' | 'players' | 'locked_player_ids'>) {
    const expected = TimelineGame.expected(s);
    const locked = expected.filter((p) => s.locked_player_ids.includes(p.id)).length;
    return { locked, expected: expected.length, everyone: expected.length > 0 && locked === expected.length };
  }

  /** Call on every lock-in and on a timer tick. Reveals the round when everyone expected has locked in or time is up. */
  async checkAutoEnd(): Promise<TimelineReveal | null> {
    const s = await this.d.session.state();
    if (gamePhase(s) !== 'listening' || !s.round) return null;
    const early = everyoneLocked(TimelineGame.expected(s), s.locked_player_ids);
    if (!early && !timerExpired(s.round.ends_at, this.now())) return null;
    return this.endRound();
  }

  /** Close the round, place every card, publish the reveal and the new timelines. Safe to call twice. */
  endRound(): Promise<TimelineReveal | null> {
    return this.serial(async () => {
      const { session } = this.d;
      const s = await session.state();
      const r = s.round;
      const phase = gamePhase(s);
      if (!r || (phase !== 'listening' && phase !== 'closed')) return null;
      if (phase === 'listening') await session.closeRound(r.id, 'closed');
      const song = this.songs.get(r.song_id);
      if (!song) throw new Error('song not in pool');

      const answers = await session.answers(r.id);
      const contenders = suddenDeathContenders(s.room.settings);
      const sudden = r.kind === 'sudden_death';
      // Seats without cards (joined mid-round) are not scored; they get their cards when the next round starts.
      const scored = s.players.filter((p) => canPlay(p) && (!sudden || contenders.includes(p.id)));
      const { reveal, timelines } = buildTimelineReveal(song, r.kind, scored, answers.map(toAnswer));

      const settings = this.settings(s.room);
      const roundsPlayed = roundsPlayedOf(s.room.settings) + (sudden ? 0 : 1);
      const updated = s.players.map((p) => {
        const row = reveal.rows.find((x) => x.playerId === p.id);
        return { ...p, timeline: timelines[p.id] ?? p.timeline, artist_hits: p.artist_hits + (row?.artistHit ? 1 : 0) };
      });
      const outcome = this.outcomeFor(sudden, settings.targetCards, updated, reveal);
      const payload: TimelineReveal = { ...reveal, roundsPlayed, targetCards: settings.targetCards, outcome };

      await session.reveal(r.id, payload, changes(s.players, updated));
      await this.saveOutcome(roundsPlayed, outcome);
      return payload;
    });
  }

  /**
   * Host override for a borderline artist guess on the round just revealed: true counts it, false rejects it, null
   * hands it back to the matcher. Hits only matter for the tiebreak, so this re-checks the game outcome.
   */
  setArtistOverride(playerId: string, value: boolean | null): Promise<TimelineReveal | null> {
    return this.serial(async () => {
      const { session } = this.d;
      const s = await session.state();
      const r = s.round;
      if (gamePhase(s) !== 'reveal' && gamePhase(s) !== 'over') return null;
      if (!r || r.status !== 'revealed' || !r.reveal) return null;
      const old = r.reveal as TimelineReveal;
      const song = this.songs.get(r.song_id);
      if (!song || !old.rows.some((x) => x.playerId === playerId)) return null;

      await session.setArtistOverride(r.id, playerId, value);
      const { reveal, hitDelta } = applyTimelineOverride(old, song, playerId, value);
      const updated = s.players.map((p) => (p.id === playerId ? { ...p, artist_hits: p.artist_hits + hitDelta } : p));
      const outcome = old.kind === 'sudden_death' ? old.outcome : this.outcomeFor(false, old.targetCards, updated, reveal);
      const payload: TimelineReveal = { ...reveal, roundsPlayed: old.roundsPlayed, targetCards: old.targetCards, outcome };
      await session.reveal(r.id, payload, changes(s.players, updated));
      await this.saveOutcome(old.roundsPlayed, outcome);
      return payload;
    });
  }

  private outcomeFor(sudden: boolean, target: number, players: readonly PlayerRow[], reveal: TimelineRevealPayload): Outcome {
    if (sudden) {
      return resolveSuddenDeathRound(reveal.rows.map((x) => ({ id: x.playerId, year: x.year })), reveal.song.year);
    }
    return timelineOutcome(players.map((p) => ({ id: p.id, cards: p.timeline.length, artistHits: p.artist_hits })), target);
  }

  /**
   * The reveal and the room's outcome (status, winner, sudden-death list) are two separate writes. If the second one never
   * landed (a dropped request, a closed tab), the screen would sit on a reveal that says "winner" while the room is still
   * playing. This writes the outcome the reveal already holds. Safe to call any time; does nothing when they agree.
   */
  repairOutcome(): Promise<boolean> {
    return this.serial(async () => {
      const fix = outcomeMismatch(await this.d.session.state());
      if (!fix) return false;
      await this.saveOutcome(fix.roundsPlayed, fix.outcome);
      return true;
    });
  }

  private async saveOutcome(roundsPlayed: number, o: Outcome): Promise<void> {
    await this.d.session.updateRoom({
      status: o.status === 'winner' ? 'over' : 'playing',
      settings: {
        roundsPlayed,
        suddenDeath: o.status === 'suddenDeath' ? o.contenders : [],
        winnerId: o.status === 'winner' ? o.winnerId : null,
        decidedBy: o.status === 'winner' ? o.decidedBy : null,
      },
    });
  }
}

const roundsPlayedOf = (settings: Record<string, unknown>) => (typeof settings.roundsPlayed === 'number' ? settings.roundsPlayed : 0);
const toAnswer = (a: AnswerRow) => ({
  playerId: a.player_id, slot: a.slot, year: a.year, artist: a.artist_guess, override: a.artist_override,
});

/** Only the players whose cards or hits changed need to be written. */
function changes(before: readonly PlayerRow[], after: readonly PlayerRow[]): PlayerResult[] {
  const out: PlayerResult[] = [];
  after.forEach((p, i) => {
    const b = before[i];
    if (p.timeline.length !== b.timeline.length) out.push({ id: p.id, artist_hits: p.artist_hits, timeline: p.timeline as Card[] });
    else if (p.artist_hits !== b.artist_hits) out.push({ id: p.id, artist_hits: p.artist_hits });
  });
  return out;
}
