import { describe, expect, it } from 'vitest';
import { joinAddressText, joinUrl, parseRoute } from './route';

describe('routes', () => {
  it('finds the home page, the host page, the join page and a join link', () => {
    expect(parseRoute('#/host')).toEqual({ page: 'host' });
    expect(parseRoute('#/join/abcd')).toEqual({ page: 'phone', code: 'ABCD' });
    expect(parseRoute('#/join/ab%20cd')).toEqual({ page: 'phone', code: 'ABCD' });
    expect(parseRoute('#/join')).toEqual({ page: 'phone', code: '' });
    expect(parseRoute('#/join/%E0%A4%A')).toEqual({ page: 'phone', code: expect.any(String) }); // a bad escape never throws
    expect(parseRoute('')).toEqual({ page: 'home' });
    expect(parseRoute('#/')).toEqual({ page: 'home' });
    expect(parseRoute('#/whatever')).toEqual({ page: 'home' });
  });
  it('builds the join link on the same site and path, dropping any old query or hash', () => {
    expect(joinUrl('https://example.github.io/jukebox/?x=1#/host', 'ABCD')).toBe('https://example.github.io/jukebox/#/join/ABCD');
    expect(joinAddressText('https://example.github.io/jukebox/#/host')).toBe('example.github.io/jukebox');
  });
});
