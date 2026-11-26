import { CONFIG } from './config';

export type GameMode = 'timeline' | 'closest_year';

export interface LobbySettings {
  /** Timeline: first to this many cards wins. */
  targetCards: number;
  /** Closest Year: number of rounds. */
  rounds: number;
  roundSeconds: number;
}

export const MODE_LABELS: Record<GameMode, string> = { timeline: 'Timeline', closest_year: 'Closest Year' };

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function pick(raw: unknown, range: { min: number; max: number }, fallback: number): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.round(raw) : fallback;
  return clamp(n, range.min, range.max);
}

/** Room settings as stored are loose JSON: fill in defaults and clamp to what the lobby allows. */
export function normalizeSettings(raw: Record<string, unknown> | null | undefined): LobbySettings {
  const r = raw ?? {};
  const L = CONFIG.lobby;
  return {
    targetCards: pick(r.targetCards, L.targetCards, CONFIG.timeline.targetCards),
    rounds: pick(r.rounds, L.rounds, CONFIG.closestYear.rounds),
    roundSeconds: pick(r.roundSeconds, L.roundSeconds, CONFIG.roundSeconds),
  };
}

/** One step up or down for a setting, staying inside its allowed range. */
export function stepSetting(key: keyof LobbySettings, current: number, direction: 1 | -1): number {
  const range = CONFIG.lobby[key];
  return clamp(current + direction * range.step, range.min, range.max);
}

export type StartCheck = { ok: true } | { ok: false; reason: string };

/** The Start button is on once enough players are connected. Disconnected seats are kept but do not count. */
export function checkCanStart(players: ReadonlyArray<{ connected: boolean }>): StartCheck {
  const here = players.filter((p) => p.connected).length;
  const need = CONFIG.lobby.minPlayersToStart;
  if (here >= need) return { ok: true };
  return { ok: false, reason: need - here === 1 ? `Waiting for 1 more player` : `Waiting for ${need - here} more players` };
}

/** Typed room codes: letters only, upper case, at most the code length (spaces and digits are dropped). */
export function cleanRoomCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z]/g, '').slice(0, CONFIG.lobby.roomCodeLength);
}
