// Offline test (stubbed fetch, made-up songs).  Run: node --test tools/resolve-previews.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanTitle, pickCandidates, createClient, run, CONFIG } from './resolve-previews.mjs';

const songs = [
  { id: 't-001', title: 'Zorble Night', artists: ['The Quixotic Trio'], artistAliases: [], featuredArtists: [], year: 1971 },
  { id: 't-002', title: 'Moon Parade', artists: ['Wanda Plimsoll'], artistAliases: ['W. Plimsoll'], featuredArtists: [], year: 1984 },
  { id: 't-003', title: 'Live and Learn', artists: ['Orbit Kettle'], artistAliases: [], featuredArtists: [], year: 1999 },
  { id: 't-004', title: 'Nothing Here', artists: ['Nobody Known'], artistAliases: [], featuredArtists: [], year: 2005 },
  { id: 't-005', title: 'Broken Link', artists: ['Dax Fennimore'], artistAliases: [], featuredArtists: [], year: 2012 },
];
const R = (o) => ({ kind: 'song', previewUrl: `https://audio.test/${o.trackId}.m4a`, ...o });
const catalog = {
  'Zorble Night': [
    R({ trackId: 1, trackName: 'Zorble Night (Remastered 2009)', artistName: 'Quixotic Trio', collectionName: 'Zorble', releaseDate: '2009-05-01T00:00:00Z' }),
    R({ trackId: 2, trackName: 'Zorble Night', artistName: 'The Quixotic Trio', collectionName: 'Zorble', releaseDate: '1971-03-01T00:00:00Z' }),
    R({ trackId: 3, trackName: 'Zorble Night', artistName: 'Karaoke Stars', collectionName: 'Hits', releaseDate: '1960-01-01T00:00:00Z' }),
  ],
  'Moon Parade': [
    R({ trackId: 4, trackName: 'Moon Parade - Live', artistName: 'Wanda Plimsoll', releaseDate: '1985-01-01T00:00:00Z' }),
    R({ trackId: 5, trackName: 'Moon Parade (feat. Someone)', artistName: 'W. Plimsoll', releaseDate: '1984-06-01T00:00:00Z' }),
  ],
  'Live and Learn': [
    R({ trackId: 6, trackName: 'Live and Learn', artistName: 'Orbit Kettle', releaseDate: '1999-01-01T00:00:00Z' }),
  ],
  'Nothing Here': [R({ trackId: 7, trackName: 'Something Else', artistName: 'Nobody Known' })],
  'Broken Link': [R({ trackId: 8, trackName: 'Broken Link', artistName: 'Dax Fennimore' })],
};

function stub() {
  const calls = { api: [], other: 0, sleeps: [] };
  let t = 0;
  const fetchImpl = async (url, opts = {}) => {
    const u = new URL(url);
    if (u.host === 'itunes.apple.com') {
      calls.api.push(t);
      const term = u.searchParams.get('term');
      assert.equal(u.searchParams.get('entity'), 'song');
      assert.equal(u.searchParams.get('limit'), '10');
      assert.equal(u.searchParams.get('country'), 'US');
      const key = Object.keys(catalog).find((k) => term.startsWith(k));
      return new Response(JSON.stringify({ results: catalog[key] || [] }), { status: 200 });
    }
    calls.other++;
    if (u.pathname === '/8.m4a') return new Response(null, { status: 404 });
    const ct = { 'content-type': 'audio/mp4' };
    if (opts.method === 'HEAD' && u.pathname === '/6.m4a') return new Response(null, { status: 405 }); // forces ranged GET
    return new Response(null, { status: opts.method === 'GET' ? 206 : 200, headers: ct });
  };
  const sleep = async (ms) => { calls.sleeps.push(ms); t += ms; };
  const client = createClient({ fetchImpl, sleep, now: () => t });
  return { client, calls };
}

test('cleanTitle drops remaster/feat suffixes', () => {
  assert.equal(cleanTitle('Moon Parade (Remastered 2011)'), cleanTitle('Moon Parade'));
  assert.equal(cleanTitle('Moon Parade - 2009 Remaster'), cleanTitle('Moon Parade'));
  assert.equal(cleanTitle('Moon Parade [feat. X]'), cleanTitle('Moon Parade'));
});

test('pickCandidates: earliest matching, rejects karaoke/live, accepts alias', () => {
  const picked = pickCandidates(songs[0], catalog['Zorble Night']);
  assert.deepEqual(picked.map((r) => r.trackId), [2, 1]);
  assert.deepEqual(pickCandidates(songs[1], catalog['Moon Parade']).map((r) => r.trackId), [5]);
  assert.deepEqual(pickCandidates(songs[2], catalog['Live and Learn']).map((r) => r.trackId), [6]); // "live" is in the song's own title
  assert.deepEqual(pickCandidates(songs[3], catalog['Nothing Here']), []);
});

test('run: resolves, fails, resumes, throttles', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prev-'));
  const input = path.join(dir, 'in.json');
  const output = path.join(dir, 'out.json');
  fs.writeFileSync(input, JSON.stringify(songs));
  const { client, calls } = stub();
  const logs = [];
  const r1 = await run({ input, output, limit: 3, client, log: (m) => logs.push(m) });
  assert.deepEqual([r1.matched, r1.failed, r1.remaining], [3, 0, 2]);
  const r2 = await run({ input, output, client, log: (m) => logs.push(m) });
  assert.deepEqual([r2.matched, r2.failed, r2.remaining], [3, 2, 0]);
  assert.equal(calls.api.length, 5); // resumed songs not re-queried
  for (let i = 1; i < calls.api.length; i++) assert.ok(calls.api[i] - calls.api[i - 1] >= CONFIG.minGapMs);
  const out = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.deepEqual(out['t-001'], { previewUrl: 'https://audio.test/2.m4a', trackId: 2 });
  assert.equal(out['t-002'].trackId, 5);
  assert.equal(out['t-003'].trackId, 6);
  assert.deepEqual(out['t-004'], { failed: true });
  assert.deepEqual(out['t-005'], { failed: true }); // preview URL answered 404
  assert.ok(logs.every((l) => !/Zorble|Plimsoll|Quixotic|Kettle|Fennimore/.test(l)));
  fs.rmSync(dir, { recursive: true });
});

test('backs off 60s on 429 and gives up after 5 retries', async () => {
  let n = 0;
  const sleeps = [];
  let t = 0;
  const mk = (statuses) => createClient({
    fetchImpl: async () => new Response(JSON.stringify({ results: [] }), { status: statuses[Math.min(n++, statuses.length - 1)] }),
    sleep: async (ms) => { sleeps.push(ms); t += ms; }, now: () => t,
  });
  const ok = await mk([429, 403, 200]).resolveSong(songs[3]);
  assert.deepEqual(ok, { failed: true });
  assert.equal(sleeps.filter((s) => s === 60000).length, 2);
  n = 0;
  await assert.rejects(mk([429]).resolveSong(songs[3]), /rate limit/);
});
