import { describe, expect, it } from 'vitest';
import { isArtistMatch, matchArtist, normalizeName, editDistance, type ArtistInfo } from './matcher';

const solo = (name: string, extra: Partial<ArtistInfo> = {}): ArtistInfo => ({ artists: [name], ...extra });

describe('plan starter table', () => {
  const rows: Array<[string, string, ArtistInfo, boolean]> = [
    ['beatles', 'The Beatles', solo('The Beatles'), true],
    ['Beyonce', 'Beyoncé', solo('Beyoncé'), true],
    ['fleetwod mac', 'Fleetwood Mac', solo('Fleetwood Mac'), true],
    ['springsteen', 'Bruce Springsteen', solo('Bruce Springsteen'), true],
    ['bruce', 'Bruce Springsteen', solo('Bruce Springsteen'), false],
    ['michael', 'Michael Jackson', solo('Michael Jackson'), false],
    ['pink', 'P!nk', solo('P!nk', { artistAliases: ['Pink'] }), true],
    ['guns and roses', "Guns N' Roses", solo("Guns N' Roses", { artistAliases: ['Guns and Roses'] }), true],
    ['daft', 'Daft Punk', solo('Daft Punk'), false],
    ['Jay Z', 'JAY-Z', solo('JAY-Z'), true],
    ['Lil Nas', 'Lil Nas X', solo('Lil Nas X'), false],
    ['mark ronson', 'Mark Ronson feat. Bruno Mars', { artists: ['Mark Ronson'], featuredArtists: ['Bruno Mars'] }, true],
    ['bruno mars', 'Mark Ronson feat. Bruno Mars', { artists: ['Mark Ronson'], featuredArtists: ['Bruno Mars'] }, false],
    ['mariah carey', 'Mariah Carey & Boyz II Men', { artists: ['Mariah Carey', 'Boyz II Men'] }, true],
    ['boyz ii men', 'Mariah Carey & Boyz II Men', { artists: ['Mariah Carey', 'Boyz II Men'] }, true],
  ];
  it.each(rows)('%s vs %s -> %s', (typed, _credit, info, expected) => {
    expect(isArtistMatch(typed, info)).toBe(expected);
  });
});

describe('normalisation', () => {
  it('lowercases, strips accents and punctuation, unifies & and and, drops leading the', () => {
    expect(normalizeName('  The  Beyoncé!! ')).toBe('beyonce');
    expect(normalizeName('Hall & Oates')).toBe('hall and oates');
    expect(normalizeName("Guns N' Roses")).toBe('guns n roses');
    expect(normalizeName('AC/DC')).toBe('ac dc');
  });
  it('keeps a lone "The"', () => {
    expect(normalizeName('The')).toBe('the');
  });
  it('edit distance counts swaps as one', () => {
    expect(editDistance('abcd', 'abdc')).toBe(1);
    expect(editDistance('kitten', 'sitting')).toBe(3);
  });
});

describe('matching behaviour (made-up artists)', () => {
  it('ignores case, the, and spacing in compound names', () => {
    expect(isArtistMatch('THE velvet comets', solo('Velvet Comets'))).toBe(true);
    expect(isArtistMatch('acdc', solo('AC/DC'))).toBe(true);
    expect(isArtistMatch('hall and oates', solo('Hall & Oates'))).toBe(true);
    expect(isArtistMatch('hall & oates', solo('Hall and Oates'))).toBe(true);
  });
  it('empty or blank guess never matches', () => {
    expect(isArtistMatch('', solo('Zed Quartz'))).toBe(false);
    expect(isArtistMatch('   !! ', solo('Zed Quartz'))).toBe(false);
  });
  it('typo tolerance scales with length', () => {
    expect(isArtistMatch('velvet comts', solo('Velvet Comets'))).toBe(true); // 1 edit
    expect(isArtistMatch('velvt comts', solo('Velvet Comets'))).toBe(true); // 2 edits on a long name
    expect(isArtistMatch('velvt cmts', solo('Velvet Comets'))).toBe(false); // 3 edits
    expect(isArtistMatch('quarz', solo('Quartz'))).toBe(true); // 1 edit on a medium name
    expect(isArtistMatch('quartzzz', solo('Quartz'))).toBe(false);
    expect(isArtistMatch('zod', solo('Zed'))).toBe(false); // short names get no typos
    expect(isArtistMatch('abcx', solo('Abcd'))).toBe(false);
  });
  it('transposed letters count as one typo', () => {
    expect(isArtistMatch('velevt comets', solo('Velvet Comets'))).toBe(true);
  });
  it('surname alone works for solo people only if distinctive, first name alone never', () => {
    const p = solo('Marla Quillfeather');
    expect(isArtistMatch('quillfeather', p)).toBe(true);
    expect(isArtistMatch('quilfeather', p)).toBe(true); // typo in surname
    expect(isArtistMatch('marla', p)).toBe(false);
    expect(isArtistMatch('Marla Quilfeather', p)).toBe(true);
    expect(isArtistMatch('marla q', p)).toBe(false);
  });
  it('too-short surname is not accepted', () => {
    expect(isArtistMatch('wu', solo('Tara Wu'))).toBe(false);
    expect(isArtistMatch('x', solo('Lil Nas X'))).toBe(false);
  });
  it('bands need the full name (apart from the)', () => {
    expect(isArtistMatch('stones', solo('The Granite Stones'))).toBe(false);
    expect(isArtistMatch('granite stones', solo('The Granite Stones'))).toBe(true);
    expect(isArtistMatch('oates', solo('Hall & Oates'))).toBe(false);
    expect(isArtistMatch('punk', solo('Daft Punk', { groupArtists: ['Daft Punk'] }))).toBe(false);
    expect(isArtistMatch('wolves', solo('Paper Wolves', { groupArtists: ['paper wolves'] }))).toBe(false);
  });
  it('partial names are not typos of the full name', () => {
    expect(isArtistMatch('paper', solo('Paper Wolves'))).toBe(false);
    expect(isArtistMatch('lil nas', solo('Lil Nas X'))).toBe(false);
  });
  it('aliases match like full names, including small typos', () => {
    const info = solo('Katherine Zephyr', { artistAliases: ['Kat Z'] });
    expect(matchArtist('kat z', info)).toEqual({ matched: true, kind: 'alias' });
    expect(isArtistMatch('katz', info)).toBe(true);
    expect(isArtistMatch('kat', info)).toBe(false);
  });
  it('featured artists never count, even if also given as alias-looking text', () => {
    const info: ArtistInfo = { artists: ['Mark Ronson'], featuredArtists: ['Bruno Mars', 'Tove Lindgren'] };
    expect(isArtistMatch('bruno mars', info)).toBe(false);
    expect(isArtistMatch('mars', info)).toBe(false);
    expect(isArtistMatch('lindgren', info)).toBe(false);
  });
  it('either of two main artists counts, and so does the whole credit', () => {
    const duet: ArtistInfo = { artists: ['Ada Fenwick', 'Boyz of Glass'] };
    expect(isArtistMatch('ada fenwick', duet)).toBe(true);
    expect(isArtistMatch('boyz of glass', duet)).toBe(true);
    expect(isArtistMatch('fenwick', duet)).toBe(true);
    expect(isArtistMatch('ada fenwick & boyz of glass', duet)).toBe(true);
    expect(isArtistMatch('ada', duet)).toBe(false);
  });
  it('reports how it matched', () => {
    expect(matchArtist('zed quartz', solo('Zed Quartz')).kind).toBe('exact');
    expect(matchArtist('zed quarts', solo('Zed Quartz')).kind).toBe('typo');
    expect(matchArtist('quartz', solo('Zed Quartz')).kind).toBe('surname');
    expect(matchArtist('nope', solo('Zed Quartz'))).toEqual({ matched: false, kind: null });
  });
});
