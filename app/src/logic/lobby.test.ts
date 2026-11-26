import { describe, expect, it } from 'vitest';
import { CONFIG, checkCanStart, cleanRoomCode, normalizeSettings, stepSetting } from './index';

describe('lobby settings', () => {
  it('fills defaults from CONFIG', () => {
    expect(normalizeSettings({})).toEqual({
      targetCards: CONFIG.timeline.targetCards, rounds: CONFIG.closestYear.rounds, roundSeconds: CONFIG.roundSeconds,
    });
    expect(normalizeSettings(null).rounds).toBe(CONFIG.closestYear.rounds);
  });
  it('clamps and rounds out-of-range or junk values', () => {
    const s = normalizeSettings({ targetCards: 999, rounds: -4, roundSeconds: 'x' });
    expect(s.targetCards).toBe(CONFIG.lobby.targetCards.max);
    expect(s.rounds).toBe(CONFIG.lobby.rounds.min);
    expect(s.roundSeconds).toBe(CONFIG.roundSeconds);
    expect(normalizeSettings({ rounds: 12.6 }).rounds).toBe(13);
  });
  it('steps within the range and stops at the ends', () => {
    expect(stepSetting('targetCards', 12, 1)).toBe(13);
    expect(stepSetting('targetCards', CONFIG.lobby.targetCards.max, 1)).toBe(CONFIG.lobby.targetCards.max);
    expect(stepSetting('rounds', CONFIG.lobby.rounds.min, -1)).toBe(CONFIG.lobby.rounds.min);
    expect(stepSetting('roundSeconds', 40, 1)).toBe(45);
  });
});

describe('start check', () => {
  it('counts only connected players', () => {
    expect(checkCanStart([])).toEqual({ ok: false, reason: 'Waiting for 2 more players' });
    expect(checkCanStart([{ connected: true }, { connected: false }])).toEqual({ ok: false, reason: 'Waiting for 1 more player' });
    expect(checkCanStart([{ connected: true }, { connected: true }])).toEqual({ ok: true });
  });
});

describe('room code typing', () => {
  it('upper-cases, drops non-letters and limits the length', () => {
    expect(cleanRoomCode(' ab-c1d ef')).toBe('ABCD');
    expect(cleanRoomCode('')).toBe('');
  });
});
