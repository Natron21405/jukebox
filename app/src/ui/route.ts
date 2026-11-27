import { cleanRoomCode } from '../logic';

export type Route = { page: 'home' } | { page: 'host' } | { page: 'phone'; code: string };

function safeDecode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

/**
 * Hash routing, because the site is static files on GitHub Pages (no server rewrites):
 *   (empty), #/   the home page: what the game is, and a choice between hosting and joining
 *   #/host         the host page (the big screen): every visit starts a brand new game; nothing is remembered
 *   #/join         the join page (a phone), with an empty code box
 *   #/join/ABCD    the join page with the code filled in (this is what the QR code opens)
 *   anything else  the home page
 */
export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'host') return { page: 'host' };
  if (parts[0] === 'join') return { page: 'phone', code: parts[1] ? cleanRoomCode(safeDecode(parts[1])) : '' };
  return { page: 'home' };
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

/** Hash links for moving between the pages. */
export const HOME_HASH = '#/';
export const HOST_HASH = '#/host';
export const JOIN_HASH = '#/join';
