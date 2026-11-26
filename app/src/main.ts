import './ui/style.css';
import { browserKV, createSupabaseBackend } from './net';
import { supabase } from './supabase';
import { mountHost } from './ui/host';
import { mountPhone } from './ui/phone';
import { parseRoute } from './ui/route';
import { watchForNewVersion } from './ui/staleApp';

const root = document.getElementById('app')!;
const backend = createSupabaseBackend(supabase);
const kv = browserKV();

let current: { stop(): Promise<void> } | null = null;

async function route() {
  const old = current; current = null;
  if (old) await old.stop();
  const r = parseRoute(location.hash);
  // The host page and the phone page keep separate storage keys, so one browser can try both without clashing.
  current = r.page === 'host'
    ? await mountHost(root, { backend, kv, pageUrl: () => location.href })
    : await mountPhone(root, { backend, kv, initialCode: r.code });
}

window.addEventListener('hashchange', () => { void route(); });
void route();

// A tab left open keeps old code; pick up a new deploy on its own.
watchForNewVersion({ everySeconds: 120 });
