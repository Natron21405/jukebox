#!/usr/bin/env node
// Bot simulation against the real Supabase project: a host plus 12 bot phones play a full game in each mode, with
// refreshes, rejoins, a duplicate-name attempt and host refreshes. Prints counts and timings only (never song details).
//
//   node tools/simulate.mjs                       both modes, 12 bots
//   node tools/simulate.mjs --modes timeline      one mode
//   node tools/simulate.mjs --bots 10 --rounds 8 --target 6 --seconds 15
//
// The game code itself (app/src) is run through vite-node, so the simulation uses the same net and game layers as the
// real screens, just without a browser. Throwaway rooms are deleted at the end (and on Ctrl-C).
import { spawn } from 'node:child_process';
import path from 'node:path';
import { loadEnv } from './env.mjs';
import { ROOT } from './lib.mjs';

const env = loadEnv();
for (const k of ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY']) {
  if (!env[k]) { console.error(`missing ${k} in .env`); process.exit(1); }
}

const bin = path.join(ROOT, 'app', 'node_modules', '.bin', 'vite-node');
const script = path.join(ROOT, 'tools', 'simulate-run.ts');
const child = spawn(bin, [script, '--', ...process.argv.slice(2)], {
  cwd: path.join(ROOT, 'app'),
  stdio: 'inherit',
  env: { ...process.env, SIM_URL: env.SUPABASE_URL, SIM_KEY: env.SUPABASE_PUBLISHABLE_KEY, SIM_ROOT: ROOT },
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
child.on('exit', (code) => process.exit(code ?? 1));
