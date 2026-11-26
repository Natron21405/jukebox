import fs from 'node:fs';
import path from 'node:path';
export const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
export const STATE = path.join(ROOT, '.build', 'state');
export const safeId = (id) => id.replace(/[^A-Za-z0-9._-]+/g, '__');
export const readJson = (p, fallback) => {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
};
export const writeJson = (p, obj) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 1));
};
export const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/\b(the)\b/g, ' ').replace(/\s+/g, ' ').trim();
export const listJson = (dir) => {
  try { return fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('_')).sort(); } catch { return []; }
};
