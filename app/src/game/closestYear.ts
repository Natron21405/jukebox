import {
  CONFIG, applyOverride, buildReveal, chooseNextSong, closestYearOutcome, everyoneLocked, isClosestYearOver,
  normalizeSettings, resolveSuddenDeathRound, timerExpired,
  type GameSong, type LobbySettings, type Outcome, type RevealPayload, type Rng,
} from '../logic';
import type { AnswerRow, HostSession, HostState, PlayerResult, PlayerRow } from '../net';

/** What the reveal carries on top of the scored rows: where the game stands now. Public only after the reveal. */
export interface ClosestYearReveal extends RevealPayload {
  /** Normal rounds played so far, this one included (sudden-death rounds are not counted). */
  roundsPlayed: number;
  roundsTotal: number;
  outcome: Outcome;
}

export type GamePhase = 'between' | 'listening' | 'closed' | 'reveal' | 'over';

/** Where the game is, read purely from the saved state, so a host refresh lands in the same place. */
export function gamePhase(s: Pick<HostState, 'room' | 'round'>): GamePhase {
  if (s.room.status === 'over') return 'over';
  const r = s.round;
  if (!r || r.game_no !== s.room.game_no || r.status === 'skipped') return 'between';
  return r.status === 'open' ? 'listening' : r.status === 'closed' ? 'closed' : 'reveal';
}

/** Sudden-death contenders and the winner are kept in room.settings (public, and survive a host refresh). */
export function suddenDeathContenders(settings: Record<string, unknown>): string[] {
  const v = settings.suddenDeath;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}
export function winnerOf(settings: Record<string, unknown>): { winnerId: string; decidedBy: string } | null {
  return typeof settings.winnerId === 'string' ? { winnerId: settings.winnerId, decidedBy: String(settings.decidedBy ?? '') } : null;
}
const roundsPlayedOf = (settings: Record<string, unknown>) => (typeof settings.roundsPlayed === 'number' ? settings.roundsPlayed : 0);
/**
 * The reveal and the room's outcome (status, winner, sudden-death list) are two separate writes. If the second one never
 * landed (a dropped request, a closed tab), the screen sits on a reveal that says "winner" while the room is still playing.
 * Returns what to write when the room does not match the reveal it is showing, or null when they agree.
 */
export function outcomeMismatch(s: Pick<HostState, 'room' | 'round'>): { roundsPlayed: number; outcome: Outcome } | null {
  const r = s.round;
  if (gamePhase(s) !== 'reveal' || !r || r.status !== 'revealed' || !r.reveal) return null;
  const rv = r.reveal as { outcome?: Outcome; roundsPlayed?: number };
  const o = rv.outcome;
  if (!o || typeof rv.roundsPlayed !== 'number') return null;
  const st = s.room.settings;
  const agrees = s.room.status === (o.status === 'winner' ? 'over' : 'playing')
    && (winnerOf(st)?.winnerId ?? null) === (o.status === 'winner' ? o.winnerId : null)
    && JSON.stringify(suddenDeathContenders(st)) === JSON.stringify(o.status === 'suddenDeath' ? o.contenders : [])
    && roundsPlayedOf(st) === rv.roundsPlayed;
  return agrees ? null : { roundsPlayed: rv.roundsPlayed, outcome: o };
}

export type NextRound =
  | { status: 'started'; roundId: string; roundNo: number; kind: 'normal' | 'sudden_death'; songId: string }
  | { status: 'exhausted'; resetWouldHelp: boolean }
  | { status: 'not-now'; phase: GamePhase };

export interface ClosestYearDeps {
  session: HostSession;
  pool: readonly GameSong[];
  rng: Rng;
  /** Wall clock in ms (injected so tests control the timer). */
  now?: () => number;
  /** Host year-range setting; defaults to the whole pool. */
  yearRange?: { min: number; max: number };
}

/**
 * Closest Year, host side. Holds no game state of its own: everything is read from, and written to, the room, so a
 * fresh instance after a host refresh carries on. The song id and the answer go to phones only inside the reveal.
 */
export class ClosestYearGame {
  private readonly songs: Map<string, GameSong>;
  private readonly now: () => number;
  private busy: Promise<unknown> = Promise.resolve();

  constructor(private readonly d: ClosestYearDeps) {
    this.songs = new Map(d.pool.map((s) => [s.id, s]));
    this.now = d.now ?? Date.now;
  }

  // Calls that write run one at a time, so a timer and an "everyone answered" event cannot both reveal the same round.
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.busy.then(fn, fn);
    this.busy = run.catch(() => undefined);
    return run;
  }

  settings(room: HostState['room']): LobbySettings { return normalizeSettings(room.settings); }

  /** Start (or restart) a game in this room: zero progress and move the room to "playing". Scores are reset by newGame(). */
  begin(): Promise<void> {
    return this.serial(async () => {
      await this.d.session.updateRoom({
        mode: 'closest_year', status: 'playing',
        settings: { roundsPlayed: 0, suddenDeath: [], winnerId: null, decidedBy: null },
      });
    });
  }

  /** Play Again with the same players: new game number, scores zeroed, back to a fresh start. */
  async playAgain(): Promise<void> {
    await this.d.session.newGame();
    await this.begin();
  }

  /** Pick the next unplayed, unblocked song and open the round. Never repeats a song. */
  nextRound(): Promise<NextRound> {
    return this.serial(async () => {
      const s = await this.d.session.state();
      const phase = gamePhase(s);
      if (phase === 'over' || phase === 'listening' || phase === 'closed') return { status: 'not-now', phase };
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

  /** Counts for the host's "N of M answered" line (numbers only, never who answered what). */
  static progress(s: Pick<HostState, 'room' | 'players' | 'locked_player_ids'>) {
    const contenders = suddenDeathContenders(s.room.settings);
    const expected = s.players.filter((p) => p.connected && (contenders.length === 0 || contenders.includes(p.id)));
    const locked = expected.filter((p) => s.locked_player_ids.includes(p.id)).length;
    return { locked, expected: expected.length, everyone: expected.length > 0 && locked === expected.length };
  }

  /**
   * Call on every lock-in and on a timer tick. Ends the round, and reveals it, when everyone expected has locked in
   * or the timer has run out. Returns the reveal if it ended the round, else null.
   */
  async checkAutoEnd(): Promise<ClosestYearReveal | null> {
    const s = await this.d.session.state();
    if (gamePhase(s) !== 'listening' || !s.round) return null;
    const contenders = suddenDeathContenders(s.room.settings);
    const early = everyoneLocked(s.players, s.locked_player_ids, contenders.length ? contenders : null);
    if (!early && !timerExpired(s.round.ends_at, this.now())) return null;
    return this.endRound();
  }

  /** Close the round, score it, publish the reveal and the new scores. Safe to call twice: the second call does nothing. */
  endRound(): Promise<ClosestYearReveal | null> {
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
      const scored = sudden ? s.players.filter((p) => contenders.includes(p.id)) : s.players;
      const reveal = buildReveal(song, r.kind, scored.map((p) => p.id), answers.map(toAnswer));

      const settings = this.settings(s.room);
      const roundsPlayed = roundsPlayedOf(s.room.settings) + (sudden ? 0 : 1);
      const updated = s.players.map((p) => {
        const row = reveal.rows.find((x) => x.playerId === p.id);
        return { ...p, score: p.score + (row?.total ?? 0), artist_hits: p.artist_hits + (row && !sudden && row.artistHit ? 1 : 0) };
      });
      const outcome = this.outcomeFor(sudden, roundsPlayed, settings.rounds, updated, reveal);
      const payload: ClosestYearReveal = { ...reveal, roundsPlayed, roundsTotal: settings.rounds, outcome };

      await session.reveal(r.id, payload, changes(s.players, updated));
      await this.saveOutcome(roundsPlayed, outcome);
      return payload;
    });
  }

  /**
   * Host override for a borderline artist guess on the round just revealed: true counts it, false rejects it, null
   * hands it back to the matcher. Re-scores that player and re-checks whether the game outcome changes.
   */
  setArtistOverride(playerId: string, value: boolean | null): Promise<ClosestYearReveal | null> {
    return this.serial(async () => {
      const { session } = this.d;
      const s = await session.state();
      const r = s.round;
      if (gamePhase(s) !== 'reveal' && gamePhase(s) !== 'over') return null;
      if (!r || r.status !== 'revealed' || !r.reveal) return null;
      const old = r.reveal as ClosestYearReveal;
      const song = this.songs.get(r.song_id);
      if (!song || !old.rows.some((x) => x.playerId === playerId)) return null;

      await session.setArtistOverride(r.id, playerId, value);
      const { reveal, scoreDelta, hitDelta } = applyOverride(old, song, playerId, value);
      const updated = s.players.map((p) => (p.id === playerId
        ? { ...p, score: p.score + scoreDelta, artist_hits: p.artist_hits + (old.kind === 'normal' ? hitDelta : 0) }
        : p));
      const outcome = this.outcomeFor(old.kind === 'sudden_death', old.roundsPlayed, old.roundsTotal, updated, reveal);
      const payload: ClosestYearReveal = { ...reveal, roundsPlayed: old.roundsPlayed, roundsTotal: old.roundsTotal, outcome };
      await session.reveal(r.id, payload, changes(s.players, updated));
      await this.saveOutcome(old.roundsPlayed, outcome);
      return payload;
    });
  }

  private outcomeFor(
    sudden: boolean, roundsPlayed: number, roundsTotal: number, players: readonly PlayerRow[], reveal: RevealPayload,
  ): Outcome {
    if (sudden) {
      return resolveSuddenDeathRound(reveal.rows.map((x) => ({ id: x.playerId, year: x.year })), reveal.song.year);
    }
    if (!isClosestYearOver(roundsPlayed, roundsTotal)) return { status: 'continue' };
    return closestYearOutcome(players.map((p) => ({ id: p.id, score: p.score })));
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

const toAnswer = (a: AnswerRow) => ({ playerId: a.player_id, year: a.year, artist: a.artist_guess, override: a.artist_override });

/** Only the players whose numbers changed need to be written. */
function changes(before: readonly PlayerRow[], after: readonly PlayerRow[]): PlayerResult[] {
  return after
    .filter((p, i) => p.score !== before[i].score || p.artist_hits !== before[i].artist_hits)
    .map((p) => ({ id: p.id, score: p.score, artist_hits: p.artist_hits }));
}

export { CONFIG };
