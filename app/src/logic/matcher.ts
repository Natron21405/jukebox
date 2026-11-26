import { CONFIG } from './config';

/** What the matcher needs from a song. featuredArtists is accepted but deliberately never used. */
export interface ArtistInfo {
  artists: readonly string[];
  artistAliases?: readonly string[];
  /** Main artists that are bands/duos (surname rule off). "The ..." names and names containing "and" are always treated as groups. */
  groupArtists?: readonly string[];
  featuredArtists?: readonly string[];
}

export type MatchKind = 'exact' | 'typo' | 'alias' | 'surname';
export interface MatchResult {
  matched: boolean;
  kind: MatchKind | null;
}

const NO: MatchResult = { matched: false, kind: null };

/** Lowercase, strip accents and punctuation, "&" = "and", drop a leading "the", collapse spaces. */
export function normalizeName(input: string): string {
  const s = input
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  return s.replace(/^the (?=.)/, '');
}

const compact = (s: string) => s.replace(/ /g, '');

/** Optimal string alignment distance (insert, delete, substitute, adjacent swap each cost 1). */
export function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[m][n];
}

export function allowedEdits(targetCompactLength: number): number {
  let edits = 0;
  for (const row of CONFIG.matcher.editsByLength) {
    if (targetCompactLength >= row.minLength) edits = row.maxEdits;
  }
  return edits;
}

/** Compare two normalised names. Spaces are ignored, so "jay z" equals "jayz". */
function compareNames(guess: string, target: string): 'exact' | 'typo' | null {
  const g = compact(guess);
  const t = compact(target);
  if (!g || !t) return null;
  if (g === t) return 'exact';
  // Giving only part of a multi-word name ("lil nas" for "Lil Nas X") is not a typo.
  const gw = guess.split(' ');
  const tw = target.split(' ');
  if (gw.length < tw.length && gw.every((w) => tw.includes(w))) return null;
  const max = allowedEdits(t.length);
  if (max > 0 && Math.abs(g.length - t.length) <= max && editDistance(g, t) <= max) return 'typo';
  return null;
}

function isGroup(rawName: string, info: ArtistInfo): boolean {
  if (/^\s*the\s/i.test(rawName)) return true;
  const norm = normalizeName(rawName);
  if (norm.split(' ').includes('and')) return true;
  return (info.groupArtists ?? []).some((g) => normalizeName(g) === norm);
}

function surnameOf(rawName: string, info: ArtistInfo): string | null {
  if (isGroup(rawName, info)) return null;
  const words = normalizeName(rawName).split(' ');
  if (words.length < 2) return null;
  const last = words[words.length - 1];
  return last.length >= CONFIG.matcher.minSurnameLength ? last : null;
}

/** Does the typed guess count as one of the song's main artists? Featured artists never count. */
export function matchArtist(guess: string, info: ArtistInfo): MatchResult {
  const g = normalizeName(guess);
  if (!g) return NO;

  const fullNames = info.artists.map(normalizeName).filter(Boolean);
  if (info.artists.length > 1) fullNames.push(normalizeName(info.artists.join(' and ')));
  for (const name of fullNames) {
    const r = compareNames(g, name);
    if (r) return { matched: true, kind: r };
  }

  for (const alias of info.artistAliases ?? []) {
    if (compareNames(g, normalizeName(alias))) return { matched: true, kind: 'alias' };
  }

  if (!g.includes(' ')) {
    for (const artist of info.artists) {
      const surname = surnameOf(artist, info);
      if (surname && compareNames(g, surname)) return { matched: true, kind: 'surname' };
    }
  }
  return NO;
}

export function isArtistMatch(guess: string, info: ArtistInfo): boolean {
  return matchArtist(guess, info).matched;
}
