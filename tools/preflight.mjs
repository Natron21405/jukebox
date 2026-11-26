#!/usr/bin/env node
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const ok = (m) => console.log('  ok   ' + m); const warn = (m) => console.log('  WARN ' + m); const bad = (m) => { console.log('  FAIL ' + m); failed = true; };
let failed = false;
console.log('Preflight');
const major = +process.versions.node.split('.')[0]; major >= 18 ? ok(`node ${process.versions.node}`) : bad('Node 18 or newer is required');
const run = (c, a) => spawnSync(c, a, { encoding: 'utf8' });
run('git', ['--version']).status === 0 ? ok('git') : bad('git is not installed');
if (!fs.existsSync('.git')) { run('git', ['init']); ok('initialised a git repository here'); }
const claude = process.env.CLAUDE_BIN || 'claude';
run(claude, ['--version']).status === 0 ? ok('claude CLI') : bad(`'${claude}' not found. Install Claude Code and sign in first`);
const gh = run('gh', ['auth', 'status']); gh.status === 0 ? ok('GitHub CLI signed in') : warn('GitHub CLI missing or not signed in (gh auth login). Needed to create the repo and Pages; step 01 will stop and ask if absent');
const env = {}; try { for (const l of fs.readFileSync('.env', 'utf8').split('\n')) { const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/); if (m) env[m[1]] = m[2]; } } catch { /* none */ }
for (const k of ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_DB_URL']) env[k] || process.env[k] ? ok(`.env has ${k}`) : warn(`.env is missing ${k} (copy .env.example to .env and fill it in; step 01 stops without it)`);
if (!process.env.PREFLIGHT_OFFLINE) {
  try { const r = await fetch('https://itunes.apple.com/search?term=test&entity=song&limit=1'); r.ok ? ok('Apple iTunes Search API reachable') : warn(`iTunes API answered ${r.status}`); }
  catch { warn('Apple iTunes Search API is not reachable from this machine; the preview step needs it'); }
}
if (failed) { console.log('\nFix the FAIL items and run again.'); process.exit(1); }
