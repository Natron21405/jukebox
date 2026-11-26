import { CONFIG, defaultYearMax } from './config';

export interface YearRange { min: number; max: number }

/**
 * The picker's year range: the host's year-range setting when it is set (settings.yearMin / yearMax), otherwise the
 * whole song range. Always at least two years wide, so the slider can move.
 */
export function yearRangeOf(settings: Record<string, unknown> | null | undefined, now: Date = new Date()): YearRange {
  const s = settings ?? {};
  const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback);
  const min = num(s.yearMin, CONFIG.songYearMin);
  const max = num(s.yearMax, defaultYearMax(now));
  return max > min ? { min, max } : { min, max: min + 1 };
}

export function clampYear(year: number, r: YearRange): number {
  if (!Number.isFinite(year)) return startYear(r);
  return Math.min(r.max, Math.max(r.min, Math.round(year)));
}

/** One step (or several) up or down, stopping at the ends of the range. */
export function stepYear(year: number, delta: number, r: YearRange): number {
  return clampYear(clampYear(year, r) + delta, r);
}

/**
 * Where the picker starts. It never depends on the song: the last guess this player made if they have one, else the
 * middle of the range (the same for every song, so the start position gives nothing away).
 */
export function startYear(r: YearRange, lastGuess?: number | null): number {
  if (typeof lastGuess === 'number' && Number.isFinite(lastGuess)) return clampYear(lastGuess, r);
  return Math.round((r.min + r.max) / 2);
}

/** Tick label years for the slider: multiples of 10 (or 5 on a short range) inside the range. */
export function tickYears(r: YearRange): number[] {
  const step = r.max - r.min <= CONFIG.yearPicker.shortRangeYears ? 5 : 10;
  const out: number[] = [];
  for (let y = Math.ceil(r.min / step) * step; y <= r.max; y += step) out.push(y);
  return out;
}

export interface DecadeChip { label: string; year: number; decade: number }

/** One chip per decade that touches the range. A chip jumps to the middle of its decade, kept inside the range. */
export function decadeChips(r: YearRange): DecadeChip[] {
  const out: DecadeChip[] = [];
  for (let d = Math.floor(r.min / 10) * 10; d <= r.max; d += 10) {
    const lo = Math.max(d, r.min);
    const hi = Math.min(d + 9, r.max);
    out.push({ label: `${String(d % 100).padStart(2, '0')}s`, decade: d, year: Math.round((lo + hi) / 2) });
  }
  return out;
}

/** Position of a year along the slider, 0 to 1. */
export function fraction(year: number, r: YearRange): number {
  return (clampYear(year, r) - r.min) / (r.max - r.min);
}

export interface HoldTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

/**
 * Press-and-hold: `start()` fires once at once, then after holdDelayMs repeats until `stop()`; the repeat speeds up
 * after holdFastAfter repeats. `fire` may return false when it cannot go further (the end of the range), which
 * stops the hold. Timers are injected so tests do not need real time.
 */
export function createHold(fire: () => boolean | void, timers: HoldTimers = globalThis as unknown as HoldTimers) {
  const c = CONFIG.yearPicker;
  let id: unknown = null;
  let repeats = 0;
  const stop = () => { if (id !== null) timers.clearTimeout(id); id = null; };
  const loop = () => {
    if (fire() === false) { id = null; return; }
    repeats++;
    id = timers.setTimeout(loop, repeats >= c.holdFastAfter ? c.holdFastRepeatMs : c.holdRepeatMs);
  };
  return {
    start() {
      stop(); repeats = 0;
      if (fire() === false) return;
      id = timers.setTimeout(loop, c.holdDelayMs);
    },
    stop,
    get active() { return id !== null; },
  };
}
