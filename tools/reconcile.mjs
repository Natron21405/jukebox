#!/usr/bin/env node
// Compares curator year with verifier A and B. Counts only. Writes dispute chunks for deep research.
import path from 'node:path';
import { DECADES, DISPUTE_CHUNK_SIZE } from './config.mjs';
import { readJson, writeJson, listJson } from './lib.mjs';
const cand = {}; for (const d of DECADES) for (const s of readJson(`data/work/candidates/${d.key}.json`, [])) cand[s.id] = s;
const chunks = listJson('data/work/chunks');
const A = {}; const B = {}; let missing = 0;
for (const c of chunks) {
  const ids = readJson(`data/work/chunks/${c}`, []).map((s) => s.id);
  for (const [R, store] of [['A', A], ['B', B]]) {
    const rows = readJson(`data/work/verify${R}/${c}`, null);
    if (!rows) { missing += ids.length; continue; }
    for (const r of rows) store[r.id] = r;
    for (const id of ids) if (!store[id] || !Number.isInteger(store[id].year)) missing++;
  }
}
if (missing) { console.log(`reconcile: ${missing} verifier answer(s) still missing; finish the verify steps first`); process.exit(1); }
const agreed = {}; const disputed = []; let unanimous = 0; let majority = 0; let verifiersOverrode = 0;
for (const id of Object.keys(cand)) {
  const c = cand[id].year; const a = A[id]; const b = B[id]; if (!a || !b) continue;
  if (a.year === b.year && !(a.confidence === 'low' && b.confidence === 'low')) {
    agreed[id] = { year: a.year, how: a.year === c ? 'unanimous' : 'verifiers-over-curator' };
    a.year === c ? unanimous++ : verifiersOverrode++;
  } else if (c === a.year && b.confidence !== 'high') { agreed[id] = { year: c, how: 'majority' }; majority++; }
  else if (c === b.year && a.confidence !== 'high') { agreed[id] = { year: c, how: 'majority' }; majority++; }
  else disputed.push(id);
}
writeJson('data/work/reconciled.json', { agreed, disputed });
const idxPath = 'data/work/dispute-chunks/_index.json'; const index = readJson(idxPath, {});
const fresh = disputed.filter((id) => !index[id]); let n = listJson('data/work/dispute-chunks').length; let made = 0;
for (let i = 0; i < fresh.length; i += DISPUTE_CHUNK_SIZE) {
  n++; const name = `d-${String(n).padStart(3, '0')}`;
  const items = fresh.slice(i, i + DISPUTE_CHUNK_SIZE).map((id) => ({ id, title: cand[id].title, artists: cand[id].artists, featuredArtists: cand[id].featuredArtists || [],
    years: { curator: cand[id].year, A: A[id].year, B: B[id].year }, confidence: { A: A[id].confidence, B: B[id].confidence }, evidence: { curator: cand[id].yearNote || '', A: A[id].evidence || '', B: B[id].evidence || '' } }));
  writeJson(path.join('data/work/dispute-chunks', name + '.json'), items); items.forEach((s) => (index[s.id] = name)); made++;
}
writeJson(idxPath, index);
console.log(`reconcile: ${Object.keys(agreed).length} agreed (${unanimous} unanimous, ${majority} majority, ${verifiersOverrode} where both verifiers overrode the curator), ${disputed.length} disputed; ${made} new dispute chunk(s)`);
