#!/usr/bin/env node
// Applies supabase/migrations/*.sql in order using SUPABASE_DB_URL (no psql / supabase CLI needed).
// Tracks versions in supabase_migrations.schema_migrations (same table the Supabase CLI uses).
//   node tools/apply-migrations.mjs            apply anything new
//   node tools/apply-migrations.mjs --verify   also print RLS / policy / function counts, exit 1 if a public table lacks RLS
// Prints counts only, never connection details.
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { loadEnv } from './env.mjs';
import { ROOT } from './lib.mjs';

const env = loadEnv();
if (!env.SUPABASE_DB_URL) { console.error('missing SUPABASE_DB_URL in .env'); process.exit(1); }
const dir = path.join(ROOT, 'supabase', 'migrations');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

const c = new pg.Client({ connectionString: env.SUPABASE_DB_URL });
await c.connect();
let applied = 0, skipped = 0, exitCode = 0;
try {
  await c.query('create schema if not exists supabase_migrations');
  await c.query('create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text)');
  const done = new Set((await c.query('select version from supabase_migrations.schema_migrations')).rows.map((r) => r.version));
  for (const f of files) {
    const [version, ...rest] = f.replace(/\.sql$/, '').split('_');
    if (done.has(version)) { skipped++; continue; }
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    try {
      await c.query('begin');
      await c.query(sql);
      await c.query('insert into supabase_migrations.schema_migrations (version, name, statements) values ($1, $2, $3)', [version, rest.join('_'), [sql]]);
      await c.query('commit');
      applied++;
    } catch (e) {
      await c.query('rollback');
      console.error(`migration ${f} failed: ${e.message}`);
      process.exit(1);
    }
  }
  console.log(`migrations: ${applied} applied, ${skipped} already applied, ${files.length} total`);

  if (process.argv.includes('--verify')) {
    const q = async (sql) => (await c.query(sql)).rows[0];
    const t = await q(`select count(*)::int n, count(*) filter (where c.relrowsecurity)::int rls
      from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'`);
    const pol = await q(`select count(*)::int n from pg_policies where schemaname = 'public'`);
    const fn = await q(`select count(*)::int n, count(*) filter (where p.prosecdef)::int secdef
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`);
    const anonWrite = await q(`select count(*)::int n from information_schema.role_table_grants
      where table_schema = 'public' and grantee = 'anon' and privilege_type <> 'SELECT'`);
    const anonSelect = await q(`select count(*)::int n from information_schema.role_table_grants
      where table_schema = 'public' and grantee = 'anon' and privilege_type = 'SELECT'`);
    const rt = await q(`select count(*)::int n from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'`);
    console.log(`public tables: ${t.n}, with RLS enabled: ${t.rls}`);
    console.log(`policies: ${pol.n}; functions: ${fn.n} (${fn.secdef} security definer)`);
    console.log(`anon table grants: ${anonSelect.n} select, ${anonWrite.n} non-select; realtime tables: ${rt.n}`);
    if (t.n !== t.rls || anonWrite.n !== 0) { console.error('FAIL: RLS or grants not as expected'); exitCode = 1; }
  }
} finally {
  await c.end();
}
process.exit(exitCode);
