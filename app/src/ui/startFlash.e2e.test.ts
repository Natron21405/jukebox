// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import type { GameSong } from '../logic';
import { createFakeBackend, memoryKV, type Backend } from '../net';
import { mountHost } from './host';
import type { ClipPlayer } from './hostGame';
import { mountPhone } from './phone';

// Made-up songs only.
const POOL: GameSong[] = Array.from({ length: 40 }, (_, i) => ({
  id: `test-${String(i + 1).padStart(3, '0')}`, title: `Zanzibar Title ${i + 1}x`, artists: [`Plonk Collective ${i + 1}x`],
  featuredArtists: [], year: 1960 + ((i * 7) % 55), previewUrl: `https://audio.invalid/clip-${i + 1}.m4a`,
}));

const wait = async (n = 15) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
const until = async (fn: () => boolean, what: string) => {
  for (let i = 0; i < 400; i++) { if (fn()) return; await wait(2); }
  throw new Error(`timed out waiting for: ${what}`);
};
const q = <T extends Element = HTMLElement>(root: Element, sel: string) => root.querySelector<T>(sel);
const fire = (el: Element, type: string) => el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
const player: ClipPlayer = { play: async () => undefined, stop: () => undefined, onError: () => undefined };

/** A short name for whatever screen is showing, so a test can list every screen a device went through. */
function screenName(root: HTMLElement): string {
  const main = root.firstElementChild;
  if (!main) return '(empty)';
  const stage = main.getAttribute('data-stage') ?? q(main, '[data-stage]')?.getAttribute('data-stage');
  if (stage) return `stage:${stage}`;
  if (q(main, '[data-action=start]')) return 'host-lobby';
  if (q(main, '[data-state=waiting]')) return 'phone-lobby';
  return `other:${main.className}`;
}
/** A fuller description (class and visible words), for reading what each screen was. */
const detail = (root: HTMLElement) => `${root.firstElementChild?.className}|${(root.textContent ?? '').replace(/\s+/g, ' ').slice(0, 60)}`;
/** Every different screen the root showed from now on, in order (repeats of the same screen collapse into one). */
function watchScreens(root: HTMLElement) {
  const seen: string[] = [screenName(root)];
  const full: string[] = [detail(root)];
  const obs = new MutationObserver(() => {
    const n = screenName(root);
    if (seen[seen.length - 1] !== n) seen.push(n);
    const d = detail(root);
    if (full[full.length - 1] !== d) full.push(d);
  });
  obs.observe(root, { childList: true });
  return { seen, full, stop: () => obs.disconnect() };
}

/** The fake backend, but every call and every change notice arrives after a short, uneven delay, like a real network. */
function slow(inner: Backend): Backend {
  let n = 0;
  const lag = () => new Promise<void>((r) => setTimeout(r, 3 + ((n++ * 7) % 11)));
  return new Proxy(inner, {
    get(target, prop, receiver) {
      const v = Reflect.get(target, prop, receiver) as unknown;
      if (typeof v !== 'function') return v;
      if (prop === 'subscribe') {
        return (roomId: string, onChange: (c: never) => void) =>
          (v as (...a: unknown[]) => Promise<unknown>).call(target, roomId, (c: never) => { void lag().then(() => onChange(c)); });
      }
      return async (...args: unknown[]) => { await lag(); return (v as (...a: unknown[]) => unknown).apply(target, args); };
    },
  });
}

describe('Start game: the screens go straight to the game, with no flashing between two screens', () => {
  const apps: Array<{ stop(): Promise<void> }> = [];
  afterEach(async () => { for (const a of apps.splice(0)) await a.stop(); document.body.replaceChildren(); });

  async function setup(backend: Backend, mode: 'closest_year' | 'timeline') {
    const hostRoot = document.createElement('div'); document.body.append(hostRoot);
    apps.push(await mountHost(hostRoot, {
      backend, kv: memoryKV(), pageUrl: () => 'https://example.test/jukebox/', loadPool: async () => POOL, player, rng: () => 0.5,
    }));
    await until(() => !!q(hostRoot, '[data-room-code]'), 'room code');
    const code = q(hostRoot, '[data-room-code]')!.getAttribute('data-room-code')!;
    if (mode === 'closest_year') {
      q(hostRoot, '[data-mode=closest_year]')!.click();
      await until(() => q(hostRoot, '[data-mode=closest_year]')!.getAttribute('aria-pressed') === 'true', 'mode switched');
    }
    const phones: HTMLElement[] = [];
    for (const name of ['Ana', 'Ben', 'Cy']) {
      const r = document.createElement('div'); document.body.append(r);
      apps.push(await mountPhone(r, { backend, kv: memoryKV(), initialCode: '' }));
      q<HTMLInputElement>(r, '#code')!.value = code;
      q<HTMLInputElement>(r, '#name')!.value = name;
      fire(q(r, 'form')!, 'submit');
      await until(() => !!q(r, '[data-you]'), `${name} joined`);
      phones.push(r);
    }
    await until(() => hostRoot.querySelectorAll('[data-player]').length === 3, 'three players on the host');
    return { hostRoot, phones };
  }

  for (const mode of ['closest_year', 'timeline'] as const) {
    it(`${mode}: host and phones each change screen once`, async () => {
      const { hostRoot, phones } = await setup(slow(createFakeBackend(Date.now())), mode);
      await until(() => !q<HTMLButtonElement>(hostRoot, '[data-action=start]')!.disabled, 'start enabled');
      const watchers = [hostRoot, ...phones].map(watchScreens);
      q(hostRoot, '[data-action=start]')!.click();
      await until(() => screenName(hostRoot).startsWith('stage:'), `host in the game (now ${screenName(hostRoot)})`);
      await new Promise((r) => setTimeout(r, 400)); // let every late event arrive
      const lists = watchers.map((w) => w.seen);
      console.log(mode, JSON.stringify(watchers.map((w) => w.full)));
      for (const l of lists) expect(l.length).toBeLessThanOrEqual(2);
      // Once a device is in the game it must not redraw into a different game screen (e.g. the same phone screen first
      // with no cards and then with its starting cards).
      for (const w of watchers) expect(w.full.filter((d) => / game/.test(d.split('|')[0])).length).toBeLessThanOrEqual(1);
    });
  }
});
