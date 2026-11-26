import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

type FileSong = {
  id: string;
  title: string;
  artists: string[];
  featuredArtists: string[];
  artistAliases: string[];
  year: number;
  previewUrl: string;
};

const path = fileURLToPath(new URL('../public/songs.json', import.meta.url));
const songs: FileSong[] = JSON.parse(readFileSync(path, 'utf8'));

describe('app/public/songs.json', () => {
  it('has unique ids', () => {
    expect(songs.length).toBeGreaterThan(0);
    expect(new Set(songs.map((s) => s.id)).size).toBe(songs.length);
  });

  it('has integer years from 1950 to now', () => {
    const now = new Date().getFullYear();
    const bad = songs.filter((s) => !Number.isInteger(s.year) || s.year < 1950 || s.year > now);
    expect(bad.map((s) => s.id)).toEqual([]);
  });

  it('has a non-empty previewUrl, title and artists on every song', () => {
    const bad = songs.filter(
      (s) =>
        typeof s.previewUrl !== 'string' ||
        !/^https:\/\//.test(s.previewUrl) ||
        !s.title ||
        !Array.isArray(s.artists) ||
        s.artists.length === 0,
    );
    expect(bad.map((s) => s.id)).toEqual([]);
  });

  it('prints decade counts', () => {
    const counts: Record<string, number> = {};
    for (const s of songs) {
      const key = `${Math.floor(s.year / 10) * 10}s`;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    const line = Object.keys(counts)
      .sort()
      .map((k) => `${k}: ${counts[k]}`)
      .join(', ');
    console.log(`Song pool: ${songs.length} songs (${line})`);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(songs.length);
  });
});
