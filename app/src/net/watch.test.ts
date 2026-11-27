import { describe, expect, it } from 'vitest';
import { createFakeBackend, createHostRoom, joinGame, memoryKV, HostSession, watchRoom, type Backend, type PublicRoomState } from '.';

const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms));

/** A backend whose realtime channel is silent while `mute.on`: events are lost, like a dropped websocket. */
function withMutableRealtime(inner: Backend) {
  const mute = { on: false };
  const b: Backend = {
    ...inner,
    subscribe: (roomId, onChange) => inner.subscribe(roomId, (c) => { if (!mute.on) onChange(c); }),
  };
  return { b, mute };
}

describe('watchRoom resync (lost realtime events)', () => {
  async function room() {
    const fake = createFakeBackend();
    const kv = memoryKV();
    const creds = await createHostRoom(fake, 'timeline');
    const host = new HostSession(fake, creds);
    const j = await joinGame(fake, memoryKV(), { code: creds.code, name: 'Ana' });
    if (!j.ok) throw new Error('join failed');
    return { fake, creds, host };
  }

  it('catches up after events were lost: a new game started while the channel was down', async () => {
    const { fake, creds, host } = await room();
    const { b, mute } = withMutableRealtime(fake);
    const seen: PublicRoomState[] = [];
    const stop = await watchRoom(b, creds.roomId, (s) => seen.push(s), { resyncSeconds: 0.02 });
    await host.updateRoom({ status: 'playing' });
    await settle();
    expect(seen[seen.length - 1].room.status).toBe('playing');

    mute.on = true;
    await host.newGame(); // game_no goes up, status back to lobby; nobody hears about it
    await settle(100);
    expect(seen[seen.length - 1].room.game_no).toBe(2);
    expect(seen[seen.length - 1].room.status).toBe('lobby');
    await stop();
  });

  it('does not call back when nothing changed, and stops resyncing after stop()', async () => {
    const { fake, creds, host } = await room();
    const { b, mute } = withMutableRealtime(fake);
    let calls = 0;
    const stop = await watchRoom(b, creds.roomId, () => { calls++; }, { resyncSeconds: 0.02 });
    const after = calls;
    await settle(100);
    expect(calls).toBe(after);
    await stop();
    mute.on = true;
    await host.updateRoom({ status: 'playing' });
    await settle(100);
    expect(calls).toBe(after);
  });

  it('a live change beats a slower re-read that started earlier', async () => {
    const { fake, creds, host } = await room();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let slow = false;
    const b: Backend = {
      ...fake,
      getRoom: async (id) => { const r = await fake.getRoom(id); if (slow) await gate; return r; },
    };
    const seen: PublicRoomState[] = [];
    const stop = await watchRoom(b, creds.roomId, (s) => seen.push(s), { resyncSeconds: 0.02 });
    slow = true;
    await settle(40); // a re-read starts and waits on the gate holding the old (lobby) room
    await host.updateRoom({ status: 'playing' }); // live change arrives meanwhile
    await settle();
    slow = false;
    release();
    await settle(60);
    expect(seen[seen.length - 1].room.status).toBe('playing');
    await stop();
  });
});
