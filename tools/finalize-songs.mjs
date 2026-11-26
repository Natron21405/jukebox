#!/usr/bin/env node
// Join songs with previews and write app/public/songs.json. Prints counts only.
// Usage: node tools/finalize-songs.mjs [--input F] [--previews F] [--output F]
// SONG_MULTIPLIER (env, default 1) scales the per-decade targets from tools/config.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib.mjs';
import { DECADES } from './config.mjs';

export const SHORT_TOLERANCE = 0.03;

/** Pure: returns { songs, perDecade: [{key,target,got,short}] }. */
export function finalize(songs, previews, multiplier = 1) {
  const out = [];
  const perDecade = [];
  for (const d of DECADES) {
    const target = Math.round(d.target * multiplier);
    const withPreview = songs.filter((s) => {
      const p = previews[s.id];
      return s.decade === d.key && p && !p.failed && p.previewUrl;
    });
    const ordered = [...withPreview.filter((s) => !s.extra), ...withPreview.filter((s) => s.extra)];
    const picked = ordered.slice(0, target);
    for (const s of picked) {
      out.push({
        id: s.id,
        title: s.title,
        artists: s.artists,
        featuredArtists: s.featuredArtists || [],
        artistAliases: s.artistAliases || [],
        year: s.year,
        previewUrl: previews[s.id].previewUrl,
      });
    }
    perDecade.push({ key: d.key, target, got: picked.length, short: Math.max(0, target - picked.length) });
  }
  return { songs: out, perDecade };
}

function arg(name, dflt) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : dflt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const input = arg('--input', path.join(ROOT, 'data/work/songs.nopreview.json'));
  const prev = arg('--previews', path.join(ROOT, 'data/work/previews.json'));
  const output = arg('--output', path.join(ROOT, 'app/public/songs.json'));
  const raw = JSON.parse(fs.readFileSync(input, 'utf8'));
  const songs = Array.isArray(raw) ? raw : raw.songs;
  const previews = JSON.parse(fs.readFileSync(prev, 'utf8'));
  const mult = +(process.env.SONG_MULTIPLIER || 1);
  const { songs: out, perDecade } = finalize(songs, previews, mult);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(out));
  for (const d of perDecade) console.log(`${d.key}: ${d.got} / ${d.target}${d.short ? ` (short ${d.short})` : ''}`);
  const target = perDecade.reduce((a, d) => a + d.target, 0);
  console.log(`total: ${out.length} / ${target}`);
  const bad = perDecade.filter((d) => d.short > d.target * SHORT_TOLERANCE);
  for (const d of bad) console.log(`Decade ${d.key} is short by ${d.short} songs`);
  process.exitCode = bad.length ? 2 : 0;
}
