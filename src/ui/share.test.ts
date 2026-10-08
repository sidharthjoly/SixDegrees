import { describe, expect, it } from 'vitest';
import type { Person } from '../types';
import { cardAlt, fileName, puzzlePath, resultCard } from './share';
import type { Move } from './play';
import type { ResultContext } from './result';

const person = (id: number, name: string): Person => ({
  id,
  name,
  fame: 0,
  normal: { dist: 1, parentFilm: 0, parentPerson: 0 },
  hard: { dist: 1, parentFilm: 0, parentPerson: 0 },
  films: [],
});

describe('puzzlePath', () => {
  const daily = { day: '2026-10-19', start: 615, mode: 'normal' as const };

  it('links dailies to their preview page in production', () => {
    expect(puzzlePath(daily, true)).toBe('d/2026-10-19/');
    expect(puzzlePath({ ...daily, mode: 'hard' }, true)).toBe('d/2026-10-19/hard/');
  });

  it('keeps hash links in dev, and for free play', () => {
    expect(puzzlePath(daily, false)).toBe('#/daily/2026-10-19');
    expect(puzzlePath({ ...daily, mode: 'hard' }, false)).toBe('#/daily/2026-10-19/hard');
    expect(puzzlePath({ day: null, start: 615, mode: 'normal' }, true)).toBe('#/p/615');
  });
});

describe('result card data', () => {
  const ctx: ResultContext = {
    day: '2026-10-19',
    mode: 'hard',
    start: person(10, 'Zoë Saldaña'),
    par: 2,
    moves: [
      { film: { id: 1, title: 'Avatar', year: 2009 }, person: person(11, 'Sam Worthington'), grade: 'closer', hinted: false },
      { film: { id: 2, title: 'Clash', year: null }, person: person(12, 'Someone'), grade: 'same', hinted: true },
    ] satisfies Move[],
    gaveUp: true,
    revealed: [{ film: { id: 3, title: 'In Time', year: 2011 }, person: person(43432, 'Justin Timberlake') }],
    best: [],
    text: '',
    vs: null,
  };

  it('leaves the path out unless asked', () => {
    expect(resultCard(ctx, false, 'example.com').path).toBeUndefined();
    const card = resultCard(ctx, true, 'example.com');
    expect(card.label).toBe('Daily #12');
    expect(card.path?.map((s) => [s.film, s.person, !!s.revealed])).toEqual([
      ['Avatar', 'Sam Worthington', false],
      ['Clash', 'Someone', false],
      ['In Time', 'Justin Timberlake', true],
    ]);
  });

  it('describes the image in words, hints included', () => {
    expect(cardAlt(resultCard(ctx, false, 'example.com'))).toBe(
      'Daily #12, hard mode. Zoë Saldaña to Justin Timberlake: gave up after 2 films, par 2. Moves: closer, no closer with a hint.',
    );
  });

  it('names the file after the daily, or the star in free play', () => {
    expect(fileName(ctx)).toBe('six-degrees-jt-12-hard.png');
    expect(fileName({ day: null, mode: 'normal', start: ctx.start })).toBe('six-degrees-jt-zoe-saldana.png');
  });
});
