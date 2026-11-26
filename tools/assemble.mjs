#!/usr/bin/env node
// Builds the final song list (without previews) from agreed + resolved years. Counts only on screen.
import { DECADES, decadeOf } from './config.mjs';
import { readJson, writeJson, listJson } from './lib.mjs';
const args = process.argv.slice(2); const mult = +(args[args.indexOf('--multiplier') + 1] || 1) || 1;
const cand = {}; for (const d of DECADES) for (const s of readJson(`data/work/candidates/${d.key}.json`, [])) cand[s.id] = s;
const rec = readJson('data/work/reconciled.json', null);
if (!rec) { console.log('assemble: run reconcile first'); process.exit(1); }
const resolved = {}; for (const f of listJson('data/work/resolved')) for (const r of readJson(`data/work/resolved/${f}`, [])) resolved[r.id] = r;
const final = {}; let pending = 0; let dropped = 0; let resolvedCount = 0; let moved = 0; const audit = {};
for (const [id, v] of Object.entries(rec.agreed)) { final[id] = v.year; audit[id] = { how: v.how, curator: cand[id]?.year }; }
for (const id of rec.disputed) {
  const r = resolved[id];
  if (!r) { pending++; continue; }
  if (!Number.isInteger(r.year)) { dropped++; audit[id] = { how: 'dropped-unresolved', evidence: r.evidence }; continue; }
  final[id] = r.year; resolvedCount++; audit[id] = { how: 'resolved', curator: cand[id]?.year, evidence: r.evidence };
}
if (pending) { console.log(`assemble: ${pending} disputed song(s) have no resolution yet; run the resolve step`); process.exit(1); }
const by = Object.fromEntries(DECADES.map((d) => [d.key, []]));
for (const [id, y] of Object.entries(final)) { const d = decadeOf(y); if (!d) { dropped++; continue; } if (y !== cand[id].year) moved++; by[d.key].push(id); }
const out = []; let short = 0; let worst = 1;
for (const d of DECADES) {
  const target = Math.round(d.target * mult);
  const ranked = by[d.key].sort((x, y) => (cand[x].extra ? 1 : 0) - (cand[y].extra ? 1 : 0) || x.localeCompare(y));
  for (const id of ranked) { const s = cand[id]; out.push({ id, title: s.title, artists: s.artists, featuredArtists: s.featuredArtists || [], artistAliases: s.artistAliases || [], year: final[id], extra: !!s.extra, decade: d.key }); }
  const baseOk = ranked.filter((id) => !cand[id].extra).length; console.log(`${d.key}: ${ranked.length} verified (${baseOk} base) for target ${target}`); if (ranked.length < target) short += target - ranked.length; worst = Math.min(worst, ranked.length / target);
}
writeJson('data/work/songs.nopreview.json', out); writeJson('data/work/audit.json', audit);
console.log(`assemble: ${out.length} songs verified; ${resolvedCount} resolved after dispute; ${dropped} dropped as unresolvable; ${moved} moved to a different decade; shortfall ${short}`);
if (worst < 0.9) { console.log('assemble: a decade is below 90% of target; run a top-up (see README) before continuing'); process.exit(2); }
