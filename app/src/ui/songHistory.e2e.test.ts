// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import type { GameSong } from '../logic';
import { HostSession, createFakeBackend, memoryKV, type FakeBackend } from '../net';
import { mountHost } from './host';
import type { ClipPlayer } from './hostGame';
import { mountPhone } from './phone';

// Made-up songs only.
const makePool = (n: number): GameSong[] => Array.from({ length: n }, (_, i) => ({
  id: `test-${String(i + 1).padStart(3, '0')}`,
  title: `Pretend Title ${i + 1}`,
  artists: [`Invented Group ${i + 1}`],
  featuredArtists: [],
  year: 1960 + i * 5,
  previewUrl: `https://audio.invalid/clip-${i + 1}.m4a`,
}));

const wait = async (n = 15) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
const until = async (fn: () => boolean, what: string) => {
  for (let i = 0; i < 200; i++) { if (fn()) return; await wait(2); }
  throw new Error(`timed out waiting for: ${what}`);
};
const q = <T extends Element = HTMLElement>(root: Element, sel: string) => root.querySelector<T>(sel);
const root = () => { const el = document.createElement('div'); document.body.append(el); return el; };
const fire = (el: Element, type: string) => el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
const player: ClipPlayer = { play: async () => undefined, stop: () => undefined, onError: () => undefined };

describe('song history screens (host + 2 phones, fake network)', () => {
  const apps: Array<{ stop(): Promise<void> }> = [];
  afterEach(async () => { for (const a of apps.splice(0)) await a.stop(); document.body.replaceChildren(); });

  /** Opens a lobby with two joined phones and a direct host handle for seeding and checking the database. */
  async function lobby(pool: GameSong[]) {
    const backend: FakeBackend = createFakeBackend(Date.now());
    const kv = memoryKV();
    const hostRoot = root();
    apps.push(await mountHost(hostRoot, { backend, kv, pageUrl: () => 'https://example.test/jukebox/', loadPool: async () => pool, player, rng: () => 0.5 }));
    q(hostRoot, '[data-action=create]')!.click();
    await until(() => !!q(hostRoot, '[data-room-code]'), 'room code');
    const code = q(hostRoot, '[data-room-code]')!.getAttribute('data-room-code')!;
    for (const name of ['Ana', 'Ben']) {
      const r = root();
      apps.push(await mountPhone(r, { backend, kv: memoryKV(), initialCode: '' }));
      q<HTMLInputElement>(r, '#code')!.value = code;
      q<HTMLInputElement>(r, '#name')!.value = name;
      fire(q(r, 'form')!, 'submit');
      await until(() => !!q(r, '[data-you]'), `${name} joined`);
    }
    await until(() => hostRoot.querySelectorAll('[data-player]').length === 2, 'two players');
    q(hostRoot, '[data-mode=closest_year]')!.click();
    await until(() => q(hostRoot, '[data-mode=closest_year]')!.classList.contains('on'), 'mode switched');
    const db = new HostSession(backend, backend.hostCredsFor(code));
    return { hostRoot, db };
  }
  const startGame = async (hostRoot: HTMLElement) => {
    await until(() => !(q<HTMLButtonElement>(hostRoot, '[data-action=start]')!.disabled), 'start enabled');
    q(hostRoot, '[data-action=start]')!.click();
    await until(() => q(hostRoot, '[data-stage=between]') !== null, 'between rounds');
  };
  /** Seeds songs as "played in an earlier game". */
  async function seedEarlier(db: HostSession, ids: string[]) {
    for (const id of ids) {
      const r = await db.startRound(id);
      await db.closeRound(r.id, 'skipped');
    }
    await db.newGame();
    // The host screen redraws from events; let any in-flight game redraw land, then announce the lobby once more.
    await wait(40);
    await db.updateRoom({ status: 'lobby' });
  }
  const inLobby = (hostRoot: HTMLElement) => until(() => q(hostRoot, '[data-action=start]') !== null, 'lobby shown');

  it('reveal screen: remove from future games, undo, remove again', async () => {
    const { hostRoot, db } = await lobby(makePool(12));
    await startGame(hostRoot);
    q(hostRoot, '[data-action=next]')!.click();
    await until(() => q(hostRoot, '[data-stage=listening]') !== null, 'listening');
    q(hostRoot, '[data-action=end-now]')!.click();
    await until(() => q(hostRoot, '[data-stage=reveal]') !== null, 'reveal');

    expect(q(hostRoot, '[data-action=block]')!.textContent).toBe('Remove from future games');
    expect((await db.state()).blocked).toEqual([]);
    q(hostRoot, '[data-action=block]')!.click();
    await until(() => q(hostRoot, '[data-removed]') !== null, 'marked removed');
    const blocked = (await db.state()).blocked;
    expect(blocked.length).toBe(1);
    expect(q(hostRoot, '[data-stage=reveal]')).not.toBeNull(); // stays on the reveal

    q(hostRoot, '[data-action=unblock]')!.click();
    await until(() => q(hostRoot, '[data-action=block]') !== null, 'undone');
    expect((await db.state()).blocked).toEqual([]);

    q(hostRoot, '[data-action=block]')!.click();
    await until(() => q(hostRoot, '[data-removed]') !== null, 'removed again');
    expect((await db.state()).blocked).toEqual(blocked);
  });

  it('Song settings: counts, restore a blocked song, reset with confirm and cancel', async () => {
    const pool = makePool(10);
    const { hostRoot, db } = await lobby(pool);
    await db.blockSong('test-002');
    await db.blockSong('test-005');
    await seedEarlier(db, ['test-001', 'test-003', 'test-004']);
    await inLobby(hostRoot);

    q(hostRoot, '[data-action=open-songs]')!.click();
    await until(() => q(hostRoot, '[data-stage=songs]') !== null && q(hostRoot, '[data-blocked-count]') !== null, 'songs screen');
    expect(q(hostRoot, '[data-available]')!.getAttribute('data-available')).toBe('5'); // 10 - 2 blocked - 3 played
    expect(q(hostRoot, '[data-blocked-count]')!.getAttribute('data-blocked-count')).toBe('2');
    expect(hostRoot.querySelectorAll('[data-blocked]').length).toBe(2);
    expect(q(hostRoot, '[data-blocked=test-002]')!.textContent).toContain('Pretend Title 2');
    expect(q(hostRoot, '[data-blocked=test-002]')!.textContent).toContain('Invented Group 2');

    // Restore one.
    q(q(hostRoot, '[data-blocked=test-002]')!, '[data-action=restore]')!.click();
    await until(() => q(hostRoot, '[data-blocked=test-002]') === null, 'row gone');
    expect((await db.state()).blocked).toEqual(['test-005']);
    expect(q(hostRoot, '[data-available]')!.getAttribute('data-available')).toBe('6');

    // Reset asks first, and cancel changes nothing.
    q(hostRoot, '[data-action=reset-played]')!.click();
    expect(q(hostRoot, '[data-confirm-text]')!.textContent).toContain('available again');
    q(hostRoot, '[data-action=reset-played-cancel]')!.click();
    expect(q(hostRoot, '[data-action=reset-played]')).not.toBeNull();
    expect((await db.state()).played_earlier.length).toBe(3);

    // Confirm resets the played songs but not the blocklist.
    q(hostRoot, '[data-action=reset-played]')!.click();
    q(hostRoot, '[data-action=reset-played-confirm]')!.click();
    await until(() => q(hostRoot, '[data-message]') !== null, 'reset message');
    const s = await db.state();
    expect(s.played_earlier).toEqual([]);
    expect(s.blocked).toEqual(['test-005']);
    await until(() => q(hostRoot, '[data-available]')!.getAttribute('data-available') === '9', 'available count updated');

    // Back to the lobby.
    q(hostRoot, '[data-action=songs-back]')!.click();
    await until(() => q(hostRoot, '[data-action=start]') !== null && q(hostRoot, '[data-stage=songs]') === null, 'lobby');
  });

  it('pool used up by earlier games: friendly message, reset offered, game carries on', async () => {
    const { hostRoot, db } = await lobby(makePool(3));
    await seedEarlier(db, ['test-001', 'test-002', 'test-003']);
    await inLobby(hostRoot);
    await startGame(hostRoot);
    q(hostRoot, '[data-action=next]')!.click();
    await until(() => q(hostRoot, '[data-exhausted]') !== null, 'exhausted notice');
    expect(q(hostRoot, '[data-exhausted]')!.getAttribute('data-exhausted')).toBe('true');
    expect(q(hostRoot, '[data-exhausted]')!.textContent).toMatch(/available again/);

    q(hostRoot, '[data-action=reset-played]')!.click();
    q(hostRoot, '[data-action=reset-played-confirm]')!.click();
    await until(() => q(hostRoot, '[data-exhausted]') === null, 'notice cleared');
    expect((await db.state()).played_earlier).toEqual([]);

    q(hostRoot, '[data-action=next]')!.click();
    await until(() => q(hostRoot, '[data-stage=listening]') !== null, 'next song plays');
  });

  it('everything left is blocked: message, no reset button', async () => {
    const { hostRoot, db } = await lobby(makePool(3));
    for (const id of ['test-001', 'test-002', 'test-003']) await db.blockSong(id);
    await startGame(hostRoot);
    q(hostRoot, '[data-action=next]')!.click();
    await until(() => q(hostRoot, '[data-exhausted]') !== null, 'exhausted notice');
    expect(q(hostRoot, '[data-exhausted]')!.getAttribute('data-exhausted')).toBe('false');
    expect(q(hostRoot, '[data-action=reset-played]')).toBeNull();
    expect(q(hostRoot, '[data-exhausted]')!.textContent).toMatch(/blocked/i);
  });

  it('Song settings: choose decades, the last one stays on, and the game only plays songs from them', async () => {
    const { hostRoot, db } = await lobby(makePool(10)); // years 1960, 1965 ... 2005: two songs in each of five decades
    q(hostRoot, '[data-action=open-songs]')!.click();
    await until(() => q(hostRoot, '[data-decade]') !== null && q(hostRoot, '[data-available]')!.getAttribute('data-available') === '10', 'decades shown');
    const chip = (d: number) => q(hostRoot, `[data-decade="${d}"]`)!;
    const on = (d: number) => chip(d).getAttribute('aria-pressed') === 'true';
    expect(on(1950) && on(2020)).toBe(true);

    for (const d of [1950, 1960, 1990, 2000, 2010, 2020]) {
      chip(d).click();
      await until(() => !on(d), `decade ${d} off`);
    }
    await until(() => q(hostRoot, '[data-available]')!.getAttribute('data-available') === '4', 'count follows decades'); // 1970s and 1980s: 2 songs each
    expect([1970, 1980].every(on)).toBe(true);
    chip(1980).click();
    await until(() => !on(1980), 'decade 1980 off');
    expect(q(hostRoot, '[data-available]')!.getAttribute('data-available')).toBe('2');
    chip(1970).click(); // the last decade cannot be turned off
    await wait(40);
    expect(on(1970)).toBe(true);
    expect((await db.state()).room.settings.decades).toEqual([1970]);

    q(hostRoot, '[data-action=songs-back]')!.click();
    await inLobby(hostRoot);
    q(hostRoot, '[data-mode=closest_year]')!.click();
    await startGame(hostRoot);
    q(hostRoot, '[data-action=next]')!.click();
    await until(() => q(hostRoot, '[data-stage=listening]') !== null, 'listening');
    const played = (await db.state()).played_this_game;
    expect(played.length).toBe(1);
    expect(['test-003', 'test-004']).toContain(played[0]); // the two 1970s songs (1970, 1975)
  });
});
