// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { scriptOf, watchForNewVersion } from './staleApp';

const page = (js: string) => `<script type="module" crossorigin src="/jukebox/assets/${js}"></script>`;

describe('stale tab check', () => {
  it('finds the script name', () => {
    expect(scriptOf(page('index-abc123.js'))).toBe('assets/index-abc123.js');
    expect(scriptOf('<html></html>')).toBeNull();
  });
  it('reloads when the live page names a newer script, and not when it matches', async () => {
    let reloads = 0;
    let live = page('index-old.js');
    const w = watchForNewVersion({ everySeconds: 3600, reload: () => { reloads++; }, fetchHtml: async () => live, running: () => 'assets/index-old.js' });
    await w.check();
    expect(reloads).toBe(0);
    live = page('index-new.js');
    await w.check();
    expect(reloads).toBe(1);
    w.stop();
  });
  it('does nothing offline or in dev', async () => {
    let reloads = 0;
    const off = watchForNewVersion({ everySeconds: 3600, reload: () => { reloads++; }, fetchHtml: async () => { throw new Error('offline'); }, running: () => 'assets/index-old.js' });
    await off.check();
    const dev = watchForNewVersion({ everySeconds: 3600, reload: () => { reloads++; }, fetchHtml: async () => page('index-new.js'), running: () => null });
    await dev.check();
    expect(reloads).toBe(0);
    off.stop(); dev.stop();
  });
});
