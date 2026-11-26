#!/usr/bin/env node
// Technical smoke test: 20 well-known songs from different decades are looked up in the iTunes Search API,
// and each returned previewUrl is checked for HTTP 200 + an audio content type.
// Prints counts only. The song list is hard-coded on purpose (this is a connectivity test, not game data).
// Throttled to ~20 calls/minute (3.2 s between search calls). Preview URLs are only probed (HEAD / 1-byte range), never saved.

const SONGS = [
  ['Heartbreak Hotel', 'Elvis Presley'], ['Johnny B. Goode', 'Chuck Berry'], ['Good Vibrations', 'The Beach Boys'],
  ['Hey Jude', 'The Beatles'], ['Bohemian Rhapsody', 'Queen'], ['Stayin Alive', 'Bee Gees'],
  ['Billie Jean', 'Michael Jackson'], ['Like a Prayer', 'Madonna'], ['Smells Like Teen Spirit', 'Nirvana'],
  ['Wonderwall', 'Oasis'], ['Baby One More Time', 'Britney Spears'], ['Crazy in Love', 'Beyonce'],
  ['Mr. Brightside', 'The Killers'], ['Umbrella', 'Rihanna'], ['Rolling in the Deep', 'Adele'],
  ['Uptown Funk', 'Mark Ronson'], ['Shape of You', 'Ed Sheeran'], ['Blinding Lights', 'The Weeknd'],
  ['Levitating', 'Dua Lipa'], ['As It Was', 'Harry Styles'],
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let searchOk = 0, hasPreview = 0, audioOk = 0, errors = 0;

for (let i = 0; i < SONGS.length; i++) {
  const [title, artist] = SONGS[i];
  if (i) await sleep(3200);
  try {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(`${title} ${artist}`)}&media=music&entity=song&limit=5&country=US`;
    const res = await fetch(url);
    if (!res.ok) { errors++; console.log(`#${i + 1}: search HTTP ${res.status}`); continue; }
    const json = await res.json();
    searchOk++;
    const hit = (json.results || []).find((r) => r.previewUrl);
    if (!hit) { console.log(`#${i + 1}: no previewUrl`); continue; }
    hasPreview++;
    let r = await fetch(hit.previewUrl, { headers: { Range: 'bytes=0-1' } });
    const type = r.headers.get('content-type') || '';
    await r.body?.cancel();
    const good = (r.status === 200 || r.status === 206) && /^audio\//i.test(type);
    if (good) audioOk++;
    console.log(`#${i + 1}: preview HTTP ${r.status} ${good ? 'audio' : 'not-audio'}`);
  } catch (e) { errors++; console.log(`#${i + 1}: error ${e.cause?.code || e.message}`); }
}
console.log(`itunes smoke: ${SONGS.length} songs, ${searchOk} searches ok, ${hasPreview} with previewUrl, ${audioOk} audio previews OK, ${errors} errors`);
process.exit(audioOk >= 18 ? 0 : 1);
