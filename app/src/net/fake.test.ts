import { describe, expect, it } from 'vitest';
import { backendContract, SONG_A } from './contract';
import { createFakeBackend, LIVE_WINDOW_MS } from './fakeBackend';
import { createHostRoom } from './host';
import { joinGame } from './room';
import { memoryKV } from './storage';

backendContract('in-memory fake', () => createFakeBackend());

describe('fake backend: liveness and spoilers', () => {
  it('treats a silent seat as reclaimable once its heartbeat is stale', async () => {
    const b = createFakeBackend();
    const creds = await createHostRoom(b, 'timeline');
    const first = await joinGame(b, memoryKV(), { code: creds.code, name: 'Lee' });
    expect(first.ok).toBe(true);
    expect((await joinGame(b, memoryKV(), { code: creds.code, name: 'Lee' })).ok).toBe(false);
    b.advance(LIVE_WINDOW_MS + 1000); // phone died without saying goodbye, and no host screen is mirroring presence
    const again = await joinGame(b, memoryKV(), { code: creds.code, name: 'Lee' });
    expect(again.ok && again.kind).toBe('reclaimed');
  });

  it('never puts the current song in anything a phone can read', async () => {
    const b = createFakeBackend();
    const kv = memoryKV();
    const creds = await createHostRoom(b, 'timeline');
    const p = await joinGame(b, memoryKV(), { code: creds.code, name: 'Lee' });
    if (!p.ok) throw new Error('join failed');
    const round = await b.hostStartRound(creds.roomId, creds.hostToken, { songId: SONG_A });
    await b.submitAnswer(p.seat.seatToken, round.id, { slot: 0, artist: 'secret-guess', lock: true });
    expect(b.publicSnapshot()).not.toContain(SONG_A);
    expect(b.publicSnapshot()).not.toContain('secret-guess');
    expect(JSON.stringify(await b.getMyState(p.seat.seatToken))).not.toContain(SONG_A);
  });
});
