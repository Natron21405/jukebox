// Shared config for the driver and the tools.
export const YEAR_NOW = new Date().getFullYear();
export const DECADES = [
  { key: '1950s', start: 1950, end: 1959, target: 40 },
  { key: '1960s', start: 1960, end: 1969, target: 140 },
  { key: '1970s', start: 1970, end: 1979, target: 350 },
  { key: '1980s', start: 1980, end: 1989, target: 400 },
  { key: '1990s', start: 1990, end: 1999, target: 400 },
  { key: '2000s', start: 2000, end: 2009, target: 350 },
  { key: '2010s', start: 2010, end: 2019, target: 300 },
  { key: '2020s', start: 2020, end: YEAR_NOW, target: 70 },
];
export const EXTRA_FRACTION = 0.15;   // extra candidates asked of the curator
export const CHUNK_SIZE = 40;         // songs per verification chunk
export const DISPUTE_CHUNK_SIZE = 15; // songs per dispute-resolution chunk
export const ARTIST_CAP = 6;          // max songs per main artist in the base pool
export function decadeOf(year) {
  return DECADES.find((d) => year >= d.start && year <= d.end) || null;
}
