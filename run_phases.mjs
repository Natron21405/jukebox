#!/usr/bin/env node
// Phase driver: runs each phase in a fresh Claude Code session, moves on when the phase marks itself done.
//   node run_phases.mjs                run everything that is not done yet
//   node run_phases.mjs --status       show progress
//   node run_phases.mjs --dry-run      show what would run
//   node run_phases.mjs --only 04      only phases whose id starts with this
//   node run_phases.mjs --from 08a     start from the first phase whose id starts with this
//   node run_phases.mjs --reset 09a    clear done/blocked markers for phases starting with this
//   node run_phases.mjs --render 09a-closest-year-flow   write the prompt file and print its path (manual use)
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { ROOT, STATE, safeId, listJson } from './tools/lib.mjs';

process.chdir(ROOT);
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };

const cfg = {
  claude: process.env.CLAUDE_BIN || 'claude',
  parallel: +(process.env.PARALLEL || 3),
  attempts: +(process.env.MAX_ATTEMPTS || 3),
  maxTurns: +(process.env.MAX_TURNS || 200),
  timeoutMin: +(process.env.AGENT_TIMEOUT_MIN || 60),
  flags: process.env.CLAUDE_FLAGS ?? '--permission-mode acceptEdits --allowedTools Bash,Read,Write,Edit,Glob,Grep,WebSearch,WebFetch',
  multiplier: +(process.env.SONG_MULTIPLIER || 1),
  modelA: process.env.MODEL_A || '',
  modelB: process.env.MODEL_B || '',
  modelDefault: process.env.MODEL || '',
};
const phasesModule = process.env.PHASES_FILE ? path.resolve(process.env.PHASES_FILE) : path.join(ROOT, 'phases.mjs');
const { buildPhases } = await import(phasesModule);
let phases = buildPhases(cfg);

fs.mkdirSync(STATE, { recursive: true });
fs.mkdirSync('.build/prompts', { recursive: true });
fs.mkdirSync('.build/logs', { recursive: true });
if (!fs.existsSync('.build/NOTES.md')) fs.writeFileSync('.build/NOTES.md', '# Build notes (handoff between phases)\n\nKeep this file short. Newest information wins.\n\n');

const t = () => new Date().toTimeString().slice(0, 8);
const log = (...a) => console.log(`[${t()}]`, ...a);
const marker = (id, kind) => path.join(STATE, safeId(id) + '.' + kind);
const isDone = (id) => fs.existsSync(marker(id, 'done'));
const blockedMsg = (id) => { try { return JSON.parse(fs.readFileSync(marker(id, 'blocked'), 'utf8')).message; } catch { return null; } };

function expandGlob(g) {
  const dir = path.dirname(g); const ext = path.extname(g);
  return listJson(dir).filter((f) => f.endsWith(ext)).map((f) => path.join(dir, f));
}

function renderPrompt(runId, file, vars) {
  let body = fs.readFileSync(file, 'utf8');
  const all = { ID: runId, MULT: cfg.multiplier, ...vars };
  body = body.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in all ? String(all[k]) : m));
  const header = `# Phase run: ${runId}

You are one step of an automated, multi-session build, in a fresh session with no memory of earlier steps.

Protocol (mandatory):
1. Read CLAUDE.md, then .build/NOTES.md, then only the plan files this step names. Do not read other large files.
2. Do only this step's work. Keep your own context small: never print big files; use head, counts and scripts.
3. When every gate check below passes, run exactly:  node tools/phase.mjs done "${runId}" "<one-line summary, no song titles or years>"
4. If you cannot proceed without a human action or a decision, run:  node tools/phase.mjs blocked "${runId}" "<exactly what Nathan must do, step by step>"  then stop.
5. Add anything the next step needs to know with:  node tools/phase.mjs note "<short text>"  (decisions, file locations, commands, gotchas).
6. Commit your work with git before finishing (git add -A && git commit -m "<runId>: ..."), except files that .gitignore excludes.
7. Your final message must be at most 3 lines and must contain counts only, never song titles, artists or years.

---

`;
  return header + body;
}

function writePrompt(runId, file, vars, retryNote) {
  const p = path.join('.build', 'prompts', safeId(runId) + '.md');
  let text = renderPrompt(runId, file, vars);
  if (retryNote) text = text.replace('---\n\n', `---\n\nNOTE: ${retryNote}\n\n`);
  fs.writeFileSync(p, text);
  return p;
}

function runClaude(runId, promptPath, opts) {
  return new Promise((resolve) => {
    const args = ['-p', `Read ${promptPath} and carry out its instructions exactly.`, '--output-format', 'json', '--max-turns', String(cfg.maxTurns)];
    args.push(...cfg.flags.split(/\s+/).filter(Boolean));
    const model = opts.model || cfg.modelDefault;
    if (model) args.push('--model', model);
    if (opts.deny && opts.deny.length) args.push('--disallowedTools', opts.deny.join(','));
    const child = spawn(cfg.claude, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
    let out = ''; let err = '';
    child.stdout.on('data', (d) => (out += d)); child.stderr.on('data', (d) => (err += d));
    const timer = setTimeout(() => child.kill('SIGTERM'), (opts.timeoutMin || cfg.timeoutMin) * 60000);
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, out: '', err: String(e) }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out, err }); });
  });
}

async function runAgent(runId, file, vars, opts = {}) {
  if (isDone(runId)) return 'done';
  for (let attempt = 1; attempt <= cfg.attempts; attempt++) {
    fs.rmSync(marker(runId, 'blocked'), { force: true });
    const retry = attempt > 1 ? 'A previous attempt ended without finishing. Run `git status`, read .build/NOTES.md and any partial outputs for this step, then continue from where it stopped. Do not redo finished work.' : '';
    const promptPath = writePrompt(runId, file, vars, retry);
    const res = await runClaude(runId, promptPath, opts);
    let meta = {};
    try { meta = JSON.parse(res.out); } catch { /* not json */ }
    const logName = `.build/logs/${safeId(runId)}.${attempt}.json`;
    fs.writeFileSync(logName, JSON.stringify({ code: res.code, stderr: res.err.slice(-2000), result: meta.result ?? res.out.slice(-2000), turns: meta.num_turns, cost: meta.total_cost_usd, subtype: meta.subtype }, null, 1));
    const cost = meta.total_cost_usd != null ? ` $${(+meta.total_cost_usd).toFixed(2)}` : '';
    if (isDone(runId)) { log(`${runId}: done (attempt ${attempt}${meta.num_turns ? `, ${meta.num_turns} turns` : ''}${cost})`); return 'done'; }
    const bm = blockedMsg(runId);
    if (bm) { log(`${runId}: BLOCKED`); return 'blocked'; }
    log(`${runId}: attempt ${attempt} ended without a marker (exit ${res.code}${meta.subtype ? `, ${meta.subtype}` : ''}); ${attempt < cfg.attempts ? 'retrying' : 'giving up'}`);
  }
  return 'failed';
}

function runShell(p) {
  if (!p.always && isDone(p.id)) return 'done';
  log(`${p.id}: running ${p.cmd.join(' ')}`);
  const r = spawnSync(p.cmd[0], p.cmd.slice(1), { cwd: ROOT, stdio: 'inherit', timeout: (p.timeoutMin || 30) * 60000, env: process.env });
  if (r.status === 0) {
    fs.writeFileSync(marker(p.id, 'done'), JSON.stringify({ at: new Date().toISOString() }));
    return 'done';
  }
  fs.writeFileSync(marker(p.id, 'blocked'), JSON.stringify({ message: `${p.cmd.join(' ')} exited with code ${r.status}. See the output above, fix, and re-run.` }));
  return 'blocked';
}

async function runForeach(p) {
  const files = expandGlob(p.glob);
  const todo = files.filter((f) => !isDone(`${p.id}:${path.basename(f, '.json')}`));
  log(`${p.id}: ${files.length - todo.length}/${files.length} chunks done${todo.length ? `, running ${todo.length} with ${cfg.parallel} in parallel` : ''}`);
  let idx = 0; let stop = false; const results = [];
  const worker = async () => {
    while (!stop && idx < todo.length) {
      const f = todo[idx++]; const name = path.basename(f, '.json');
      const r = await runAgent(`${p.id}:${name}`, p.prompt, { ...(p.vars || {}), CHUNK: f, CHUNK_NAME: name }, { deny: p.deny, model: p.model });
      results.push(r); if (r !== 'done') stop = true;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, cfg.parallel) }, worker));
  return results.every((r) => r === 'done') ? 'done' : results.includes('blocked') ? 'blocked' : 'failed';
}

function statusTable() {
  for (const p of phases) {
    if (p.type === 'foreach') {
      const files = expandGlob(p.glob);
      const done = files.filter((f) => isDone(`${p.id}:${path.basename(f, '.json')}`)).length;
      console.log(`${files.length && done === files.length ? '[x]' : '[ ]'} ${p.id}  (${done}/${files.length} chunks)`);
    } else {
      const bm = blockedMsg(p.id);
      console.log(`${isDone(p.id) && !p.always ? '[x]' : bm ? '[!]' : '[ ]'} ${p.id}${bm ? '  BLOCKED: ' + bm : ''}`);
    }
  }
}

// ---- main ----
if (opt('--reset')) {
  const pre = opt('--reset');
  for (const f of fs.readdirSync(STATE)) if (f.startsWith(safeId(pre))) { fs.rmSync(path.join(STATE, f)); console.log('cleared', f); }
  process.exit(0);
}
if (opt('--render')) {
  const p = phases.find((x) => x.id === opt('--render') || x.id.startsWith(opt('--render')));
  if (!p || !p.prompt) { console.error('no such agent phase'); process.exit(1); }
  console.log(writePrompt(p.id, p.prompt, p.vars || {}));
  process.exit(0);
}
if (flag('--status')) { statusTable(); process.exit(0); }

const only = opt('--only'); const from = opt('--from');
if (from) { const i = phases.findIndex((p) => p.id.startsWith(from)); if (i >= 0) phases = phases.slice(i); }
if (only) phases = phases.filter((p) => p.id.startsWith(only));

if (flag('--dry-run')) { console.log(`claude: ${cfg.claude}  flags: ${cfg.flags}`); statusTable(); process.exit(0); }

for (const p of phases) {
  let r;
  if (p.type === 'shell') r = runShell(p);
  else if (p.type === 'foreach') r = await runForeach(p);
  else r = await runAgent(p.id, p.prompt, p.vars || {}, { deny: p.deny, model: p.model });
  if (r === 'blocked') {
    const ids = fs.readdirSync(STATE).filter((f) => f.endsWith('.blocked') && f.startsWith(safeId(p.id)));
    console.log('\nSTOPPED: this step needs you.');
    for (const f of ids) { try { console.log(`- ${f.replace('.blocked', '')}: ${JSON.parse(fs.readFileSync(path.join(STATE, f), 'utf8')).message}`); } catch { /* ignore */ } }
    console.log('\nDo what it says, then run the same command again. It resumes where it stopped.');
    process.exit(2);
  }
  if (r === 'failed') { console.log(`\nSTOPPED: ${p.id} did not finish after ${cfg.attempts} attempts. See .build/logs/ and .build/NOTES.md, then re-run.`); process.exit(1); }
}
console.log('\nAll phases complete. Read .build/PLAYTEST.md for the real-device checklist.');
