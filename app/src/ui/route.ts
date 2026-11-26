import { cleanRoomCode } from '../logic';

export type Route = { page: 'host' } | { page: 'phone'; code: string };

/**
 * Hash routing, because the site is static files on GitHub Pages (no server rewrites):
 *   #/host         the big screen
 *   #/join/ABCD    a phone, with the code filled in (this is what the QR code opens)
 *   anything else  a phone with an empty code box
 */
export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'host') return { page: 'host' };
  if (parts[0] === 'join' && parts[1]) return { page: 'phone', code: cleanRoomCode(decodeURIComponent(parts[1])) };
  return { page: 'phone', code: '' };
}

/** The address a phone opens to join this room (same site and path as the host page). */
export function joinUrl(pageUrl: string, code: string): string {
  const u = new URL(pageUrl);
  u.search = '';
  u.hash = `#/join/${code}`;
  return u.toString();
}

/** The same address without the code, for "go to ..." text. Shown without the scheme to be easy to read out. */
export function joinAddressText(pageUrl: string): string {
  const u = new URL(pageUrl);
  return `${u.host}${u.pathname}`.replace(/\/$/, '');
}
