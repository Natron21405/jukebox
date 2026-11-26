// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import type { GameSong } from '../logic';
import { createFakeBackend, memoryKV } from '../net';
import { mountHost, type HostApp } from './host';
import type { ClipPlayer } from './hostGame';
import { mountPhone, type PhoneApp } from './phone';

// Made-up songs only.
const POOL: GameSong[] = Array.from({ length: 12 }, (_, i) => ({
  id: `test-${String(i + 1).padStart(3, '0')}`,
  title: `Test Song ${i + 1}`,
  artists: [`Fake Band ${i + 1}`],
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

function fakePlayer() {
  const played: string[] = [];
  const p: ClipPlayer = { play: async (u) => { played.push(u); }, stop: () => undefined, onError: () => undefined };
  return { p, played };
}

describe('one Closest Year round, end to end (host + 3 phones, fake network and fake audio)', () => {
  const apps: Array<{ stop(): Promise<void> }> = [];
  afterEach(async () => { for (const a of apps.splice(0)) await a.stop(); document.body.replaceChildren(); });

  it('plays a round: clip, answers, auto-end, reveal, override, next song', async () => {
    const backend = createFakeBackend(Date.now()); // fake clock starts at the real time, so the round timer is in the future
    const audio = fakePlayer();
    const hostRoot = root();
    const host: HostApp = await mountHost(hostRoot, {
      backend, kv: memoryKV(), pageUrl: () => 'https://example.test/jukebox/',
      loadPool: async () => POOL, player: audio.p, rng: () => 0.5,
    });
    apps.push(host);
    q(hostRoot, '[data-action=create]')!.click();
    await until(() => !!q(hostRoot, '[data-room-code]'), 'room code');
    const code = q(hostRoot, '[data-room-code]')!.getAttribute('data-room-code')!;

    const names = ['Ana', 'Ben', 'Cy'];
    const phones: HTMLElement[] = [];
    for (const name of names) {
      const r = root();
      apps.push(await mountPhone(r, { backend, kv: memoryKV(), initialCode: '' }) as PhoneApp);
      q<HTMLInputElement>(r, '#code')!.value = code;
      q<HTMLInputElement>(r, '#name')!.value = name;
      fire(q(r, 'form')!, 'submit');
      await until(() => !!q(r, '[data-you]'), `${name} joined`);
      phones.push(r);
    }
    await until(() => hostRoot.querySelectorAll('[data-player]').length === 3, 'three players on the host');

    // Choose Closest Year, start.
    q(hostRoot, '[data-mode=closest_year]')!.click();
    await until(() => q(hostRoot, '[data-mode=closest_year]')!.classList.contains('on'), 'mode switched');
    await until(() => !(q<HTMLButtonElement>(hostRoot, '[data-action=start]')!.disabled), 'start enabled');
    q(hostRoot, '[data-action=start]')!.click();
    await until(() => q(hostRoot, '[data-stage=between]') !== null, 'host between rounds');
    await until(() => phones.every((p) => q(p, '[data-stage=waiting]') !== null), 'phones waiting');

    // Host starts the first song: clip plays on the host only, phones get the picker.
    q(hostRoot, '[data-action=next]')!.click();
    await until(() => q(hostRoot, '[data-stage=listening]') !== null, 'listening');
    await until(() => audio.played.length === 1, 'clip streamed from its URL');
    expect(audio.played[0]).toMatch(/^https:\/\/audio\.invalid\//);
    await until(() => phones.every((p) => q(p, '[data-stage=answer]') !== null), 'answer screens');
    for (const p of phones) {
      expect(q(p, '[data-component=year-picker]')).not.toBeNull();
      expect(p.textContent).not.toContain('Test Song'); // nothing about the song reaches a phone before the reveal
      expect(p.textContent).not.toContain('Fake Band');
      expect(q(p, '.year-readout')!.textContent).toBe('1988'); // neutral start, the same on every phone
    }
    expect(q(hostRoot, '[data-progress]')!.textContent).toBe('0 of 3 locked in');

    // Phones answer: nudge the year with the + button, type an artist, lock in.
    const guesses = [1, 2, 3];
    for (let i = 0; i < 3; i++) {
      const p = phones[i];
      for (let k = 0; k < guesses[i]; k++) q(p, '[data-step="1"]')!.click();
      expect(q(p, '.year-readout')!.textContent).toBe(String(1988 + guesses[i]));
      q<HTMLInputElement>(p, '[data-role=artist]')!.value = i === 0 ? 'fake band 1' : 'someone else';
      fire(q(p, '[data-role=artist]')!, 'input');
      q(p, '[data-action=lock]')!.click();
      if (i < 2) {
        await until(() => q(p, '[data-stage=locked]') !== null, `phone ${i} locked`);
        expect(q(p, '[data-locked-year]')!.getAttribute('data-locked-year')).toBe(String(1988 + guesses[i]));
        expect(q(p, '[data-action=lock]')).toBeNull(); // locked: nothing left to press
      }
    }

    // Everyone locked in: the host reveals by itself.
    await until(() => q(hostRoot, '[data-stage=reveal]') !== null, 'host reveal');
    const year = Number(q(hostRoot, '[data-answer-year]')!.getAttribute('data-answer-year'));
    expect(POOL.map((s) => s.year)).toContain(year);
    expect(hostRoot.querySelectorAll('.reveal-row').length).toBe(3);
    expect(q(hostRoot, '[data-scoreboard]')!.getAttribute('data-scoreboard')).toBe('3');
    await until(() => phones.every((p) => q(p, '[data-stage=result]') !== null), 'phone results');
    for (const p of phones) expect(q(p, '[data-answer-year]')!.getAttribute('data-answer-year')).toBe(String(year));
    const song = POOL.find((s) => s.year === year)!;
    expect(hostRoot.textContent).toContain(song.title);

    // Borderline artist control: reject, then count, one player's typed guess.
    const row = q(hostRoot, '.reveal-row[data-player=Cy]')!;
    const before = Number(row.getAttribute('data-total'));
    q(row, '[data-override=true]')!.click();
    await until(() => Number(q(hostRoot, '.reveal-row[data-player=Cy]')!.getAttribute('data-total')) === before + 2, 'override counted (+2)');
    expect(Number(q(hostRoot, '.score-row[data-player=Cy]')!.getAttribute('data-score'))).toBe(before + 2);
    await until(() => q(phones[2], '[data-points]')?.getAttribute('data-points') === String(before + 2), 'phone sees the override');

    // Next song starts a fresh round and a different clip.
    q(hostRoot, '[data-action=next]')!.click();
    await until(() => audio.played.length === 2 && q(hostRoot, '[data-stage=listening]') !== null, 'second clip');
    expect(audio.played[1]).not.toBe(audio.played[0]);
    await until(() => phones.every((p) => q(p, '[data-stage=answer]') !== null), 'second answer screens');
    expect(q(phones[0], '.year-readout')!.textContent).toBe('1989'); // starts from this player's last guess
  });
});
