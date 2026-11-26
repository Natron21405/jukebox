import { describe, expect, it } from 'vitest';
import { joinAddressText, joinUrl, parseRoute } from './route';

describe('routes', () => {
  it('finds the host page, a join link and the default phone page', () => {
    expect(parseRoute('#/host')).toEqual({ page: 'host' });
    expect(parseRoute('#/join/abcd')).toEqual({ page: 'phone', code: 'ABCD' });
    expect(parseRoute('#/join/ab%20cd')).toEqual({ page: 'phone', code: 'ABCD' });
    expect(parseRoute('')).toEqual({ page: 'phone', code: '' });
    expect(parseRoute('#/whatever')).toEqual({ page: 'phone', code: '' });
  });
  it('builds the join link on the same site and path, dropping any old query or hash', () => {
    expect(joinUrl('https://example.github.io/jukebox/?x=1#/host', 'ABCD')).toBe('https://example.github.io/jukebox/#/join/ABCD');
    expect(joinAddressText('https://example.github.io/jukebox/#/host')).toBe('example.github.io/jukebox');
  });
});
