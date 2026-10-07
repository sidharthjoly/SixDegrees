import { describe, expect, it } from 'vitest';
import { JT, dailyPick, dayNumber, dayOfNumber, emojiRow, filterByText, fold, grade, isPlayableDay, makeSearch, optimalPath, reachIn, shareText } from './logic';
import type { Film, Loader, Person, SearchRow } from './types';

const NONE = { dist: Infinity, parentFilm: 0, parentPerson: 0 };

function person(id: number, name: string, dist: number, parentFilm = 0, parentPerson = 0, films: [number, string][] = [], hard = { dist, parentFilm, parentPerson }): Person {
  return {
    id,
    name,
    fame: 0,
    normal: { dist, parentFilm, parentPerson },
    hard,
    films: films.map(([fid, title]) => ({ id: fid, title, year: 2000, fame: 0 })),
  };
}

// Ronaldo -> Goal III -> Beckham -> U.N.C.L.E. -> Hammer -> The Social Network -> JT.
// Hard mode bans The Social Network, so Hammer goes via Alpha Dog-ish film 9 and person 12.
const people = new Map<number, Person>([
  [JT, person(JT, 'Justin Timberlake', 0, 0, 0, [[185888, 'The Social Network'], [9, 'Alpha Dog']])],
  [12, person(12, 'Emile Hirsch', 1, 9, JT, [[9, 'Alpha Dog'], [2, 'The Man from U.N.C.L.E.']])],
  [11, person(11, 'Armie Hammer', 1, 185888, JT, [[185888, 'The Social Network'], [2, 'The Man from U.N.C.L.E.']], { dist: 2, parentFilm: 2, parentPerson: 12 })],
  [10, person(10, 'David Beckham', 2, 2, 11, [[2, 'The Man from U.N.C.L.E.'], [3, 'Goal III']], { dist: 2, parentFilm: 2, parentPerson: 12 })],
  [11571, person(11571, 'Cristiano Ronaldo', 3, 3, 10, [[3, 'Goal III']], { dist: 3, parentFilm: 3, parentPerson: 10 })],
  [99, person(99, 'Only In Banned Films', 1, 185888, JT, [[185888, 'The Social Network']], NONE)],
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
const path = async (id: number, mode: 'normal' | 'hard' = 'normal') =>
  (await optimalPath(people.get(id)!, loader, mode)).map((s) => `${s.film.title} > ${s.person.name}`);

describe('optimalPath', () => {
  it('follows parent pointers to JT', async () => {
    expect(await path(11571)).toEqual(['Goal III > David Beckham', 'The Man from U.N.C.L.E. > Armie Hammer', 'The Social Network > Justin Timberlake']);
  });

  it('follows the hard-mode pointers in hard mode', async () => {
    expect(await path(11571, 'hard')).toEqual(['Goal III > David Beckham', 'The Man from U.N.C.L.E. > Emile Hirsch', 'Alpha Dog > Justin Timberlake']);
  });

  it('is empty for JT himself', async () => {
    expect(await path(JT)).toEqual([]);
  });

  it('refuses someone hard mode cannot reach', async () => {
    expect(reachIn(people.get(99)!, 'hard').dist).toBe(Infinity);
    await expect(path(99, 'hard')).rejects.toThrow(/doesn't reach JT/);
  });

  it('fails loudly on a broken parent pointer', async () => {
    const orphan = person(98, 'Orphan', 1, 5, JT, [[6, 'Other']]);
    await expect(optimalPath(orphan, loader)).rejects.toThrow(/no credit/);
  });
});

describe('grading and sharing', () => {
  it('grades moves by distance change', () => {
    expect(grade(3, 2)).toBe('closer');
    expect(grade(3, 3)).toBe('same');
    expect(grade(2, 3)).toBe('further');
    expect(grade(2, Infinity)).toBe('further');
  });

  it('builds an emoji row with hints', () => {
    expect(emojiRow([{ grade: 'closer', hinted: false }, { grade: 'same', hinted: false }, { grade: 'closer', hinted: true }])).toBe('🟩🟨💡');
  });

  it('formats share text', () => {
    const text = shareText({
      daily: 4,
      mode: 'normal',
      start: 'Cristiano Ronaldo',
      moves: Array(3).fill({ grade: 'closer', hinted: false }),
      par: 3,
      gaveUp: false,
      url: 'https://example.test/#/daily',
    });
    expect(text).toBe('Six Degrees of JT #4\nCristiano Ronaldo → Justin Timberlake\n🟩🟩🟩 3 films (par 3)\nhttps://example.test/#/daily');
  });

  it('marks hard mode and giving up', () => {
    const text = shareText({ daily: null, mode: 'hard', start: 'X', moves: [{ grade: 'further', hinted: false }], par: 2, gaveUp: true, url: 'u' });
    expect(text).toContain('🟥 gave up after 1 film (par 2)');
    expect(text.startsWith('Six Degrees of JT (hard)\n')).toBe(true);
  });
});

describe('search', () => {
  const index: SearchRow[] = [
    [1, 'Cristiano Ronaldo', 214, 3, 'Goal III', 3, ['CR7', 'Ronaldo', 'El Bicho']],
    [2, 'Pelé', 183, 3, 'Escape to Victory', 3],
    [3, 'Ronaldo', 150, 4, 'Something', 4],
    [4, 'Ronald Reagan', 140, 3, 'Knute Rockne', 3],
    [5, 'Mila Kunis', 119, 1, 'Black Swan', 1],
    [6, 'Shah Rukh Khan', 136, 3, 'My Name Is Khan', 3, ['SRK', 'King Khan']],
  ];
  const search = makeSearch(index);
  const names = (q: string) => search(q).map((h) => h.row[1]);

  it('ignores accents and case', () => {
    expect(fold('Pelé')).toBe('pele');
    expect(names('PELE')).toEqual(['Pelé']);
  });

  it('ranks exact, then prefix, then word prefix, then substring', () => {
    expect(names('ronald')).toEqual(['Ronaldo', 'Ronald Reagan', 'Cristiano Ronaldo']);
    expect(names('cris ron')).toEqual(['Cristiano Ronaldo']);
    expect(names('unis')).toEqual(['Mila Kunis']);
  });

  it('finds people by nickname and says which one matched', () => {
    expect(search('cr7')).toEqual([{ row: index[0], alias: 'CR7' }]);
    expect(names('srk')).toEqual(['Shah Rukh Khan']);
    expect(search('king k')[0]).toEqual({ row: index[5], alias: 'King Khan' });
  });

  it('puts a real name ahead of the same word used as a nickname', () => {
    expect(names('ronaldo')).toEqual(['Ronaldo', 'Cristiano Ronaldo']);
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
  it('numbers days from the epoch, both ways', () => {
    expect(dayNumber('2026-10-08')).toBe(1);
    expect(dayNumber('2026-10-09')).toBe(2);
    expect(dayNumber('2027-10-08')).toBe(366);
    expect(dayOfNumber(1)).toBe('2026-10-08');
    expect(dayOfNumber(366)).toBe('2027-10-08');
  });

  it('only accepts real days between the first daily and today', () => {
    expect(isPlayableDay('2026-10-08', '2026-10-20')).toBe(true);
    expect(isPlayableDay('2026-10-20', '2026-10-20')).toBe(true);
    expect(isPlayableDay('2026-10-21', '2026-10-20')).toBe(false);
    expect(isPlayableDay('2026-10-07', '2026-10-20')).toBe(false);
    expect(isPlayableDay('2026-02-30', '2027-01-01')).toBe(false);
    expect(isPlayableDay('yesterday', '2026-10-20')).toBe(false);
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
