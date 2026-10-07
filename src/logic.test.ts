import { describe, expect, it } from 'vitest';
import { JT, dailyPick, dayNumber, emojiRow, filterByText, fold, grade, makeSearch, optimalPath, shareText } from './logic';
import type { Film, Loader, Person, SearchRow } from './types';

function person(id: number, name: string, dist: number, parentFilm = 0, parentPerson = 0, films: [number, string][] = []): Person {
  return { id, name, fame: 0, dist, parentFilm, parentPerson, films: films.map(([fid, title]) => ({ id: fid, title, year: 2000 })) };
}

// Ronaldo -> Goal III -> Beckham -> U.N.C.L.E. -> Hammer -> The Social Network -> JT
const people = new Map<number, Person>([
  [JT, person(JT, 'Justin Timberlake', 0, 0, 0, [[185888, 'The Social Network']])],
  [11, person(11, 'Armie Hammer', 1, 185888, JT, [[185888, 'The Social Network'], [2, 'The Man from U.N.C.L.E.']])],
  [10, person(10, 'David Beckham', 2, 2, 11, [[2, 'The Man from U.N.C.L.E.'], [3, 'Goal III']])],
  [11571, person(11571, 'Cristiano Ronaldo', 3, 3, 10, [[3, 'Goal III']])],
]);
const loader: Loader = {
  person: async (id) => {
    const p = people.get(id);
    if (!p) throw new Error(`missing ${id}`);
    return p;
  },
  film: async () => {
    throw new Error('optimalPath should not need film shards');
  },
};

describe('optimalPath', () => {
  it('follows parent pointers to JT', async () => {
    const steps = await optimalPath(people.get(11571)!, loader);
    expect(steps.map((s) => `${s.film.title} > ${s.person.name}`)).toEqual([
      'Goal III > David Beckham',
      'The Man from U.N.C.L.E. > Armie Hammer',
      'The Social Network > Justin Timberlake',
    ]);
  });

  it('is empty for JT himself', async () => {
    expect(await optimalPath(people.get(JT)!, loader)).toEqual([]);
  });

  it('fails loudly on a broken parent pointer', async () => {
    const orphan = person(99, 'Orphan', 1, 5, JT, [[6, 'Other']]);
    await expect(optimalPath(orphan, loader)).rejects.toThrow(/no credit/);
  });
});

describe('grading and sharing', () => {
  it('grades moves by distance change', () => {
    expect(grade(3, 2)).toBe('closer');
    expect(grade(3, 3)).toBe('same');
    expect(grade(2, 3)).toBe('further');
  });

  it('builds an emoji row with hints', () => {
    expect(emojiRow([{ grade: 'closer', hinted: false }, { grade: 'same', hinted: false }, { grade: 'closer', hinted: true }])).toBe('🟩🟨💡');
  });

  it('formats share text', () => {
    const text = shareText({
      daily: 4,
      start: 'Cristiano Ronaldo',
      moves: Array(3).fill({ grade: 'closer', hinted: false }),
      par: 3,
      gaveUp: false,
      url: 'https://example.test/#/daily',
    });
    expect(text).toBe('Six Degrees of JT #4\nCristiano Ronaldo → Justin Timberlake\n🟩🟩🟩 3 films (par 3)\nhttps://example.test/#/daily');
  });

  it('says when the player gave up', () => {
    const text = shareText({ daily: null, start: 'X', moves: [{ grade: 'further', hinted: false }], par: 2, gaveUp: true, url: 'u' });
    expect(text).toContain('🟥 gave up after 1 film (par 2)');
    expect(text.startsWith('Six Degrees of JT\n')).toBe(true);
  });
});

describe('search', () => {
  const index: SearchRow[] = [
    [1, 'Cristiano Ronaldo', 214, 3, 'Goal III'],
    [2, 'Pelé', 183, 3, 'Escape to Victory'],
    [3, 'Ronaldo', 150, 4, 'Something'],
    [4, 'Ronald Reagan', 140, 3, 'Knute Rockne'],
    [5, 'Mila Kunis', 119, 1, 'Black Swan'],
  ];
  const search = makeSearch(index);

  it('ignores accents and case', () => {
    expect(fold('Pelé')).toBe('pele');
    expect(search('PELE').map((r) => r[1])).toEqual(['Pelé']);
  });

  it('ranks exact, then prefix, then word prefix, then substring', () => {
    expect(search('ronald').map((r) => r[1])).toEqual(['Ronaldo', 'Ronald Reagan', 'Cristiano Ronaldo']);
    expect(search('ronaldo').map((r) => r[1])).toEqual(['Ronaldo', 'Cristiano Ronaldo']);
    expect(search('cris ron').map((r) => r[1])).toEqual(['Cristiano Ronaldo']);
    expect(search('unis').map((r) => r[1])).toEqual(['Mila Kunis']);
  });

  it('returns nothing for a blank query', () => {
    expect(search('   ')).toEqual([]);
  });

  it('filters lists by folded substring', () => {
    const films: Pick<Film, 'title'>[] = [{ title: 'Amélie' }, { title: 'Alpha Dog' }];
    expect(filterByText(films, 'ame', (f) => f.title)).toEqual([{ title: 'Amélie' }]);
    expect(filterByText(films, '', (f) => f.title)).toHaveLength(2);
  });
});

describe('daily challenge', () => {
  it('numbers days from the epoch', () => {
    expect(dayNumber('2026-10-08')).toBe(1);
    expect(dayNumber('2026-10-09')).toBe(2);
    expect(dayNumber('2027-10-08')).toBe(366);
  });

  it('picks the same start for everyone on a day, and varies across days', () => {
    const pool = Array.from({ length: 500 }, (_, i) => i + 1000);
    expect(dailyPick(pool, '2026-10-08')).toBe(dailyPick([...pool], '2026-10-08'));
    const week = new Set(['08', '09', '10', '11', '12', '13', '14'].map((d) => dailyPick(pool, `2026-10-${d}`)));
    expect(week.size).toBeGreaterThan(5);
  });

  it('keeps the pick when other people join or leave the pool', () => {
    const pool = Array.from({ length: 500 }, (_, i) => i + 1000);
    const pick = dailyPick(pool, '2026-10-08');
    const shrunk = pool.filter((id) => id === pick || id % 3 !== 0);
    const grown = [...pool, ...Array.from({ length: 200 }, (_, i) => i + 9000)];
    expect(dailyPick(shrunk, '2026-10-08')).toBe(pick);
    // Newcomers can only take over by out-hashing the current pick, never by shifting indexes.
    const winner = dailyPick(grown, '2026-10-08');
    expect(winner === pick || winner >= 9000).toBe(true);
  });
});
