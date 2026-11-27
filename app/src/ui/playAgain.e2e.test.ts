// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { CONFIG, correctSlots, type Card, type GameSong } from '../logic';
import { createFakeBackend, memoryKV, type Backend } from '../net';
import { mountHost, type HostApp } from './host';
import type { ClipPlayer } from './hostGame';
import { mountPhone, type PhoneApp } from './phone';

// Play Again, as people see it: the host screen and the phones must leave the last game's screens and show a fresh game.
// Made-up songs only. Every title is unique, so a leftover result is easy to spot.
const POOL: GameSong[] = Array.from({ length: 40 }, (_, i) => ({
  id: `test-${String(i + 1).padStart(3, '0')}`,
  title: `Zanzibar Title ${i + 1}x`,
  artists: [`Plonk Collective ${i + 1}x`],
  featuredArtists: [],
  year: 1960 + ((i * 7) % 55),
  previewUrl: `https://audio.invalid/clip-${i + 1}.m4a`,
}));

const wait = async (n = 15) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
const until = async (fn: () => boolean, what: string) => {
  for (let i = 0; i < 400; i++) { if (fn()) return; await wait(2); }
  throw new Error(`timed out waiting for: ${what}`);
};
const q = <T extends Element = HTMLElement>(root: Element, sel: string) => root.querySelector<T>(sel);
const root = () => { const el = document.createElement('div'); document.body.append(el); return el; };
const fire = (el: Element, type: string) => el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
const stage = (el: Element) => q(el, '[data-stage]')?.getAttribute('data-stage') ?? '(none)';

function fakePlayer() {
  const played: string[] = [];
  const p: ClipPlayer = { play: async (u) => { played.push(u); }, stop: () => undefined, onError: () => undefined };
  return { p, played };
}

const NAMES = ['Ana', 'Ben', 'Cy'];

type Play = { hostRoot: HTMLElement; phones: HTMLElement[]; audio: { played: string[] }; rounds: number; label: string };

/** Every normal round, up to and including the last reveal (the host is on the reveal screen afterwards). */
async function playRounds({ hostRoot, phones, audio, rounds, label }: Play) {
  for (let r = 1; r <= rounds; r++) {
    const before = audio.played.length;
    q(hostRoot, '[data-action=next]')!.click();
    await until(() => stage(hostRoot) === 'listening' && audio.played.length === before + 1, `${label} round ${r} listening`);
    await until(() => phones.every((p) => stage(p) === 'answer'), `${label} round ${r} answer screens`);
    for (const [i, p] of phones.entries()) {
      for (let k = 0; k <= i; k++) q(p, '[data-step="1"]')!.click();
      q(p, '[data-action=lock]')!.click();
    }
    await until(() => stage(hostRoot) === 'reveal', `${label} round ${r} host reveal`);
    await until(() => phones.every((p) => stage(p) === 'result'), `${label} round ${r} phone results`);
  }
}

async function playClosestYearGame(play: Play) {
  const { hostRoot, phones, audio, label } = play;
  await playRounds(play);
  // Last reveal: "Final results", then the winner screen (a tie goes to sudden death, so keep playing those).
  for (let guard = 0; guard < 6 && stage(hostRoot) !== 'over'; guard++) {
    const btn = q(hostRoot, '[data-action=next]')!;
    const final = btn.textContent === 'Final results';
    const before = audio.played.length;
    btn.click();
    if (final) break;
    await until(() => stage(hostRoot) === 'listening' && audio.played.length === before + 1, `${label} sudden death listening`);
    await until(() => phones.every((p) => stage(p) === 'answer' || stage(p) === 'waiting'), `${label} sudden death phones`);
    for (const p of phones) { if (q(p, '[data-action=lock]')) q(p, '[data-action=lock]')!.click(); }
    await until(() => stage(hostRoot) === 'reveal', `${label} sudden death reveal`);
  }
  await until(() => stage(hostRoot) === 'over', `${label} host game over`);
  await until(() => phones.every((p) => q(p, '[data-winner]') !== null), `${label} winner on phones`);
}


async function playTimelineGame({ hostRoot, phones, audio, label }: { hostRoot: HTMLElement; phones: HTMLElement[]; audio: ReturnType<typeof fakePlayer>; label: string }) {
  for (let r = 1; r <= 8 && stage(hostRoot) !== 'over'; r++) {
    const before = audio.played.length;
    const btn = q(hostRoot, '[data-action=next]')!;
    btn.click();
    await until(() => stage(hostRoot) === 'listening' && audio.played.length === before + 1, `${label} round ${r} listening`);
    const song = POOL[Number(/clip-(\d+)\.m4a$/.exec(audio.played[before])![1]) - 1];
    await until(() => phones.every((p) => stage(p) === 'answer' || stage(p) === 'waiting'), `${label} round ${r} phones`);
    for (const [pi, p] of phones.entries()) {
      if (!q(p, '[data-action=lock]')) continue;
      if (!q(p, '[data-component=timeline-picker]')) { for (let k = 0; k <= pi * 3; k++) q(p, '[data-step="1"]')!.click(); q(p, '[data-action=lock]')!.click(); continue; } // sudden death
      const line: Card[] = [...q(p, '[data-component=timeline-picker]')!.querySelectorAll('[data-card-year]')]
        .map((c) => ({ year: Number(c.getAttribute('data-card-year')) }));
      q(p, `[data-slot="${correctSlots(line, song.year)[0]}"]`)!.click();
      q(p, '[data-action=lock]')!.click();
    }
    await until(() => stage(hostRoot) === 'reveal', `${label} round ${r} host reveal`);
    await until(() => phones.every((p) => stage(p) === 'result'), `${label} round ${r} phone results`);
    if (q(hostRoot, '[data-action=next]')!.textContent === 'Final results') {
      q(hostRoot, '[data-action=next]')!.click();
      await until(() => stage(hostRoot) === 'over', `${label} host game over`);
    }
  }
  expect(stage(hostRoot), `${label}: button says "${q(hostRoot, '[data-action=next]')?.textContent}"`).toBe('over');
  await until(() => phones.every((p) => q(p, '[data-winner]') !== null), `${label} winner on phones`);
}


describe('Play Again, host and phones (UI level, fake network)', () => {
  const apps: Array<{ stop(): Promise<void> }> = [];
  afterEach(async () => { for (const a of apps.splice(0)) await a.stop(); document.body.replaceChildren(); });

  async function setup(backend: Backend) {
    const audio = fakePlayer();
    const hostRoot = root();
    const mountOne = async () => {
      const h = await mountHost(hostRoot, {
        backend, kv, pageUrl: () => 'https://example.test/jukebox/', loadPool: async () => POOL, player: audio.p, rng: () => 0.5,
      });
      apps.push(h);
      return h as HostApp;
    };
    const kv = memoryKV();
    await mountOne();
    q(hostRoot, '[data-action=create]')!.click();
    await until(() => !!q(hostRoot, '[data-room-code]'), 'room code');
    const code = q(hostRoot, '[data-room-code]')!.getAttribute('data-room-code')!;
    const phones: HTMLElement[] = [];
    const phoneKvs = NAMES.map(() => memoryKV());
    for (const [i, name] of NAMES.entries()) {
      const r = root();
      apps.push(await mountPhone(r, { backend, kv: phoneKvs[i], initialCode: '' }) as PhoneApp);
      q<HTMLInputElement>(r, '#code')!.value = code;
      q<HTMLInputElement>(r, '#name')!.value = name;
      fire(q(r, 'form')!, 'submit');
      await until(() => !!q(r, '[data-you]'), `${name} joined`);
      phones.push(r);
    }
    await until(() => hostRoot.querySelectorAll('[data-player]').length === 3, 'three players on the host');
    return { hostRoot, phones, audio, code, phoneKvs, remountHost: mountOne };
  }

  /** Nothing from a finished game may be on screen: no winner, no answer, no reveal rows, no leaderboard. */
  function expectFresh(host: HTMLElement, phones: HTMLElement[]) {
    expect(stage(host)).toBe('between');
    for (const sel of ['[data-winner]', '[data-answer-year]', '.reveal-row', '.lb-row', '[data-action=play-again]']) {
      expect(q(host, sel), `host still shows ${sel}`).toBeNull();
    }
    expect(host.textContent).not.toContain('Zanzibar');
    for (const p of phones) {
      expect(stage(p)).toBe('waiting');
      for (const sel of ['[data-winner]', '[data-answer-year]', '[data-correct]', '[data-points]']) {
        expect(q(p, sel), `phone still shows ${sel}`).toBeNull();
      }
      expect(p.textContent).not.toContain('Zanzibar');
      expect(p.textContent).not.toContain('won');
    }
  }

  it('Closest Year: after Play Again the host and every phone show a fresh game, and it can be played again', async () => {
    const backend = createFakeBackend(Date.now());
    const { hostRoot, phones, audio, remountHost, phoneKvs } = await setup(backend);
    q(hostRoot, '[data-mode=closest_year]')!.click();
    await until(() => q(hostRoot, '[data-mode=closest_year]')!.classList.contains('on'), 'mode switched');
    await until(() => !(q<HTMLButtonElement>(hostRoot, '[data-action=start]')!.disabled), 'start enabled');
    const rounds = Number(q(hostRoot, '[data-setting=rounds] .stepper-value')!.textContent);

    const playGame = (label: string) => playClosestYearGame({ hostRoot, phones, audio, rounds, label });

    q(hostRoot, '[data-action=start]')!.click();
    await until(() => stage(hostRoot) === 'between', 'host between rounds');
    await playGame('game 1');

    for (const again of [1, 2]) {
      q(hostRoot, '[data-action=play-again]')!.click();
      await until(() => stage(hostRoot) === 'between', `play again #${again}: host leaves the game-over screen`);
      await until(() => phones.every((p) => stage(p) === 'waiting'), `play again #${again}: phones leave the results`);
      expectFresh(hostRoot, phones);
      if (again === 2) break;
      await playGame(`game ${again + 1}`);
    }

    // A host refresh mid-new-game keeps the fresh screen too.
    await remountHost();
    await until(() => stage(hostRoot) === 'between', 'host back after a refresh');
    expectFresh(hostRoot, phones);

    // A phone refresh (same browser storage) lands on the fresh waiting screen, not the old results.
    const again = root();
    apps.push(await mountPhone(again, { backend, kv: phoneKvs[0], initialCode: '' }) as PhoneApp);
    await until(() => stage(again) === 'waiting', 'phone back after a refresh');
    expectFresh(hostRoot, [again]);
  });

  it('opening the host page after a finished game shows a fresh game, not the old winner screen', async () => {
    const backend = createFakeBackend(Date.now());
    const { hostRoot, phones, audio, remountHost, code } = await setup(backend);
    q(hostRoot, '[data-mode=closest_year]')!.click();
    await until(() => q(hostRoot, '[data-mode=closest_year]')!.classList.contains('on'), 'mode switched');
    await until(() => !(q<HTMLButtonElement>(hostRoot, '[data-action=start]')!.disabled), 'start enabled');
    const rounds = Number(q(hostRoot, '[data-setting=rounds] .stepper-value')!.textContent);
    q(hostRoot, '[data-action=start]')!.click();
    await until(() => stage(hostRoot) === 'between', 'host between rounds');
    await playClosestYearGame({ hostRoot, phones, audio, rounds, label: 'finished game' });

    // The host closes the tab and opens the host page again (same browser storage, same room).
    await remountHost();
    await until(() => !!q(hostRoot, '[data-action=start]'), 'host page opens on a fresh lobby');
    expect(q(hostRoot, '[data-room-code]')!.getAttribute('data-room-code')).toBe(code); // same room, players keep their seats
    expect(hostRoot.querySelectorAll('[data-player]').length).toBe(3);
    for (const sel of ['[data-winner]', '[data-answer-year]', '.reveal-row', '.lb-row', '[data-action=play-again]']) {
      expect(q(hostRoot, sel), `host still shows ${sel}`).toBeNull();
    }
    expect(hostRoot.textContent).not.toContain('Zanzibar');
    await until(() => phones.every((p) => stage(p) === 'waiting'), 'phones leave the old results');
    for (const p of phones) expect(q(p, '[data-winner]')).toBeNull();
  });

  it('Timeline: after Play Again the host and every phone show a fresh game, and it can be played again', async () => {
    const backend = createFakeBackend(Date.now());
    const { hostRoot, phones, audio } = await setup(backend);
    expect(q(hostRoot, '[data-mode=timeline]')!.classList.contains('on')).toBe(true);
    for (let want = 11; want >= 4; want--) {
      q(hostRoot, '[aria-label="Less: Cards to win"]')!.click();
      await until(() => q(hostRoot, '[data-setting=targetCards] .stepper-value')!.textContent === String(want), `target ${want}`);
      await wait(20);
    }
    await until(() => !(q<HTMLButtonElement>(hostRoot, '[data-action=start]')!.disabled), 'start enabled');

    const playGame = (label: string) => playTimelineGame({ hostRoot, phones, audio, label });

    q(hostRoot, '[data-action=start]')!.click();
    await until(() => stage(hostRoot) === 'between', 'host between rounds');
    await playGame('game 1');
    for (const again of [1, 2]) {
      q(hostRoot, '[data-action=play-again]')!.click();
      await until(() => stage(hostRoot) === 'between', `play again #${again}: host leaves the game-over screen`);
      await until(() => phones.every((p) => stage(p) === 'waiting'), `play again #${again}: phones leave the results`);
      expectFresh(hostRoot, phones);
      for (const p of phones) expect(q(p, '[data-cards]')!.getAttribute('data-cards')).toBe('2'); // fresh starting timelines
      if (again === 2) break;
      await playGame(`game ${again + 1}`);
    }
  });

  it('Closest Year: Back to lobby, change a setting, Start gives a brand-new game, never the finished one', async () => {
    const backend = createFakeBackend(Date.now());
    const { hostRoot, phones, audio } = await setup(backend);
    q(hostRoot, '[data-mode=closest_year]')!.click();
    await until(() => q(hostRoot, '[data-mode=closest_year]')!.classList.contains('on'), 'mode switched');
    await until(() => !(q<HTMLButtonElement>(hostRoot, '[data-action=start]')!.disabled), 'start enabled');
    const rounds = Number(q(hostRoot, '[data-setting=rounds] .stepper-value')!.textContent);
    q(hostRoot, '[data-action=start]')!.click();
    await until(() => stage(hostRoot) === 'between', 'host between rounds');
    await playClosestYearGame({ hostRoot, phones, audio, rounds, label: 'finished game' });

    q(hostRoot, '[data-action=back-to-lobby]')!.click();
    await until(() => !!q(hostRoot, '[data-action=start]'), 'lobby');
    await until(() => phones.every((p) => stage(p) === 'waiting'), 'phones wait in the lobby');
    q(hostRoot, '[aria-label="Less: Rounds"]')!.click();
    await until(() => q(hostRoot, '[data-setting=rounds] .stepper-value')!.textContent === String(rounds - 1), 'rounds changed');
    q(hostRoot, '[data-action=start]')!.click();
    await until(() => !q(hostRoot, '[data-action=start]'), 'host left the lobby');
    await until(() => stage(hostRoot) === 'between', 'a new game, waiting for its first song');
    expectFresh(hostRoot, phones);
    expect(q(hostRoot, '[data-action=next]')?.textContent).not.toBe('Final results');

    // ...and the new game really is playable, with the new round count.
    const rounds2 = rounds - 1;
    await playClosestYearGame({ hostRoot, phones, audio, rounds: rounds2, label: 'second game' });
    expect(stage(hostRoot)).toBe('over');
  });

  it('Timeline: Back to lobby, change a setting, Start gives fresh starting cards, never the finished game', async () => {
    const backend = createFakeBackend(Date.now());
    const { hostRoot, phones, audio } = await setup(backend);
    for (let want = 11; want >= 4; want--) {
      q(hostRoot, '[aria-label="Less: Cards to win"]')!.click();
      await until(() => q(hostRoot, '[data-setting=targetCards] .stepper-value')!.textContent === String(want), `target ${want}`);
      await wait(20);
    }
    await until(() => !(q<HTMLButtonElement>(hostRoot, '[data-action=start]')!.disabled), 'start enabled');
    q(hostRoot, '[data-action=start]')!.click();
    await until(() => stage(hostRoot) === 'between', 'host between rounds');
    await playTimelineGame({ hostRoot, phones, audio, label: 'finished game' });

    q(hostRoot, '[data-action=back-to-lobby]')!.click();
    await until(() => !!q(hostRoot, '[data-action=start]'), 'lobby');
    await until(() => phones.every((p) => stage(p) === 'waiting'), 'phones wait in the lobby');
    q(hostRoot, '[aria-label="More: Cards to win"]')!.click();
    await until(() => q(hostRoot, '[data-setting=targetCards] .stepper-value')!.textContent === '5', 'target changed');
    await wait(20);
    q(hostRoot, '[data-action=start]')!.click();
    await until(() => !q(hostRoot, '[data-action=start]') && stage(hostRoot) === 'between', 'a new game, waiting for its first song');
    expectFresh(hostRoot, phones);
    for (const p of phones) expect(q(p, '[data-cards]')!.getAttribute('data-cards')).toBe('2');
  });
});

// A page must never stay frozen on the last game: lost realtime events, failed reads and hung requests all recover.
describe('Play Again survives a bad network (UI level)', () => {
  const apps: Array<{ stop(): Promise<void> }> = [];
  const saved = { ...CONFIG.net };
  afterEach(async () => {
    for (const a of apps.splice(0)) await a.stop();
    document.body.replaceChildren();
    Object.assign(CONFIG.net, saved);
  });

  /** A backend with switches: silence realtime, fail reads, or hang one kind of call. */
  function flaky() {
    const inner = createFakeBackend(Date.now());
    const sw = { mute: false, failReads: 0, hang: '' as '' | 'hostNewGame', failOver: false, blocked: 0 };
    const b: Backend = {
      ...inner,
      subscribe: (roomId, onChange) => inner.subscribe(roomId, (c) => { if (!sw.mute) onChange(c); }),
      hostGetState: async (...a) => { if (sw.failReads > 0) { sw.failReads--; throw new Error('offline'); } return inner.hostGetState(...a); },
      getMyState: async (...a) => { if (sw.failReads > 0) { sw.failReads--; throw new Error('offline'); } return inner.getMyState(...a); },
      hostUpdateRoom: async (id, tok, patch) => {
        if (sw.failOver && patch.status === 'over') { sw.blocked++; throw new Error('offline'); } // the winner is never recorded
        return inner.hostUpdateRoom(id, tok, patch);
      },
      hostNewGame: (...a) => (sw.hang === 'hostNewGame' ? new Promise<never>(() => undefined) : inner.hostNewGame(...a)),
    };
    return { b, sw };
  }

  async function lobbyGame(b: Backend) {
    const audio = fakePlayer();
    const hostRoot = root();
    const kv = memoryKV();
    const mountOne = async () => {
      const h = await mountHost(hostRoot, { backend: b, kv, pageUrl: () => 'https://example.test/jukebox/', loadPool: async () => POOL, player: audio.p, rng: () => 0.5 });
      apps.push(h);
      return h;
    };
    await mountOne();
    q(hostRoot, '[data-action=create]')!.click();
    await until(() => !!q(hostRoot, '[data-room-code]'), 'room code');
    const code = q(hostRoot, '[data-room-code]')!.getAttribute('data-room-code')!;
    const phones: HTMLElement[] = [];
    for (const name of NAMES) {
      const r = root();
      apps.push(await mountPhone(r, { backend: b, kv: memoryKV(), initialCode: '' }));
      q<HTMLInputElement>(r, '#code')!.value = code;
      q<HTMLInputElement>(r, '#name')!.value = name;
      fire(q(r, 'form')!, 'submit');
      await until(() => !!q(r, '[data-you]'), `${name} joined`);
      phones.push(r);
    }
    await until(() => hostRoot.querySelectorAll('[data-player]').length === 3, 'three players on the host');
    q(hostRoot, '[data-mode=closest_year]')!.click();
    await until(() => q(hostRoot, '[data-mode=closest_year]')!.classList.contains('on'), 'mode switched');
    await until(() => !(q<HTMLButtonElement>(hostRoot, '[data-action=start]')!.disabled), 'start enabled');
    const rounds = Number(q(hostRoot, '[data-setting=rounds] .stepper-value')!.textContent);
    q(hostRoot, '[data-action=start]')!.click();
    await until(() => stage(hostRoot) === 'between', 'host between rounds');
    return { hostRoot, phones, audio, rounds, remountHost: mountOne };
  }

  async function finishedGame(b: Backend) {
    const g = await lobbyGame(b);
    await playClosestYearGame({ ...g, label: 'game 1' });
    return { hostRoot: g.hostRoot, phones: g.phones };
  }

  const fresh = (hostRoot: HTMLElement, phones: HTMLElement[]) =>
    stage(hostRoot) === 'between' && phones.every((p) => stage(p) === 'waiting');

  it('realtime goes silent during Play Again: the screens still leave the old game (periodic re-read)', async () => {
    CONFIG.net.resyncSeconds = 0.05;
    const { b, sw } = flaky();
    const { hostRoot, phones } = await finishedGame(b);
    sw.mute = true; // the websocket is down; nobody hears about anything
    q(hostRoot, '[data-action=play-again]')!.click();
    await until(() => fresh(hostRoot, phones), 'host and phones leave the finished game without any realtime event');
    sw.mute = false;
    expect(hostRoot.textContent).not.toContain('Zanzibar');
  });

  it('reads fail right after Play Again: the screens retry instead of staying on the old results', async () => {
    CONFIG.net.retrySeconds = 0.05;
    CONFIG.net.resyncSeconds = 0.05;
    const { b, sw } = flaky();
    const { hostRoot, phones } = await finishedGame(b);
    sw.failReads = 6; // the next few state reads (host and phones) fail
    q(hostRoot, '[data-action=play-again]')!.click();
    await until(() => fresh(hostRoot, phones), 'screens recover after failed reads');
  });

  it('Play Again request never answers: it gives up, says so, and the button works again', async () => {
    CONFIG.net.actionTimeoutSeconds = 0.1;
    const { b, sw } = flaky();
    const { hostRoot, phones } = await finishedGame(b);
    sw.hang = 'hostNewGame';
    q(hostRoot, '[data-action=play-again]')!.click();
    await until(() => (hostRoot.textContent ?? '').includes('That did not work'), 'a notice instead of a silent hang');
    expect(stage(hostRoot)).toBe('over');
    sw.hang = '';
    q(hostRoot, '[data-action=play-again]')!.click();
    await until(() => fresh(hostRoot, phones), 'second try works');
  });
  // The reveal and the room's outcome are two writes. If the second never lands, the host sits on a "winner" reveal while the
  // room is still playing, and "Final results" used to do nothing at all.
  describe('the winner was revealed but never recorded', () => {
    async function stuck() {
      CONFIG.net.retrySeconds = 60; // keep the background retry out of the way: these tests drive the recovery themselves
      const { b, sw } = flaky();
      const g = await lobbyGame(b);
      sw.failOver = true;
      await playRounds({ ...g, label: 'stuck game' });
      await until(() => q(g.hostRoot, '[data-action=next]')?.textContent === 'Final results', 'final reveal on the host');
      expect(sw.blocked).toBeGreaterThan(0); // the room really was left playing
      return { ...g, b, sw };
    }
    it('"Final results" repairs the room and shows the winner (it used to do nothing)', async () => {
      const { hostRoot, phones, sw } = await stuck();
      sw.failOver = false; // the network is back
      q(hostRoot, '[data-action=next]')!.click();
      await until(() => stage(hostRoot) === 'over', 'winner screen after Final results');
      expect(q(hostRoot, '[data-winner]')).not.toBeNull();
      expect(q(hostRoot, '[data-action=play-again]')).not.toBeNull();
      await until(() => phones.every((p) => q(p, '[data-winner]') !== null), 'winner on phones');
    });

    it('opening the host page again repairs it on its own, and Play Again then works', async () => {
      const { hostRoot, phones, sw, remountHost } = await stuck();
      sw.failOver = false;
      await remountHost();
      // the phones only show a winner once the room itself is over, so this proves the page repaired the room by itself
      await until(() => phones.every((p) => q(p, '[data-winner]') !== null), 'winner on phones');
      // the page is not frozen: the winner screen's own button works
      await until(() => q(hostRoot, '[data-action=next]')?.textContent === 'Final results', 'Final results offered');
      q(hostRoot, '[data-action=next]')!.click();
      await until(() => stage(hostRoot) === 'over', 'winner screen');
      await until(() => !!q(hostRoot, '[data-action=play-again]'), 'Play Again offered');
      q(hostRoot, '[data-action=play-again]')!.click();
      await until(() => fresh(hostRoot, phones), 'a fresh game after Play Again');
    });

    it('still offline: the button says so instead of doing nothing, and works once the network is back', async () => {
      CONFIG.net.actionTimeoutSeconds = 0.5;
      const { hostRoot, sw } = await stuck();
      q(hostRoot, '[data-action=next]')!.click();
      await until(() => (hostRoot.textContent ?? '').includes('That did not work'), 'a notice while offline');
      expect(stage(hostRoot)).toBe('reveal');
      sw.failOver = false;
      q(hostRoot, '[data-action=next]')!.click();
      await until(() => stage(hostRoot) === 'over', 'winner screen once the network is back');
    });
  });
});
