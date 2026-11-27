/** Decades the host can include or leave out of a game. Stored in the room settings as a list of decade start years. */
export const ALL_DECADES: readonly number[] = [1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020];

export const decadeOf = (year: number): number => Math.floor(year / 10) * 10;

export const decadeLabel = (decade: number): string => `${decade}s`;

/** The decades chosen in a room's settings. Missing or unusable means every decade; the list is never empty. */
export function chosenDecades(settings: Record<string, unknown> | null | undefined): number[] {
  const raw = settings?.decades;
  if (!Array.isArray(raw)) return [...ALL_DECADES];
  const ok = ALL_DECADES.filter((d) => raw.includes(d));
  return ok.length > 0 ? ok : [...ALL_DECADES];
}

/** Turn one decade on or off. The last chosen decade cannot be turned off (a game needs songs from somewhere). */
export function toggleDecade(chosen: readonly number[], decade: number): number[] {
  if (!ALL_DECADES.includes(decade)) return [...chosen];
  if (!chosen.includes(decade)) return ALL_DECADES.filter((d) => d === decade || chosen.includes(d));
  if (chosen.length <= 1) return [...chosen];
  return chosen.filter((d) => d !== decade);
}

/** How many songs of a list fall in each decade (every known decade is present, possibly 0). */
export function countByDecade(songs: readonly { year: number }[]): Record<number, number> {
  const out: Record<number, number> = Object.fromEntries(ALL_DECADES.map((d) => [d, 0]));
  for (const s of songs) { const d = decadeOf(s.year); if (d in out) out[d]++; }
  return out;
}
