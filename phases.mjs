// The ordered phase list. Edit freely; ids must stay stable once a phase has run.
import { DECADES, EXTRA_FRACTION } from './tools/config.mjs';

export function buildPhases(cfg) {
  const P = [];
  const mult = cfg.multiplier;
  P.push({ id: '00-preflight', type: 'shell', cmd: ['node', 'tools/preflight.mjs'], always: true });
  P.push({ id: '01-setup', type: 'agent', prompt: 'phases/01-setup.md' });
  P.push({ id: '02-logic', type: 'agent', prompt: 'phases/02-logic.md' });

  // Song pipeline: curate per decade (8 small sessions), then blind verification in chunks.
  for (const d of DECADES) {
    const target = Math.round(d.target * mult);
    P.push({
      id: `03-curate-${d.key}`, type: 'agent', prompt: 'phases/03-curate.md',
      vars: { DECADE: d.key, START: d.start, END: d.end, TARGET: target, REQUEST: Math.ceil(target * (1 + EXTRA_FRACTION)) },
    });
  }
  P.push({ id: '03-check', type: 'shell', cmd: ['node', 'tools/check-candidates.mjs', '--all', '--multiplier', String(mult)], always: true });
  P.push({ id: '04-chunk', type: 'shell', cmd: ['node', 'tools/chunk.mjs'], always: true });
  P.push({
    id: '04-verifyA', type: 'foreach', glob: 'data/work/chunks/*.json', prompt: 'phases/04-verify.md',
    vars: { ROLE: 'A' }, model: cfg.modelA,
    deny: ['Read(./data/work/candidates/**)', 'Read(./data/work/verifyB/**)', 'Read(./data/work/reconciled.json)'],
  });
  P.push({
    id: '04-verifyB', type: 'foreach', glob: 'data/work/chunks/*.json', prompt: 'phases/04-verify.md',
    vars: { ROLE: 'B' }, model: cfg.modelB,
    deny: ['Read(./data/work/candidates/**)', 'Read(./data/work/verifyA/**)', 'Read(./data/work/reconciled.json)'],
  });
  P.push({ id: '05-reconcile', type: 'shell', cmd: ['node', 'tools/reconcile.mjs'], always: true });
  P.push({ id: '05-resolve', type: 'foreach', glob: 'data/work/dispute-chunks/*.json', prompt: 'phases/05-resolve.md' });
  P.push({ id: '06-assemble', type: 'shell', cmd: ['node', 'tools/assemble.mjs', '--multiplier', String(mult)], always: true });

  // Previews from Apple (runs on Nathan's machine; throttled and resumable).
  P.push({ id: '07a-previews-script', type: 'agent', prompt: 'phases/07a-previews-script.md' });
  P.push({ id: '07b-previews-run', type: 'shell', cmd: ['node', 'tools/resolve-previews.mjs'], timeoutMin: 600 });
  P.push({ id: '07c-previews-finalize', type: 'agent', prompt: 'phases/07c-previews-finalize.md' });

  // The game itself.
  P.push({ id: '08a-supabase-core', type: 'agent', prompt: 'phases/08a-supabase-core.md' });
  P.push({ id: '08b-lobby-ui', type: 'agent', prompt: 'phases/08b-lobby-ui.md' });
  P.push({ id: '09a-closest-year-flow', type: 'agent', prompt: 'phases/09a-closest-year-flow.md' });
  P.push({ id: '09b-closest-year-ui', type: 'agent', prompt: 'phases/09b-closest-year-ui.md' });
  P.push({ id: '10a-timeline-flow', type: 'agent', prompt: 'phases/10a-timeline-flow.md' });
  P.push({ id: '10b-timeline-ui', type: 'agent', prompt: 'phases/10b-timeline-ui.md' });
  P.push({ id: '11-blocklist-history', type: 'agent', prompt: 'phases/11-blocklist-history.md' });
  P.push({ id: '12-simulation', type: 'agent', prompt: 'phases/12-simulation.md' });
  P.push({ id: '13-deploy', type: 'agent', prompt: 'phases/13-deploy.md' });
  return P;
}
