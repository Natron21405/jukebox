#!/usr/bin/env node
// Resolve Apple (iTunes Search API) 30-second preview URLs for every song.
//   node tools/resolve-previews.mjs [--input FILE] [--output FILE] [--limit N] [--selftest]
// Defaults: input data/work/songs.nopreview.json, output data/work/previews.json
// Resumable: progress is saved after every song; Ctrl-C and re-run are safe.
// Prints counts only, never titles or artists. Audio is never downloaded (HEAD / 2-byte ranged GET only).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, norm, readJson } from './lib.mjs';

export const CONFIG = {
  minGapMs: 3200,        // minimum gap between iTunes API calls
  backoffMs: 60000,      // wait after HTTP 403/429
  maxRetries: 5,         // retries on 403/429 before giving up (run aborts, song stays unresolved)
  networkRetries: 3,     // retries on network errors / 5xx
  networkRetryMs: 10000,
  limit: 10,
  country: 'US',
  timeoutMs: 20000,
  progressEvery: 50,
};

const NOISE = 'remaster(?:ed)?|feat\\.?|featuring|ft\\.?|with|version|mono|stereo|single|edit|mix|album|deluxe|bonus|explicit|clean|radio|original|anniversary|digital|reissue|\\d{4}';
const NOISE_PAREN = new RegExp(`\\s*[\\(\\[][^\\)\\]]*\\b(?:${NOISE})\\b[^\\)\\]]*[\\)\\]]`, 'gi');
const NOISE_DASH = new RegExp(`\\s+-\\s+[^-]*\\b(?:${NOISE})\\b.*$`, 'i');
const BANNED = ['live', 'karaoke', 'tribute', 'remix', 'instrumental', 'cover', 'acoustic', 'demo', 'rehearsal', 'medley'];

/** Title with "remastered", "feat." and similar suffixes removed, then normalised. */
export function cleanTitle(t) {
  return norm(String(t || '').replace(NOISE_PAREN, '').replace(NOISE_DASH, ''));
}

const containsWords = (hay, needle) => needle !== '' && ` ${hay} `.includes(` ${needle} `);

export function titleMatches(songTitle, resultTitle) {
  const a = cleanTitle(songTitle);
  const b = cleanTitle(resultTitle);
  return a !== '' && (a === b || norm(songTitle) === norm(resultTitle));
}

export function artistMatches(song, resultArtist) {
  const hay = norm(resultArtist);
  const names = [song.artists?.[0], ...(song.artistAliases || [])].map(norm).filter(Boolean);
  return names.some((n) => containsWords(hay, n));
}

function isBannedVersion(song, r) {
  const own = norm(`${song.title} ${(song.artists || []).join(' ')}`);
  const theirs = norm(`${r.trackName} ${r.collectionName || ''} ${r.artistName}`);
  return BANNED.some((w) => containsWords(theirs, w) && !containsWords(own, w));
}

/** Accepted results, earliest releaseDate first. releaseDate is only used for ordering, never as a year. */
export function pickCandidates(song, results) {
  return (results || [])
    .filter((r) => r && r.previewUrl && r.trackName && r.artistName
      && (r.kind === undefined || r.kind === 'song')
      && titleMatches(song.title, r.trackName)
      && artistMatches(song, r.artistName)
      && !isBannedVersion(song, r))
    .sort((x, y) => String(x.releaseDate || '9999').localeCompare(String(y.releaseDate || '9999')));
}

export function searchUrl(song) {
  const term = `${song.title} ${song.artists?.[0] || ''}`.trim();
  const p = new URLSearchParams({ term, entity: 'song', limit: String(CONFIG.limit), country: CONFIG.country });
  return `https://itunes.apple.com/search?${p}`;
}

/** Client with throttling and 403/429 back-off. fetchImpl and sleep are injectable for offline tests. */
export function createClient({ fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now(), config = CONFIG } = {}) {
  let lastCall = -Infinity;
  const timeout = () => (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(config.timeoutMs) : undefined);

  async function apiGet(url) {
    let blocked = 0;
    let netErrors = 0;
    for (;;) {
      const wait = lastCall + config.minGapMs - now();
      if (wait > 0) await sleep(wait);
      lastCall = now();
      let res;
      try {
        res = await fetchImpl(url, { signal: timeout() });
      } catch {
        if (++netErrors > config.networkRetries) throw new Error('iTunes unreachable (network errors)');
        await sleep(config.networkRetryMs);
        continue;
      }
      if (res.status === 403 || res.status === 429) {
        if (++blocked > config.maxRetries) throw new Error(`iTunes rate limit persists (HTTP ${res.status}) after ${config.maxRetries} retries`);
        await sleep(config.backoffMs);
        lastCall = now();
        continue;
      }
      if (res.status >= 500) {
        if (++netErrors > config.networkRetries) throw new Error(`iTunes server error (HTTP ${res.status})`);
        await sleep(config.networkRetryMs);
        continue;
      }
      if (!res.ok) throw new Error(`iTunes HTTP ${res.status}`);
      return res.json();
    }
  }

  const isAudio = (res) => res && (res.status === 200 || res.status === 206)
    && /^audio\//i.test(res.headers.get('content-type') || '');

  /** True if the clip answers 200/206 with an audio content type. Never downloads the audio. */
  async function verifyAudio(url) {
    try {
      const head = await fetchImpl(url, { method: 'HEAD', signal: timeout() });
      if (isAudio(head)) return true;
    } catch { /* fall through to ranged GET */ }
    try {
      const get = await fetchImpl(url, { method: 'GET', headers: { Range: 'bytes=0-1' }, signal: timeout() });
      const ok = isAudio(get);
      try { await get.body?.cancel(); } catch { /* ignore */ }
      return ok;
    } catch { return false; }
  }

  /** -> {previewUrl, trackId} or {failed:true}. Throws only on transient errors (song left unresolved). */
  async function resolveSong(song) {
    const data = await apiGet(searchUrl(song));
    for (const r of pickCandidates(song, data.results)) {
      if (await verifyAudio(r.previewUrl)) return { previewUrl: r.previewUrl, trackId: r.trackId };
    }
    return { failed: true };
  }

  return { apiGet, verifyAudio, resolveSong };
}

function save(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, file);
}

export const tally = (songs, progress) => {
  let matched = 0, failed = 0;
  for (const s of songs) {
    const p = progress[s.id];
    if (!p) continue;
    if (p.failed) failed++; else matched++;
  }
  return { matched, failed, remaining: songs.length - matched - failed };
};

export async function run({ input, output, limit = Infinity, client = createClient(), log = console.log, config = CONFIG } = {}) {
  const raw = readJson(input, null);
  const songs = Array.isArray(raw) ? raw : raw?.songs;
  if (!Array.isArray(songs)) throw new Error('input file missing or not a song list');
  const progress = readJson(output, {}) || {};
  let stopped = false;
  const onSigint = () => { stopped = true; };
  process.on('SIGINT', onSigint);
  let done = 0, error = null;
  try {
    for (const song of songs) {
      if (stopped || done >= limit) break;
      if (progress[song.id]) continue;
      try {
        progress[song.id] = await client.resolveSong(song);
      } catch (e) { error = e; break; }
      save(output, progress);
      done++;
      if (done % config.progressEvery === 0) {
        const t = tally(songs, progress);
        log(`progress: ${t.matched + t.failed}/${songs.length} (matched ${t.matched}, failed ${t.failed})`);
      }
    }
  } finally { process.off('SIGINT', onSigint); }
  const t = tally(songs, progress);
  if (error) log(`stopped: ${error.message}. Re-run to resume.`);
  else if (stopped) log('stopped by user. Re-run to resume.');
  log(`matched: ${t.matched}, failed: ${t.failed}, remaining: ${t.remaining}`);
  return { ...t, error };
}

/** One real API call against a well-known song; prints only ok/fail. */
export async function selfTest(client = createClient()) {
  try {
    const r = await client.resolveSong({ id: 'selftest', title: 'Billie Jean', artists: ['Michael Jackson'], artistAliases: [] });
    return !r.failed && /^https?:\/\//.test(r.previewUrl);
  } catch { return false; }
}

const arg = (name, def) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : def; };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--selftest')) {
    console.log((await selfTest()) ? 'ok' : 'fail');
  } else {
    const res = await run({
      input: path.resolve(arg('--input', path.join(ROOT, 'data/work/songs.nopreview.json'))),
      output: path.resolve(arg('--output', path.join(ROOT, 'data/work/previews.json'))),
      limit: Number(arg('--limit', Infinity)),
    });
    if (res.error) process.exitCode = 1;
  }
}
