#!/usr/bin/env node
// Copies the Supabase URL and publishable key from the root .env into app/.env (VITE_ names).
// Never copies the database URL. Prints only whether each value was set.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib.mjs';
import { loadEnv } from './env.mjs';

const env = loadEnv();
const url = env.SUPABASE_URL, key = env.SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) { console.error('SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY missing in .env'); process.exit(1); }
fs.writeFileSync(path.join(ROOT, 'app', '.env'), `VITE_SUPABASE_URL=${url}\nVITE_SUPABASE_PUBLISHABLE_KEY=${key}\n`);
console.log('wrote app/.env (2 variables)');
