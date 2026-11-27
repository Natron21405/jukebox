// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { mountHome } from './home';
import { HOST_HASH, JOIN_HASH, parseRoute } from './route';

describe('home page', () => {
  afterEach(() => document.body.replaceChildren());

  it('introduces the game and offers one link to host and one to join', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const app = mountHome(root);
    expect(root.querySelector('[data-page=home]')).not.toBeNull();
    const host = root.querySelector<HTMLAnchorElement>('[data-action=go-host]')!;
    const join = root.querySelector<HTMLAnchorElement>('[data-action=go-join]')!;
    expect(host.getAttribute('href')).toBe(HOST_HASH);
    expect(join.getAttribute('href')).toBe(JOIN_HASH);
    expect(parseRoute(host.getAttribute('href')!)).toEqual({ page: 'host' });
    expect(parseRoute(join.getAttribute('href')!)).toEqual({ page: 'phone', code: '' });
    expect(root.querySelectorAll('.steps li').length).toBeGreaterThan(0);
    await app.stop();
  });
});
