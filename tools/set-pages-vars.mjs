#!/usr/bin/env node
// Sets the two GitHub repository variables the Pages build needs, from the root .env.
// Only the Supabase URL and publishable key are sent; the database URL never is. Prints no values.
import { spawnSync } from 'node:child_process';
import { loadEnv } from './env.mjs';

const env = loadEnv();
const pairs = { VITE_SUPABASE_URL: env.SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY: env.SUPABASE_PUBLISHABLE_KEY };
for (const [name, value] of Object.entries(pairs)) {
  if (!value) { console.error(`${name}: source value missing in .env`); process.exit(1); }
  const r = spawnSync('gh', ['variable', 'set', name, '--body', value], { stdio: ['ignore', 'ignore', 'inherit'] });
  if (r.status !== 0) { console.error(`${name}: gh failed`); process.exit(1); }
  console.log(`set ${name}`);
}
