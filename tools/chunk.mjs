#!/usr/bin/env node
// Splits curated candidates into BLIND chunks (no years, no notes) for the verifier agents. Idempotent.
import path from 'node:path';
import { DECADES, CHUNK_SIZE } from './config.mjs';
import { readJson, writeJson, listJson } from './lib.mjs';
const cdir = 'data/work/candidates'; const out = 'data/work/chunks'; const idxPath = path.join(out, '_index.json');
const index = readJson(idxPath, {});
let made = 0; let songs = 0;
for (const d of DECADES) {
  const list = readJson(path.join(cdir, d.key + '.json'), null); if (!list) continue;
  const fresh = list.filter((s) => !index[s.id]);
  let n = listJson(out).filter((f) => f.startsWith(d.key + '-')).length;
  for (let i = 0; i < fresh.length; i += CHUNK_SIZE) {
    n++; const name = `${d.key}-${String(n).padStart(2, '0')}`;
    const items = fresh.slice(i, i + CHUNK_SIZE).map((s) => ({ id: s.id, title: s.title, artists: s.artists, featuredArtists: s.featuredArtists || [] }));
    writeJson(path.join(out, name + '.json'), items); items.forEach((s) => (index[s.id] = name)); made++; songs += items.length;
  }
}
writeJson(idxPath, index);
console.log(`chunks: created ${made} new chunk file(s) with ${songs} song(s); total chunks ${listJson(out).length}`);
