#!/usr/bin/env node
// Validates curator output. Prints COUNTS and opaque ids only (never titles/artists/years).
//   node tools/check-candidates.mjs --merge 1980s        merge data/work/candidates/parts/1980s-*.json -> candidates/1980s.json
//   node tools/check-candidates.mjs 1980s [--multiplier 2]   check one decade
//   node tools/check-candidates.mjs --all [--multiplier 2]   check everything
import fs from 'node:fs';
import path from 'node:path';
import { DECADES, EXTRA_FRACTION, ARTIST_CAP } from './config.mjs';
import { readJson, writeJson, norm } from './lib.mjs';

const args = process.argv.slice(2);
const mult = +(args[args.indexOf('--multiplier') + 1] || 1) || 1;
const dir = 'data/work/candidates';
const mergeI = args.indexOf('--merge');
if (mergeI >= 0) {
  const key = args[mergeI + 1];
  const pdir = path.join(dir, 'parts');
  const parts = fs.existsSync(pdir) ? fs.readdirSync(pdir).filter((f) => f.startsWith(key + '-') && f.endsWith('.json')).sort() : [];
  if (!parts.length) { console.error(`no parts found for ${key} in ${pdir}`); process.exit(1); }
  const seen = new Set(); const all = [];
  for (const f of parts) for (const s of readJson(path.join(pdir, f), [])) if (s && !seen.has(s.id)) { seen.add(s.id); all.push(s); }
  writeJson(path.join(dir, key + '.json'), all);
  console.log(`merged ${parts.length} parts -> ${all.length} songs for ${key}`);
  process.exit(0);
}

const wantAll = args.includes('--all');
const only = args.find((a) => /^\d{4}s$/.test(a));
const decades = wantAll ? DECADES : DECADES.filter((d) => d.key === only);
if (!decades.length) { console.error('usage: check-candidates.mjs <decade>|--all|--merge <decade>'); process.exit(2); }

const errors = []; const ids = new Set(); const dupKey = new Map(); const artistCount = new Map();
const loadAll = DECADES.map((d) => [d, readJson(path.join(dir, d.key + '.json'), null)]);
for (const [d, list] of loadAll) {
  if (!list) { if (wantAll || d.key === only) errors.push(`${d.key}: file missing`); continue; }
  for (const s of list) {
    if (ids.has(s.id)) errors.push(`duplicate id ${s.id}`); ids.add(s.id);
    const k = norm(s.title) + '|' + norm((s.artists || [])[0]);
    if (dupKey.has(k)) errors.push(`duplicate song ${s.id} (same as ${dupKey.get(k)})`); else dupKey.set(k, s.id);
    const a = norm((s.artists || [])[0]);
    artistCount.set(a, [...(artistCount.get(a) || []), s.id]);
  }
}
for (const d of decades) {
  const list = readJson(path.join(dir, d.key + '.json'), null); if (!list) continue;
  const target = Math.round(d.target * mult); const wantExtra = Math.ceil(target * EXTRA_FRACTION);
  let base = 0; let extra = 0;
  for (const s of list) {
    const bad = [];
    if (!/^\d{4}s-\d{3,4}$/.test(s.id || '')) bad.push('id must look like 1980s-001');
    if (!s.title || typeof s.title !== 'string') bad.push('title');
    if (!Array.isArray(s.artists) || !s.artists.length || s.artists.some((x) => typeof x !== 'string' || !x.trim())) bad.push('artists');
    if (!Array.isArray(s.featuredArtists)) bad.push('featuredArtists (use [] if none)');
    if (!Number.isInteger(s.year) || s.year < d.start || s.year > d.end) bad.push('year outside decade');
    if (typeof s.extra !== 'boolean') bad.push('extra must be true/false');
    if (bad.length) errors.push(`${s.id}: ${bad.join(', ')}`);
    s.extra ? extra++ : base++;
  }
  console.log(`${d.key}: ${list.length} songs (${base} base, ${extra} extra); need ${target} base and about ${wantExtra} extra`);
  if (base !== target) errors.push(`${d.key}: base count ${base} must be exactly ${target}`);
  if (extra < Math.floor(wantExtra * 0.8)) errors.push(`${d.key}: only ${extra} extras, want about ${wantExtra}`);
}
for (const [, list] of artistCount) if (list.length > ARTIST_CAP + 2) errors.push(`artist cap exceeded by ids: ${list.slice(ARTIST_CAP).join(', ')}`);
if (errors.length) { console.log(`\n${errors.length} problem(s):`); errors.slice(0, 60).forEach((e) => console.log(' - ' + e)); if (errors.length > 60) console.log(` ... and ${errors.length - 60} more`); process.exit(1); }
console.log('candidates OK');
