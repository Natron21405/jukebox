#!/usr/bin/env node
// Two Node clients join one Supabase Realtime broadcast channel and exchange a message each way.
// Also checks that a SQL statement can be run with SUPABASE_DB_URL (select 1). Prints no secrets.
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import { loadEnv } from './env.mjs';

const env = loadEnv();
for (const k of ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_DB_URL']) {
  if (!env[k]) { console.error(`missing ${k} in .env`); process.exit(1); }
}

const room = `smoke-${Date.now()}`;
const mk = () => createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, { realtime: { params: { eventsPerSecond: 10 } } });
const a = mk(), b = mk();

const subscribe = (client, name) => new Promise((resolve, reject) => {
  const ch = client.channel(room, { config: { broadcast: { self: false, ack: true } } });
  const inbox = [];
  const waiters = [];
  ch.on('broadcast', { event: 'msg' }, ({ payload }) => {
    inbox.push(payload);
    waiters.splice(0).forEach((w) => w());
  });
  const t = setTimeout(() => reject(new Error(`${name} subscribe timeout`)), 15000);
  ch.subscribe((status) => {
    if (status === 'SUBSCRIBED') { clearTimeout(t); resolve({ ch, inbox, waiters }); }
    else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { clearTimeout(t); reject(new Error(`${name} ${status}`)); }
  });
});
const nextMsg = (c, ms = 10000) => new Promise((resolve, reject) => {
  if (c.inbox.length) return resolve(c.inbox.shift());
  const t = setTimeout(() => reject(new Error('message timeout')), ms);
  c.waiters.push(() => { clearTimeout(t); resolve(c.inbox.shift()); });
});

let ok = 0, fail = 0;
const check = (name, cond) => { cond ? ok++ : fail++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`); };

try {
  const [ca, cb] = await Promise.all([subscribe(a, 'A'), subscribe(b, 'B')]);
  check('two clients subscribed to one channel', true);

  const t0 = Date.now();
  const gotB = nextMsg(cb);
  await ca.ch.send({ type: 'broadcast', event: 'msg', payload: { from: 'A', n: 1 } });
  const mB = await gotB;
  check(`A -> B delivered (${Date.now() - t0} ms)`, mB?.from === 'A' && mB?.n === 1);

  const t1 = Date.now();
  const gotA = nextMsg(ca);
  await cb.ch.send({ type: 'broadcast', event: 'msg', payload: { from: 'B', n: 2 } });
  const mA = await gotA;
  check(`B -> A delivered (${Date.now() - t1} ms)`, mA?.from === 'B' && mA?.n === 2);
} catch (e) {
  check(`realtime exchange (${e.message})`, false);
}
await a.removeAllChannels(); await b.removeAllChannels();

// Migration path: run a harmless statement through the direct database URL.
const client = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
try {
  await client.connect();
  const r = await client.query('select 1 as one');
  check('SUPABASE_DB_URL: select 1', r.rows[0].one === 1);
} catch (e) {
  check(`SUPABASE_DB_URL connect (${e.code || e.message.split('\n')[0].slice(0, 80)})`, false);
} finally { await client.end().catch(() => {}); }

console.log(`realtime+db smoke: ${ok} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
