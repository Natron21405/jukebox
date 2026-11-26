import { describe, expect, it } from 'vitest';
import {
  closestYearOutcome,
  isClosestYearOver,
  rankClosestYear,
  rankTimeline,
  resolveSuddenDeathRound,
  timelineOutcome,
} from './endgame';

const tp = (id: string, cards: number, artistHits = 0) => ({ id, cards, artistHits });

describe('Timeline outcome', () => {
  it('continues while nobody has 12 cards (starters count, so 11 is not enough)', () => {
    expect(timelineOutcome([tp('a', 11), tp('b', 2)])).toEqual({ status: 'continue' });
  });
  it('a lone finisher at 12 wins', () => {
    expect(timelineOutcome([tp('a', 12), tp('b', 11, 9)])).toEqual({ status: 'winner', winnerId: 'a', decidedBy: 'target' });
  });
  it('target is configurable', () => {
    expect(timelineOutcome([tp('a', 5)], 5).status).toBe('winner');
  });
  it('same-round tie: most artist hits wins', () => {
    expect(timelineOutcome([tp('a', 12, 3), tp('b', 12, 5), tp('c', 11, 99)])).toEqual({
      status: 'winner',
      winnerId: 'b',
      decidedBy: 'artistHits',
    });
  });
  it('same-round tie with equal hits: sudden death among tied players only', () => {
    expect(timelineOutcome([tp('a', 12, 4), tp('b', 12, 4), tp('c', 12, 1), tp('d', 9, 4)])).toEqual({
      status: 'suddenDeath',
      contenders: ['a', 'b'],
    });
  });
  it('three-way tie on hits keeps all three', () => {
    const o = timelineOutcome([tp('a', 12, 2), tp('b', 12, 2), tp('c', 12, 2)]);
    expect(o).toEqual({ status: 'suddenDeath', contenders: ['a', 'b', 'c'] });
  });
  it('ranks by cards then artist hits', () => {
    expect(rankTimeline([tp('a', 5, 1), tp('b', 6, 0), tp('c', 5, 3)]).map((p) => p.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('Closest Year outcome', () => {
  it('is over after the configured number of rounds', () => {
    expect(isClosestYearOver(14)).toBe(false);
    expect(isClosestYearOver(15)).toBe(true);
    expect(isClosestYearOver(3, 3)).toBe(true);
  });
  it('a single top score wins', () => {
    expect(closestYearOutcome([{ id: 'a', score: 40 }, { id: 'b', score: 41 }, { id: 'c', score: 3 }])).toEqual({
      status: 'winner',
      winnerId: 'b',
      decidedBy: 'score',
    });
  });
  it('a tie at the top goes straight to sudden death among the tied players', () => {
    expect(closestYearOutcome([{ id: 'a', score: 41 }, { id: 'b', score: 41 }, { id: 'c', score: 40 }])).toEqual({
      status: 'suddenDeath',
      contenders: ['a', 'b'],
    });
  });
  it('a tie that is not at the top is ignored', () => {
    expect(closestYearOutcome([{ id: 'a', score: 50 }, { id: 'b', score: 10 }, { id: 'c', score: 10 }]).status).toBe('winner');
  });
  it('everyone on zero is a full tie', () => {
    expect(closestYearOutcome([{ id: 'a', score: 0 }, { id: 'b', score: 0 }])).toEqual({
      status: 'suddenDeath',
      contenders: ['a', 'b'],
    });
  });
  it('ranks by score', () => {
    expect(rankClosestYear([{ id: 'a', score: 1 }, { id: 'b', score: 9 }]).map((p) => p.id)).toEqual(['b', 'a']);
  });
});

describe('sudden death rounds', () => {
  it('closest year wins', () => {
    expect(resolveSuddenDeathRound([{ id: 'a', year: 1989 }, { id: 'b', year: 1993 }], 1990)).toEqual({
      status: 'winner',
      winnerId: 'a',
      decidedBy: 'suddenDeath',
    });
  });
  it('distance is measured either side of the truth', () => {
    expect(resolveSuddenDeathRound([{ id: 'a', year: 1995 }, { id: 'b', year: 1988 }], 1990).status).toBe('winner');
    expect(resolveSuddenDeathRound([{ id: 'a', year: 1995 }, { id: 'b', year: 1988 }], 1990)).toMatchObject({ winnerId: 'b' });
  });
  it('equal distance on opposite sides is still a tie, and only the tied players go again', () => {
    expect(
      resolveSuddenDeathRound([{ id: 'a', year: 1988 }, { id: 'b', year: 1992 }, { id: 'c', year: 1999 }], 1990),
    ).toEqual({ status: 'suddenDeath', contenders: ['a', 'b'] });
  });
  it('a missing answer loses to any answer', () => {
    expect(resolveSuddenDeathRound([{ id: 'a', year: null }, { id: 'b', year: 1950 }], 1990)).toMatchObject({
      status: 'winner',
      winnerId: 'b',
    });
  });
  it('nobody answering repeats with the same contenders', () => {
    expect(resolveSuddenDeathRound([{ id: 'a', year: null }, { id: 'b', year: null }], 1990)).toEqual({
      status: 'suddenDeath',
      contenders: ['a', 'b'],
    });
  });
  it('repeats until one winner remains', () => {
    let contenders = ['a', 'b', 'c'];
    const rounds: Array<Record<string, number>> = [
      { a: 1990, b: 1990, c: 1980 }, // a, b tie exact
      { a: 2000, b: 2000 }, // still tied
      { a: 2001, b: 1999 }, // tie again on distance? truth 2000: both 1 away
      { a: 2000, b: 1999 }, // a wins
    ];
    const truths = [1990, 2000, 2000, 2000];
    let result = resolveSuddenDeathRound(contenders.map((id) => ({ id, year: rounds[0][id] })), truths[0]);
    for (let i = 1; result.status === 'suddenDeath'; i++) {
      contenders = result.contenders;
      result = resolveSuddenDeathRound(contenders.map((id) => ({ id, year: rounds[i][id] })), truths[i]);
    }
    expect(result).toEqual({ status: 'winner', winnerId: 'a', decidedBy: 'suddenDeath' });
  });
  it('a single contender simply wins; zero is an error', () => {
    expect(resolveSuddenDeathRound([{ id: 'a', year: null }], 1990)).toMatchObject({ status: 'winner', winnerId: 'a' });
    expect(() => resolveSuddenDeathRound([], 1990)).toThrow();
  });
});
