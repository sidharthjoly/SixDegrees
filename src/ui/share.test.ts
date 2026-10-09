import { describe, expect, it } from 'vitest';
import { jtGoal, type Goal } from '../logic';
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

  it('keeps the star daily on its hash route, so it never opens the JT daily’s page', () => {
    expect(puzzlePath({ ...daily, mode: 'star', target: 3454165 }, true)).toBe('#/daily/2026-10-19/star');
  });

  it('keeps the star in free play towards another star', () => {
    expect(puzzlePath({ day: null, start: 615, mode: 'normal', target: 3454165 }, true)).toBe('#/p/615/to/3454165');
  });
});

describe('result card data', () => {
  const reach = { dist: 1, parentFilm: 0, parentPerson: 0 };
  const bacon: Goal = { id: 3454165, name: 'Kevin Bacon', mode: 'normal' };
  const ctx: ResultContext = {
    day: '2026-10-19',
    mode: 'hard',
    goal: jtGoal('hard'),
    start: person(10, 'Zoë Saldaña'),
    par: 2,
    moves: [
      { film: { id: 1, title: 'Avatar', year: 2009 }, person: person(11, 'Sam Worthington'), reach, grade: 'closer', hinted: false },
      { film: { id: 2, title: 'Clash', year: null }, person: person(12, 'Someone'), reach, grade: 'same', hinted: true },
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

  it('names the star free play headed for', () => {
    const free = { ...ctx, day: null, mode: 'normal' as const, goal: bacon };
    expect(resultCard(free, false, 'example.com').goal).toBe('Kevin Bacon');
    expect(cardAlt(resultCard(free, false, 'example.com'))).toMatch(/^Free play\. Zoë Saldaña to Kevin Bacon: /);
  });

  it('names the file after the daily, or the star in free play', () => {
    expect(fileName(ctx)).toBe('six-degrees-jt-12-hard.png');
    expect(fileName({ day: null, mode: 'normal', start: ctx.start, goal: jtGoal() })).toBe('six-degrees-jt-zoe-saldana.png');
    expect(fileName({ day: null, mode: 'normal', start: ctx.start, goal: bacon }, 'video')).toBe('six-degrees-kevin-bacon-zoe-saldana.mp4');
  });
});
