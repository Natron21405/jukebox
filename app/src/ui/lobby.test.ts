// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeBackend } from '../net';
import { memoryKV } from '../net';
import { mountHost, type HostApp } from './host';
import { mountPhone, type PhoneApp } from './phone';

const PAGE = 'https://example.test/jukebox/';
const tick = async (n = 12) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
const q = <T extends Element = HTMLElement>(root: Element, sel: string) => root.querySelector<T>(sel);

// Made-up songs, just enough for Start to deal a game.
const POOL = Array.from({ length: 6 }, (_, i) => ({
  id: `test-${i + 1}`, title: `Test Song ${i + 1}`, artists: [`Fake Band ${i + 1}`], featuredArtists: [],
  year: 1970 + i * 7, previewUrl: `https://audio.invalid/clip-${i + 1}.m4a`,
}));

function newRoot() {
  const el = document.createElement('div');
  document.body.append(el);
  return el;
}

describe('lobby screens (host + phones, driven by the fake net layer)', () => {
  const apps: Array<{ stop(): Promise<void> }> = [];
  afterEach(async () => {
    for (const a of apps.splice(0)) await a.stop();
    document.body.replaceChildren();
  });
  const track = <T extends { stop(): Promise<void> }>(a: T) => { apps.push(a); return a; };

  async function startHost(backend = createFakeBackend(), kv = memoryKV()) {
    const root = newRoot();
    const app = track(await mountHost(root, { backend, kv, pageUrl: () => PAGE, loadPool: async () => POOL }));
    return { root, app, backend, kv };
  }
  async function startPhone(backend: ReturnType<typeof createFakeBackend>, kv = memoryKV(), code = '') {
    const root = newRoot();
    const app = track(await mountPhone(root, { backend, kv, initialCode: code }));
    return { root, app, kv };
  }
  async function submitJoin(root: HTMLElement, code: string, name: string) {
    q<HTMLInputElement>(root, '#code')!.value = code;
    q<HTMLInputElement>(root, '#name')!.value = name;
    q<HTMLFormElement>(root, 'form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await tick();
  }
  const roomCode = (host: HTMLElement) => q(host, '[data-room-code]')!.getAttribute('data-room-code')!;
  const names = (host: HTMLElement) => [...host.querySelectorAll('[data-player]')].map((e) => e.getAttribute('data-player'));

  it('creates a room and shows the code, the join address and a QR code', async () => {
    const { root } = await startHost();
    expect(q(root, '[data-action=create]')).not.toBeNull();
    q(root, '[data-action=create]')!.click();
    await tick();
    expect(roomCode(root)).toMatch(/^[A-Z]{4}$/);
    expect(root.textContent).toContain('example.test/jukebox');
    expect(q(root, '.qr svg')).not.toBeNull();
    expect((q(root, '[data-action=start]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('joins 3 phones, rejects a duplicate name kindly, and keeps seats across refreshes', async () => {
    const backend = createFakeBackend();
    const host = await startHost(backend);
    q(host.root, '[data-action=create]')!.click();
    await tick();
    const code = roomCode(host.root);

    const phones = [];
    for (const name of ['Ann', 'Bo', 'Cy']) {
      const p = await startPhone(backend, memoryKV(), code);
      await submitJoin(p.root, code, name);
      expect(q(p.root, '[data-state=waiting]')).not.toBeNull();
      phones.push({ ...p, name });
    }
    await tick();
    expect(names(host.root).sort()).toEqual(['Ann', 'Bo', 'Cy']);
    expect(q(host.root, '[data-count]')!.getAttribute('data-count')).toBe('3');
    expect((q(host.root, '[data-action=start]') as HTMLButtonElement).disabled).toBe(false);

    // A fourth phone cannot take a name that is in use, and is told so in plain words.
    const dup = await startPhone(backend, memoryKV(), code);
    await submitJoin(dup.root, code, 'Bo');
    const msg = q(dup.root, '[data-message=join]')!;
    expect(msg.hidden).toBe(false);
    expect(msg.textContent).toMatch(/already taken/i);
    expect(q(dup.root, '[data-state=waiting]')).toBeNull();
    expect(names(host.root)).toHaveLength(3);

    // Refresh phone "Bo": stop the page, mount again with the same browser storage. Same seat, no new player.
    const bo = phones[1];
    await bo.app.stop();
    const reopened = await startPhone(backend, bo.kv, code);
    await tick();
    expect(q(reopened.root, '[data-you]')!.getAttribute('data-you')).toBe('Bo');
    expect(q(reopened.root, '[data-state=waiting]')).not.toBeNull();
    expect(q(reopened.root, '#name')).toBeNull(); // no join form: it went straight back to its seat
    expect(names(host.root).sort()).toEqual(['Ann', 'Bo', 'Cy']);
  });

  it('restores the lobby, including mode and settings, when the host refreshes', async () => {
    const backend = createFakeBackend();
    const kv = memoryKV();
    const host = await startHost(backend, kv);
    q(host.root, '[data-action=create]')!.click();
    await tick();
    const code = roomCode(host.root);
    for (const name of ['Ann', 'Bo', 'Cy']) {
      const p = await startPhone(backend, memoryKV(), code);
      await submitJoin(p.root, code, name);
    }
    await tick();
    q(host.root, '[data-mode=closest_year]')!.click();
    await tick();
    q(host.root, '[data-setting=rounds] [aria-label^="More"]')!.click();
    await tick();
    const rounds = q(host.root, '[data-setting=rounds] .stepper-value')!.textContent;

    await host.app.stop();
    host.root.remove();
    const again = await startHost(backend, kv);
    await tick();
    expect(q(again.root, '[data-action=create]')).toBeNull(); // no "create room": it resumed
    expect(roomCode(again.root)).toBe(code);
    expect(names(again.root).sort()).toEqual(['Ann', 'Bo', 'Cy']);
    expect(q(again.root, '[data-mode=closest_year]')!.getAttribute('aria-pressed')).toBe('true');
    expect(q(again.root, '[data-setting=rounds] .stepper-value')!.textContent).toBe(rounds);
  });

  it('changes the win target in Timeline mode and stays inside the allowed range', async () => {
    const { root } = await startHost();
    q(root, '[data-action=create]')!.click();
    await tick();
    const read = () => Number(q(root, '[data-setting=targetCards] .stepper-value')!.textContent);
    const before = read();
    q(root, '[data-setting=targetCards] [aria-label^="More"]')!.click();
    await tick();
    expect(read()).toBe(before + 1);
    for (let i = 0; i < 40; i++) { q(root, '[data-setting=targetCards] [aria-label^="More"]')!.click(); await tick(2); }
    await tick();
    expect(read()).toBeLessThanOrEqual(20);
  });

  it('kicks a player with a two-tap confirm; their phone returns to the join form and the name is free', async () => {
    const backend = createFakeBackend();
    const host = await startHost(backend);
    q(host.root, '[data-action=create]')!.click();
    await tick();
    const code = roomCode(host.root);
    const ann = await startPhone(backend, memoryKV(), code);
    await submitJoin(ann.root, code, 'Ann');
    const bo = await startPhone(backend, memoryKV(), code);
    await submitJoin(bo.root, code, 'Bo');
    await tick();

    const kickBtn = () => q(host.root, '[data-player=Bo] [data-action=kick]')!;
    kickBtn().click(); // first tap only arms it
    await tick();
    expect(names(host.root)).toContain('Bo');
    expect(kickBtn().textContent).toBe('Remove?');
    kickBtn().click();
    await tick();
    expect(names(host.root)).toEqual(['Ann']);
    expect(q(bo.root, '#name')).not.toBeNull();
    expect(q(bo.root, '[data-message=join]')!.textContent).toMatch(/removed/i);

    const again = await startPhone(backend, memoryKV(), code);
    await submitJoin(again.root, code, 'Bo');
    expect(q(again.root, '[data-state=waiting]')).not.toBeNull();
  });

  it('starts the game once 2 players are in, and phones stop saying "waiting"', async () => {
    const backend = createFakeBackend();
    const host = await startHost(backend);
    q(host.root, '[data-action=create]')!.click();
    await tick();
    const code = roomCode(host.root);
    const phones = [];
    for (const name of ['Ann', 'Bo']) {
      const p = await startPhone(backend, memoryKV(), code);
      await submitJoin(p.root, code, name);
      phones.push(p);
    }
    await tick();
    q(host.root, '[data-action=start]')!.click();
    await tick();
    expect(q(host.root, '[data-stage=between]')).not.toBeNull(); // the host moved on to the game screens
    // Phones move on to the game screens too (the lobby "waiting" line is gone).
    for (const p of phones) {
      expect(q(p.root, '[data-stage=waiting]')).not.toBeNull();
      expect(q(p.root, '[data-state=waiting]')).toBeNull();
    }
  });

  it('tells a phone about a wrong room code and a short code without joining', async () => {
    const backend = createFakeBackend();
    const p = await startPhone(backend);
    await submitJoin(p.root, 'AB', 'Zed');
    expect(q(p.root, '[data-message=join]')!.textContent).toMatch(/4 letters/);
    await submitJoin(p.root, 'ZZZZ', 'Zed');
    expect(q(p.root, '[data-message=join]')!.textContent).toMatch(/can't find that room/i);
  });
});
