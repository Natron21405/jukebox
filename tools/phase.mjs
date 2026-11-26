#!/usr/bin/env node
// Used by phase agents:  node tools/phase.mjs done <id> "<summary>" | blocked <id> "<what Nathan must do>" | note "<text>"
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, STATE, safeId } from './lib.mjs';
const [cmd, a, b] = process.argv.slice(2);
const notes = path.join(ROOT, '.build', 'NOTES.md');
fs.mkdirSync(STATE, { recursive: true });
const stamp = () => new Date().toISOString().slice(0, 16).replace('T', ' ');
if (cmd === 'done') {
  fs.rmSync(path.join(STATE, safeId(a) + '.blocked'), { force: true });
  fs.writeFileSync(path.join(STATE, safeId(a) + '.done'), JSON.stringify({ at: stamp(), summary: b || '' }));
  fs.appendFileSync(notes, `- [done ${stamp()}] ${a}: ${b || ''}\n`);
  console.log('marked done:', a);
} else if (cmd === 'blocked') {
  fs.writeFileSync(path.join(STATE, safeId(a) + '.blocked'), JSON.stringify({ at: stamp(), message: b || '' }));
  fs.appendFileSync(notes, `- [BLOCKED ${stamp()}] ${a}: ${b || ''}\n`);
  console.log('marked blocked:', a);
} else if (cmd === 'note') {
  fs.appendFileSync(notes, `${a}\n`);
  console.log('note added');
} else {
  console.error('usage: phase.mjs done|blocked <id> "<text>" | note "<text>"'); process.exit(2);
}
