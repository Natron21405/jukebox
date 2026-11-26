import { describe, expect, it } from 'vitest';
import { CONFIG } from './config';
import { decideJoin, type Seat } from './names';

const seats: Seat[] = [
  { id: '1', name: 'Alex', connected: true },
  { id: '2', name: 'Sam Lee', connected: false },
];

describe('joining by name', () => {
  it('new name joins', () => expect(decideJoin(seats, 'Jo')).toEqual({ kind: 'new' }));
  it('a connected player\'s name is rejected, ignoring case and spacing', () => {
    expect(decideJoin(seats, ' alex ')).toEqual({ kind: 'rejected', reason: 'taken' });
  });
  it('a disconnected seat is taken back', () => {
    expect(decideJoin(seats, 'sam  LEE')).toEqual({ kind: 'reclaim', seatId: '2' });
  });
  it('empty and over-long names are rejected', () => {
    expect(decideJoin(seats, '   ')).toEqual({ kind: 'rejected', reason: 'empty' });
    expect(decideJoin(seats, 'x'.repeat(CONFIG.maxNameLength + 1))).toEqual({ kind: 'rejected', reason: 'too-long' });
  });
  it('a full room rejects new names but still lets a disconnected player back in', () => {
    const full: Seat[] = Array.from({ length: CONFIG.maxPlayers }, (_, i) => ({ id: `${i}`, name: `P${i}`, connected: i !== 3 }));
    expect(decideJoin(full, 'Newbie')).toEqual({ kind: 'rejected', reason: 'full' });
    expect(decideJoin(full, 'p3')).toEqual({ kind: 'reclaim', seatId: '3' });
  });
});
