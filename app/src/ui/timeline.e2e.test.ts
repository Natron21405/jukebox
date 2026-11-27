// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { correctSlots, type Card, type GameSong } from '../logic';
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
  for (let i = 0; i < 300; i++) { if (fn()) return; await wait(2); }
  const seen = [...document.body.querySelectorAll('.stepper-value')].map((e) => e.textContent).join(',');
  throw new Error(`timed out waiting for: ${what} (steppers: ${seen})`);
};
const q = <T extends Element = HTMLElement>(root: Element, sel: string) => root.querySelector<T>(sel);
const root = () => { const el = document.createElement('div'); document.body.append(el); return el; };
const fire = (el: Element, type: string) => el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));

function fakePlayer() {
  const played: string[] = [];
  const p: ClipPlayer = { play: async (u) => { played.push(u); }, stop: () => undefined, onError: () => undefined };
  return { p, played };
}

describe('Timeline, end to end (host + 3 phones, fake network and fake audio)', () => {
  const apps: Array<{ stop(): Promise<void> }> = [];
  afterEach(async () => { for (const a of apps.splice(0)) await a.stop(); document.body.replaceChildren(); });

  it('plays two full rounds to a win: placements, a miss, artist hits, tie-break, final screens', async () => {
    const backend = createFakeBackend(Date.now());
    const audio = fakePlayer();
    const hostRoot = root();
    const host: HostApp = await mountHost(hostRoot, {
      backend, kv: memoryKV(), pageUrl: () => 'https://example.test/jukebox/',
      loadPool: async () => POOL, player: audio.p, rng: () => 0.5,
    });
    apps.push(host);
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

    // Timeline is the default mode. Shorten the game: 4 cards to win (two correct placements from the two starting cards).
    expect(q(hostRoot, '[data-mode=timeline]')!.classList.contains('on')).toBe(true);
    for (let want = 11; want >= 4; want--) {
      q(hostRoot, '[aria-label="Less: Cards to win"]')!.click();
      await until(() => q(hostRoot, '[data-setting=targetCards] .stepper-value')!.textContent === String(want), `target ${want}`);
      await wait(20); // let the lobby settle, as a person tapping would
    }
    await until(() => !(q<HTMLButtonElement>(hostRoot, '[data-action=start]')!.disabled), 'start enabled');
    q(hostRoot, '[data-action=start]')!.click();
    await until(() => q(hostRoot, '[data-stage=between]') !== null, 'host between rounds');
    await until(() => phones.every((p) => q(p, '[data-stage=waiting]') !== null), 'phones waiting');
    for (const p of phones) {
      expect(q(p, '[data-cards]')!.getAttribute('data-cards')).toBe('2'); // two starting cards each
      expect(p.querySelectorAll('[data-card-year]').length).toBe(2);
    }
    // The host shows card counts out of the target, not what is in anyone's timeline.
    expect(hostRoot.querySelectorAll('.tl-board [data-cards="2"]').length).toBe(3);
    expect(q(hostRoot, '.tl-board .sb-score')!.textContent).toBe('2/4');

    /** Plays one round. `miss` names a player who deliberately picks a wrong gap; Ana types the right artist. */
    async function playRound(roundNo: number, miss: string | null) {
      const before = audio.played.length;
      q(hostRoot, '[data-action=next]')!.click();
      await until(() => q(hostRoot, '[data-stage=listening]') !== null && audio.played.length === before + 1, `round ${roundNo} listening`);
      const n = Number(/clip-(\d+)\.m4a$/.exec(audio.played[before])![1]);
      const song = POOL[n - 1];
      await until(() => phones.every((p) => q(p, '[data-stage=answer]') !== null), `round ${roundNo} answer screens`);
      expect(q(hostRoot, '[data-progress]')!.textContent).toBe('0 of 3 locked in');
      expect(hostRoot.querySelectorAll('[data-card-year]').length).toBe(0); // no timeline contents on the big screen

      const expectedCards: number[] = [];
      for (let i = 0; i < 3; i++) {
        const p = phones[i];
        expect(p.textContent).not.toContain('Test Song'); // nothing about the song reaches a phone before the reveal
        expect(p.textContent).not.toContain('Fake Band');
        const line: Card[] = [...q(p, '[data-component=timeline-picker]')!.querySelectorAll('[data-card-year]')]
          .map((c) => ({ year: Number(c.getAttribute('data-card-year')) }));
        expect(line.map((c) => c.year)).toEqual([...line.map((c) => c.year)].sort((a, b) => a - b)); // ordered
        expect(p.querySelectorAll('[data-slot]').length).toBe(line.length + 1);
        expectedCards.push(line.length);
        const good = correctSlots(line, song.year);
        const bad = Array.from({ length: line.length + 1 }, (_, s) => s).find((s) => !good.includes(s));
        const wrong = names[i] === miss;
        const pick = wrong ? bad : good[0];
        if (wrong && pick === undefined) throw new Error('no wrong gap available');
        // Change of mind before locking: tap a gap, then the one we mean.
        const other = (pick! + 1) % (line.length + 1);
        q(p, `[data-slot="${other}"]`)!.click();
        expect(q(p, `[data-slot="${other}"]`)!.classList.contains('chosen')).toBe(true);
        q(p, `[data-slot="${pick}"]`)!.click();
        expect(q(p, `[data-slot="${other}"]`)!.classList.contains('chosen')).toBe(false);
        expect(q(p, `[data-slot="${pick}"]`)!.classList.contains('chosen')).toBe(true);
        q<HTMLInputElement>(p, '[data-role=artist]')!.value = i === 0 ? `fake band ${n}` : 'someone else';
        fire(q(p, '[data-role=artist]')!, 'input');
        q(p, '[data-action=lock]')!.click();
        if (i < 2) {
          await until(() => q(p, '[data-stage=locked]') !== null, `phone ${i} locked`);
          expect(q(p, '[data-action=lock]')).toBeNull(); // locked: nothing left to change
          expect(q(p, '[data-slot]')).toBeNull();
        }
      }

      // Everyone locked in: the host reveals by itself.
      await until(() => q(hostRoot, '[data-stage=reveal]') !== null, `round ${roundNo} host reveal`);
      expect(Number(q(hostRoot, '[data-answer-year]')!.getAttribute('data-answer-year'))).toBe(song.year);
      expect(hostRoot.textContent).toContain(song.title);
      expect(hostRoot.querySelectorAll('.lb-row').length).toBe(3);
      expect(q(hostRoot, '.scoreboard')).toBeNull();
      for (let i = 0; i < 3; i++) {
        const row = q(hostRoot, `.lb-row[data-player=${names[i]}]`)!;
        const right = names[i] !== miss;
        expect(q(row, '[data-mark=placement]')!.getAttribute('data-ok')).toBe(String(right));
        expect(row.getAttribute('data-total')).toBe(String(expectedCards[i] + (right ? 1 : 0)));
      }
      expect(q(hostRoot, '[data-placed-count]')!.getAttribute('data-placed-count')).toBe(String(miss ? 2 : 3));
      expect(q(hostRoot, '.lb-row[data-player=Ana] [data-mark=artist]')!.getAttribute('data-ok')).toBe('true');
      expect(q(hostRoot, '.reveal-row[data-player=Ana] [data-artist-hit]')!.getAttribute('data-artist-hit')).toBe('true');
      expect(q(hostRoot, '.lb-row[data-player=Ben] [data-mark=artist]')!.getAttribute('data-ok')).toBe('false');

      // Phones: result feedback, the right year, and the new card highlighted for those who placed it.
      await until(() => phones.every((p) => q(p, '[data-stage=result]') !== null), `round ${roundNo} phone results`);
      for (let i = 0; i < 3; i++) {
        const p = phones[i];
        const right = names[i] !== miss;
        expect(q(p, '[data-answer-year]')!.getAttribute('data-answer-year')).toBe(String(song.year));
        expect(q(p, '[data-correct]')!.getAttribute('data-correct')).toBe(String(right));
        expect(p.querySelectorAll('.tl-card.newest').length).toBe(right ? 1 : 0);
        expect(p.querySelectorAll('[data-card-year]').length).toBe(expectedCards[i] + (right ? 1 : 0));
        expect(q(p, '[data-artist-hit]')!.getAttribute('data-artist-hit')).toBe(i === 0 ? 'true' : 'false');
      }
    }

    // Round 1: Cy misses and gains no card. Round 2: everyone places it, so Ana and Ben both reach 4 cards.
    await playRound(1, 'Cy');
    expect(q(hostRoot, '.lb-row[data-player=Cy]')!.getAttribute('data-total')).toBe('2');
    expect(q(hostRoot, '[data-action=next]')!.textContent).toBe('Next song');
    await playRound(2, null);

    // Ana and Ben tie on cards; Ana has two artist hits to Ben's none, so Ana wins.
    expect(q(hostRoot, '[data-action=next]')!.textContent).toBe('Final results');
    q(hostRoot, '[data-action=next]')!.click();
    await until(() => q(hostRoot, '[data-stage=over]') !== null, 'host game over');
    expect(q(hostRoot, '[data-winner]')!.getAttribute('data-winner')).toBe('Ana');
    expect(q(hostRoot, '.tl-board [data-player=Ana]')!.getAttribute('data-cards')).toBe('4');
    expect(q(hostRoot, '.tl-board [data-player=Cy]')!.getAttribute('data-cards')).toBe('3');
    expect(q(hostRoot, '[data-action=play-again]')).not.toBeNull();
    expect(q(hostRoot, '[data-room-code]')!.getAttribute('data-room-code')).toBe(code); // the room code stays visible
    await until(() => q(phones[0], '[data-winner]') !== null, 'winner on a phone');
    expect(q(phones[0], '[data-winner]')!.getAttribute('data-winner')).toBe('Ana');
    expect(phones[0].textContent).toContain('You won!');
    expect(phones[1].textContent).toContain('Ana wins');
  });
});
