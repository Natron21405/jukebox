// Tiny .env loader shared by tools/*.mjs. Handles trailing "# comments" from .env.example.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './lib.mjs';

export function loadEnv() {
  const env = { ...process.env };
  try {
    for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      let v = m[2].replace(/\s+#.*$/, '');
      v = v.replace(/^(['"])(.*)\1$/, '$2');
      if (v) env[m[1]] = v;
    }
  } catch { /* no .env */ }
  return env;
}
