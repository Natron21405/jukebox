import { afterEach, describe, expect, it } from 'vitest';
import { CONFIG, seededRng, type Card, type GameSong } from '../logic';
import {
  HostSession, createFakeBackend, createHostRoom, joinGame, memoryKV, startPhoneSession,
  type FakeBackend, type PhoneSession,
} from '../net';
import { gamePhase, suddenDeathContenders, winnerOf } from './closestYear';
import { TimelineGame, type TimelineReveal } from './timeline';
import { sendTimelineAnswer, timelinePhoneView } from './timelinePhone';

// Made-up songs only. Years spread over 1960 to 2014; every title and artist is unique per song.
const POOL: GameSong[] = Array.from({ length: 80 }, (_, n) => ({
  id: `t-${String(n).padStart(3, '0')}`,
  title: `Invented Title ${n}`,
  artists: [`Quorblat Ensemble ${n}`],
  featuredArtists: [`Gleep Guest ${n}`],
  year: 1960 + ((n * 7) % 55),
}));
const byId = new Map(POOL.map((s) => [s.id, s]));
const NAMES = ['Ana', 'Bo', 'Cy', 'Di', 'Ed'];

// Worked out by hand here, apart from the game's own placement code: slot n means "before the card at index n".
const rightSlots = (t: readonly Card[], year: number) =>
  Array.from({ length: t.length + 1 }, (_, i) => i).filter((i) => (i === 0 || t[i - 1].year <= year) && (i === t.length || year <= t[i].year));
const rightSlot = (t: readonly Card[], year: number) => rightSlots(t, year)[0];
const wrongSlot = (t: readonly Card[], year: number) => {
  const ok = rightSlots(t, year);
  const bad = Array.from({ length: t.length + 1 }, (_, i) => i).find((i) => !ok.includes(i));
  if (bad === undefined) throw new Error('no wrong slot exists');
  return bad;
};

type SlotPlan = 'right' | 'wrong' | 'none';
type ArtistPlan = 'hit' | 'featured' | 'wrong' | 'none';
interface Plan { slot: SlotPlan; artist: ArtistPlan; lock?: boolean }

interface Rig {
  fake: FakeBackend;
  host: HostSession;
  game: TimelineGame;
  phones: PhoneSession[];
  ids: string[];
  code: string;
  elapsed: () => number;
  tick: (ms: number) => void;
}

const open: PhoneSession[] = [];
afterEach(async () => { while (open.length) await open.pop()!.stop(); });

async function rig(count = 5): Promise<Rig> {
  const fake = createFakeBackend();
  const creds = await createHostRoom(fake, memoryKV(), 'timeline');
  const host = new HostSession(fake, creds);
  const phones: PhoneSession[] = [];
  for (const name of NAMES.slice(0, count)) phones.push(await join(fake, creds.code, name));
  let elapsed = 0;
  const base = Date.UTC(2026, 0, 1);
  const game = new TimelineGame({ session: host, pool: POOL, rng: seededRng(11), now: () => base + elapsed });
  return {
    fake, host, game, phones, ids: phones.map((p) => p.seat.playerId), code: creds.code,
    elapsed: () => elapsed, tick: (ms) => { elapsed += ms; fake.advance(ms); },
  };
}

async function join(fake: FakeBackend, code: string, name: string): Promise<PhoneSession> {
  const j = await joinGame(fake, memoryKV(), { code, name });
  if (!j.ok) throw new Error('join failed');
  const p = await startPhoneSession(fake, j.seat);
  open.push(p);
  return p;
}

const timelinesOf = async (r: Rig) => (await r.host.state()).players.map((p) => p.timeline);
const hitsOf = async (r: Rig) => (await r.host.state()).players.map((p) => p.artist_hits);

function typed(song: GameSong, a: ArtistPlan): string {
  return a === 'hit' ? song.artists[0] : a === 'featured' ? song.featuredArtists[0] : a === 'wrong' ? 'Some Other Band' : '';
}

/** Open a round, check nothing leaks, have everybody answer per plan, end it (early, or by the timer), return the reveal. */
async function playNormalRound(r: Rig, plans: Plan[], seen: string[]) {
  const next = await r.game.nextRound();
  if (next.status !== 'started') throw new Error('expected a round');
  expect(next.kind).toBe('normal');
  expect(seen).not.toContain(next.songId);
  seen.push(next.songId);
  const song = byId.get(next.songId)!;
  const before = await timelinesOf(r);

  // Before the reveal, nothing the phones (or any watcher) can read holds the song, any slot or any typed guess.
  const snap = r.fake.publicSnapshot();
  const secrets = [song.id, song.title, song.artists[0], song.featuredArtists[0]].map((x) => JSON.stringify(x)); // whole values: "Title 3" is not "Title 30"
  for (const secret of secrets) expect(snap).not.toContain(secret);
  for (let i = 0; i < r.phones.length; i++) {
    const mine = (await r.phones[i].state())!;
    const json = JSON.stringify(mine);
    for (const secret of secrets) expect(json).not.toContain(secret);
    r.ids.forEach((id, j) => { if (j !== i) expect(json).not.toContain(id); }); // only its own seat in its state
    const view = timelinePhoneView(mine);
    expect(view.stage).toBe('answer');
    expect(view.input).toBe('slot');
    expect(view.timeline).toEqual(before[i]); // its own timeline, no more
  }

  let locks = 0;
  for (let i = 0; i < r.phones.length; i++) {
    const p = plans[i];
    const slot = p.slot === 'right' ? rightSlot(before[i], song.year) : p.slot === 'wrong' ? wrongSlot(before[i], song.year) : null;
    const lock = p.lock ?? true;
    const res = await sendTimelineAnswer(r.phones[i], next.roundId, { slot, artist: typed(song, p.artist), lock });
    expect(res.ok).toBe(true);
    if (lock) locks += 1;
    if (locks < r.phones.length) expect(await r.game.checkAutoEnd()).toBeNull(); // not everyone yet
  }
  let reveal: TimelineReveal | null;
  if (locks === r.phones.length) {
    reveal = await r.game.checkAutoEnd();
  } else {
    expect(await r.game.checkAutoEnd()).toBeNull();
    r.tick(CONFIG.roundSeconds * 1000 - 1);
    expect(await r.game.checkAutoEnd()).toBeNull();
    r.tick(2);
    reveal = await r.game.checkAutoEnd();
  }
  expect(reveal).not.toBeNull();
  expect(await r.game.checkAutoEnd()).toBeNull(); // already revealed: nothing happens twice
  expect(reveal!.song.id).toBe(song.id);

  // Placement and artist results, against the hand-written rules.
  const after = await timelinesOf(r);
  plans.forEach((p, i) => {
    const row = reveal!.rows[i];
    const right = p.slot === 'right';
    expect(row.correct).toBe(right);
    expect(row.artistHit).toBe(p.artist === 'hit'); // a hit counts whether or not the placement was right
    if (right) {
      expect(after[i]).toHaveLength(before[i].length + 1);
      expect(after[i].filter((c) => c.songId === song.id)).toHaveLength(1);
      expect(after[i].map((c) => c.year)).toEqual([...after[i].map((c) => c.year)].sort((a, b) => a - b));
    } else {
      expect(after[i]).toEqual(before[i]); // wrong or no answer: nothing added, nothing lost
    }
    expect(row.cards).toBe(after[i].length);
  });
  return { reveal: reveal!, song, before, after };
}

async function playSuddenRound(r: Rig, offsets: Array<number | null>, contenders: number[], seen: string[]) {
  const next = await r.game.nextRound();
  if (next.status !== 'started') throw new Error('expected a round');
  expect(next.kind).toBe('sudden_death');
  expect(seen).not.toContain(next.songId);
  seen.push(next.songId);
  const song = byId.get(next.songId)!;
  for (let i = 0; i < r.phones.length; i++) {
    const view = timelinePhoneView((await r.phones[i].state())!);
    expect(view.input).toBe('year');
    expect(view.stage).toBe(contenders.includes(i) ? 'answer' : 'watching');
  }
  const before = await timelinesOf(r);
  const hitsBefore = await hitsOf(r);
  let reveal: TimelineReveal | null = null;
  for (const [k, i] of contenders.entries()) {
    const off = offsets[k];
    // Everyone types the right artist: it must not count in sudden death.
    await sendTimelineAnswer(r.phones[i], next.roundId, { year: off == null ? null : song.year + off, artist: song.artists[0], lock: true });
    reveal = await r.game.checkAutoEnd(); // the others are not waited for
    if (k < contenders.length - 1) expect(reveal).toBeNull();
  }
  expect(reveal).not.toBeNull();
  expect(reveal!.kind).toBe('sudden_death');
  expect(reveal!.rows).toHaveLength(contenders.length);
  expect(await timelinesOf(r)).toEqual(before); // sudden death never changes a timeline
  expect(await hitsOf(r)).toEqual(hitsBefore); // nor counts artist hits
  return reveal!;
}

describe('Timeline over the fake net', () => {
  it('deals two different year cards to each of five players, no pair shared', async () => {
    const r = await rig();
    await r.game.begin();
    const tl = await timelinesOf(r);
    const pairs = new Set<string>();
    for (const t of tl) {
      expect(t).toHaveLength(CONFIG.timeline.startingCards);
      expect(t.every((c) => c.starter === true && c.songId === undefined)).toBe(true);
      expect(t[0].year).not.toBe(t[1].year);
      for (const c of t) expect(c.year >= CONFIG.timeline.startYearMin && c.year <= CONFIG.timeline.startYearMax).toBe(true);
      expect(t.map((c) => c.year)).toEqual([...t.map((c) => c.year)].sort((a, b) => a - b));
      pairs.add(t.map((c) => c.year).join('-'));
    }
    expect(pairs.size).toBe(5);
    expect(gamePhase(await r.host.state())).toBe('between');
  });

  it('plays a full game to 12 cards: wrong placements change nothing, a tie at the finish goes to artist hits, no repeats', async () => {
    const r = await rig();
    await r.game.begin();
    const seen: string[] = [];
    const cards = [2, 2, 2, 2, 2];
    const hits = [0, 0, 0, 0, 0];
    let normalRounds = 0;
    let skipped = 0;
    let last: TimelineReveal | null = null;

    // The first song has a dead preview: skipped, not a round, never repeats.
    const first = await r.game.nextRound();
    if (first.status !== 'started') throw new Error('expected a round');
    seen.push(first.songId);
    expect(await r.game.skipRound()).toBe(true);
    skipped += 1;
    expect(gamePhase(await r.host.state())).toBe('between');

    while (!last || last.outcome.status === 'continue') {
      normalRounds += 1;
      const n = normalRounds;
      const plans: Plan[] = [
        { slot: 'right', artist: 'hit' }, //                         Ana: always right, always names the artist
        { slot: 'right', artist: 'none' }, //                        Bo: always right, never names the artist
        { slot: n % 2 === 0 ? 'right' : 'wrong', artist: 'featured' }, // Cy: right on even rounds; a featured artist never counts
        { slot: 'wrong', artist: 'hit' }, //                         Di: always wrong, still names the artist
        n === 3 ? { slot: 'none', artist: 'none', lock: false } : { slot: 'right', artist: 'wrong' }, // Ed: silent in round 3
      ];
      if (n === 3) plans[4] = { slot: 'none', artist: 'none', lock: false };
      const { reveal } = await playNormalRound(r, plans, seen);
      last = reveal;
      plans.forEach((p, i) => {
        if (p.slot === 'right') cards[i] += 1;
        if (p.artist === 'hit') hits[i] += 1;
      });
      expect(reveal.roundsPlayed).toBe(n);
      expect(reveal.rows.map((x) => x.cards)).toEqual(cards);
      expect((await r.host.state()).players.map((p) => p.artist_hits)).toEqual(hits);
      if (n < 10) expect(reveal.outcome.status).toBe('continue');
      if (n > 12) throw new Error('game did not end');
    }

    // Ana and Bo both placed every song: 12 cards on round 10. Ana named the artist ten times, Bo never.
    expect(normalRounds).toBe(10);
    expect(cards).toEqual([12, 12, 7, 2, 11]);
    expect(hits).toEqual([10, 0, 0, 10, 0]);
    expect(last!.outcome).toEqual({ status: 'winner', winnerId: r.ids[0], decidedBy: 'artistHits' });
    const s = await r.host.state();
    expect(s.room.status).toBe('over');
    expect(winnerOf(s.room.settings)).toEqual({ winnerId: r.ids[0], decidedBy: 'artistHits' });
    expect(gamePhase(s)).toBe('over');
    expect(s.players.map((p) => p.timeline.length)).toEqual(cards);
    expect(timelinePhoneView((await r.phones[4].state())!).over).toBe(true);
    // Di never placed a card, so only the two starting cards remain.
    expect(s.players[3].timeline.every((c) => c.starter === true)).toBe(true);

    // Every timeline is sorted and holds each song at most once; the game never repeated a song.
    for (const p of s.players) {
      expect(p.timeline.map((c) => c.year)).toEqual([...p.timeline.map((c) => c.year)].sort((a, b) => a - b));
      const ids = p.timeline.map((c) => c.songId).filter(Boolean);
      expect(new Set(ids).size).toBe(ids.length);
    }
    expect(seen).toHaveLength(normalRounds + skipped);
    expect(new Set(seen).size).toBe(seen.length);
    expect([...s.played_this_game].sort()).toEqual([...seen].sort());
    expect((await r.game.nextRound()).status).toBe('not-now');
    expect(skipped).toBe(1);
  });

  it('a tie on hits among the finishers goes to sudden death among only the tied players: closest year, repeat until one is left', async () => {
    const r = await rig();
    await r.game.begin();
    const seen: string[] = [];
    let last: TimelineReveal | null = null;
    let n = 0;
    while (!last || last.outcome.status === 'continue') {
      n += 1;
      // Ana, Bo and Cy place every song. Ana and Bo name every artist; Cy never does. Di and Ed are always wrong.
      const plans: Plan[] = [
        { slot: 'right', artist: 'hit' }, { slot: 'right', artist: 'hit' }, { slot: 'right', artist: 'none' },
        { slot: 'wrong', artist: 'none' }, { slot: 'wrong', artist: 'wrong' },
      ];
      last = (await playNormalRound(r, plans, seen)).reveal;
      if (n > 12) throw new Error('game did not end');
    }
    expect(n).toBe(10);
    // Three finishers; Cy's zero hits drop out; Ana and Bo (10 hits each) are tied.
    expect(last.outcome.status).toBe('suddenDeath');
    let s = await r.host.state();
    expect(s.room.status).toBe('playing');
    expect(suddenDeathContenders(s.room.settings).sort()).toEqual([r.ids[0], r.ids[1]].sort());
    expect(s.players.map((p) => p.artist_hits)).toEqual([10, 10, 0, 0, 0]);
    expect(winnerOf(s.room.settings)).toBeNull();
    // The reveal stays up until the host starts the sudden-death round; the contenders are stored in the room.
    expect(gamePhase(s)).toBe('reveal');

    // Sudden death 1: both exactly right, still tied. Sudden death 2: Ana 3 years off, Bo 1 year off: Bo wins.
    const sd1 = await playSuddenRound(r, [0, 0], [0, 1], seen);
    expect(sd1.rows.map((x) => x.distance)).toEqual([0, 0]);
    expect(sd1.outcome.status).toBe('suddenDeath');
    expect((sd1.outcome as { contenders: string[] }).contenders.sort()).toEqual([r.ids[0], r.ids[1]].sort());
    expect((await r.host.state()).room.status).toBe('playing');

    const sd2 = await playSuddenRound(r, [3, -1], [0, 1], seen);
    expect(sd2.rows.map((x) => x.distance)).toEqual([3, 1]);
    expect(sd2.rows.every((x) => x.artistHit === false)).toBe(true);
    expect(sd2.outcome).toEqual({ status: 'winner', winnerId: r.ids[1], decidedBy: 'suddenDeath' });
    s = await r.host.state();
    expect(s.room.status).toBe('over');
    expect(winnerOf(s.room.settings)).toEqual({ winnerId: r.ids[1], decidedBy: 'suddenDeath' });
    expect(s.players.map((p) => p.timeline.length)).toEqual([12, 12, 12, 2, 2]);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toHaveLength(12);
    expect((await r.game.nextRound()).status).toBe('not-now');

    // Play again: fresh starting cards for everyone, scores clear, and none of those 12 songs comes back.
    await r.game.playAgain();
    s = await r.host.state();
    expect(s.room.status).toBe('playing');
    expect(winnerOf(s.room.settings)).toBeNull();
    expect(s.players.every((p) => p.timeline.length === 2 && p.artist_hits === 0)).toBe(true);
    const plans: Plan[] = Array.from({ length: 5 }, () => ({ slot: 'right' as const, artist: 'none' as const }));
    for (let k = 0; k < 10; k++) await playNormalRound(r, plans, seen);
    expect(new Set(seen).size).toBe(seen.length); // no repeats across games either
    expect(seen).toHaveLength(22);
  });

  it('sudden death where a contender gives no answer: the one who answered wins; and the host override can change a tie on hits', async () => {
    const r = await rig();
    await r.game.begin();
    const seen: string[] = [];
    let last: TimelineReveal | null = null;
    let n = 0;
    while (!last || last.outcome.status === 'continue') {
      n += 1;
      // Ana and Bo place everything and name every artist, except that in the last round Bo types a partial name.
      const finalRound = n === 10;
      const plans: Plan[] = [
        { slot: 'right', artist: 'hit' }, { slot: 'right', artist: finalRound ? 'wrong' : 'hit' },
        { slot: 'wrong', artist: 'none' }, { slot: 'wrong', artist: 'none' }, { slot: 'wrong', artist: 'none' },
      ];
      last = (await playNormalRound(r, plans, seen)).reveal;
      if (n > 12) throw new Error('game did not end');
    }
    // Ana has 10 hits, Bo 9: Ana wins on hits.
    expect(last.outcome).toEqual({ status: 'winner', winnerId: r.ids[0], decidedBy: 'artistHits' });
    expect((await r.host.state()).players.map((p) => p.artist_hits)).toEqual([10, 9, 0, 0, 0]);

    // The host decides Bo's guess was close enough: 10 hits each, so it is a tie again and the game reopens.
    const fixed = await r.game.setArtistOverride(r.ids[1], true);
    expect(fixed!.rows[1]).toMatchObject({ override: true, artistHit: true });
    expect(fixed!.outcome.status).toBe('suddenDeath');
    let s = await r.host.state();
    expect(s.room.status).toBe('playing');
    expect(s.players.map((p) => p.artist_hits)).toEqual([10, 10, 0, 0, 0]);
    expect(suddenDeathContenders(s.room.settings).sort()).toEqual([r.ids[0], r.ids[1]].sort());
    expect(s.players.map((p) => p.timeline.length)).toEqual([12, 12, 2, 2, 2]); // the override never moves cards

    // Sudden death: Ana does not answer, Bo does (and is far off). An answer, however bad, beats none.
    const next = await r.game.nextRound();
    if (next.status !== 'started') throw new Error('expected a round');
    seen.push(next.songId);
    const song = byId.get(next.songId)!;
    await sendTimelineAnswer(r.phones[1], next.roundId, { year: song.year + 20, artist: '', lock: true });
    expect(await r.game.checkAutoEnd()).toBeNull(); // Ana is connected and has not locked in
    r.tick(CONFIG.roundSeconds * 1000 + 1);
    const rv = await r.game.checkAutoEnd();
    expect(rv!.rows.map((x) => x.year)).toEqual([null, song.year + 20]);
    expect(rv!.outcome).toEqual({ status: 'winner', winnerId: r.ids[1], decidedBy: 'suddenDeath' });
    s = await r.host.state();
    expect(s.room.status).toBe('over');

    // Overriding a sudden-death row never counts a hit.
    const sd = await r.game.setArtistOverride(r.ids[1], true);
    expect(sd!.rows[1].artistHit).toBe(false);
    expect((await r.host.state()).players.map((p) => p.artist_hits)).toEqual([10, 10, 0, 0, 0]);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('a seat that joins mid-game gets two different year cards before the next song and never holds up a round', async () => {
    const r = await rig();
    await r.game.begin();
    const seen: string[] = [];
    const base: Plan[] = Array.from({ length: 5 }, () => ({ slot: 'right' as const, artist: 'none' as const }));
    await playNormalRound(r, base, seen);

    // Joins while the next round is open: no cards yet, waiting, and the round does not wait for them.
    const next = await r.game.nextRound();
    if (next.status !== 'started') throw new Error('expected a round');
    seen.push(next.songId);
    const late = await join(r.fake, r.code, 'Flo');
    let view = timelinePhoneView((await late.state())!);
    expect(view.stage).toBe('waiting');
    expect(view.timeline).toHaveLength(0);
    const song = byId.get(next.songId)!;
    const tl = await timelinesOf(r);
    for (let i = 0; i < 5; i++) {
      await sendTimelineAnswer(r.phones[i], next.roundId, { slot: rightSlot(tl[i], song.year), artist: '', lock: true });
    }
    expect(TimelineGame.progress(await r.host.state())).toMatchObject({ locked: 5, expected: 5, everyone: true });
    const rv = await r.game.checkAutoEnd();
    expect(rv).not.toBeNull();
    expect(rv!.rows).toHaveLength(5);

    // The next round gives Flo a starting pair that no one else holds.
    const n3 = await r.game.nextRound();
    if (n3.status !== 'started') throw new Error('expected a round');
    seen.push(n3.songId);
    view = timelinePhoneView((await late.state())!);
    expect(view.stage).toBe('answer');
    expect(view.timeline).toHaveLength(2);
    expect(view.timeline.every((c) => c.starter === true)).toBe(true);
    expect(view.timeline[0].year).not.toBe(view.timeline[1].year);
    const key = (t: Card[]) => t.filter((c) => c.starter).map((c) => c.year).join('-');
    const pairs = (await timelinesOf(r)).map(key);
    expect(new Set(pairs).size).toBe(6);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('ignores a disconnected player when deciding everyone has answered, and a fresh controller can finish the round', async () => {
    const r = await rig();
    await r.game.begin();
    await r.phones[4].stop();
    const next = await r.game.nextRound();
    if (next.status !== 'started') throw new Error('expected a round');
    const song = byId.get(next.songId)!;
    const tl = await timelinesOf(r);
    for (let i = 0; i < 4; i++) await sendTimelineAnswer(r.phones[i], next.roundId, { slot: rightSlot(tl[i], song.year), artist: '', lock: true });
    const again = new TimelineGame({ session: r.host, pool: POOL, rng: seededRng(5), now: () => Date.UTC(2026, 0, 1) + r.elapsed() });
    const rv = await again.checkAutoEnd();
    expect(rv).not.toBeNull();
    expect(rv!.rows).toHaveLength(5);
    expect(rv!.rows[4].slot).toBeNull();
    expect(rv!.rows[4].cards).toBe(2);
    expect(TimelineGame.progress(await r.host.state()).expected).toBe(4);
  });

  it('treats junk slots as no answer, and reports exhaustion when the pool runs out', async () => {
    const r = await rig();
    await r.game.begin();
    const next = await r.game.nextRound();
    if (next.status !== 'started') throw new Error('expected a round');
    const before = await timelinesOf(r);
    await sendTimelineAnswer(r.phones[0], next.roundId, { slot: 99, artist: '', lock: true });
    await sendTimelineAnswer(r.phones[1], next.roundId, { slot: -1, artist: '', lock: true });
    const rv = await r.game.endRound();
    expect(rv!.rows.slice(0, 2).map((x) => x.correct)).toEqual([false, false]);
    expect((await timelinesOf(r)).slice(0, 2)).toEqual(before.slice(0, 2));

    const small = new TimelineGame({ session: r.host, pool: POOL.slice(0, 2), rng: seededRng(1) });
    await small.begin();
    expect((await small.nextRound()).status).toBe('started'); // may pick the song already played: it is in history
    expect(['started', 'exhausted']).toContain((await (async () => { await small.skipRound(); return small.nextRound(); })()).status);
  });
});
