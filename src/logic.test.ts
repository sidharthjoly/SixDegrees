import { describe, expect, it } from 'vitest';
import { JT, STAR_CANDIDATES, bollywoodOfDay, dailyPick, dayNumber, dayOfNumber, emojiRow, filterByText, fold, goalFor, grade, hardRules, isPlayableDay, jtGoal, makeSearch, optimalPath, reachIn, shareText, starDaily, starOfDay, starsOn, targetOf, type Goal } from './logic';
import type { Film, Loader, Person, Reach, SearchRow } from './types';

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
// Free play can also head for another star. Here that's Beckham, whose distances live in
// their own files (t/10/…), not in the person rows.
const BECKHAM: Goal = { id: 10, name: 'David Beckham', mode: 'normal' };
const towardBeckham = new Map<number, Reach>([
  [10, { dist: 0, parentFilm: 0, parentPerson: 0 }],
  [11571, { dist: 1, parentFilm: 3, parentPerson: 10 }],
  [11, { dist: 1, parentFilm: 2, parentPerson: 10 }],
  [JT, { dist: 2, parentFilm: 185888, parentPerson: 11 }],
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
  reach: async (target, id) => {
    const r = target === BECKHAM.id && towardBeckham.get(id);
    if (!r) throw new Error(`missing ${id} towards ${target}`);
    return r;
  },
};
const path = async (id: number, goal: Goal = jtGoal()) =>
  (await optimalPath(people.get(id)!, loader, goal)).map((s) => `${s.film.title} > ${s.person.name}`);

describe('optimalPath', () => {
  it('follows parent pointers to JT', async () => {
    expect(await path(11571)).toEqual(['Goal III > David Beckham', 'The Man from U.N.C.L.E. > Armie Hammer', 'The Social Network > Justin Timberlake']);
  });

  it('follows the hard-mode pointers in hard mode', async () => {
    expect(await path(11571, jtGoal('hard'))).toEqual(['Goal III > David Beckham', 'The Man from U.N.C.L.E. > Emile Hirsch', 'Alpha Dog > Justin Timberlake']);
  });

  it('is empty for JT himself', async () => {
    expect(await path(JT)).toEqual([]);
  });

  it('refuses someone hard mode cannot reach', async () => {
    expect(reachIn(people.get(99)!, 'hard').dist).toBe(Infinity);
    await expect(path(99, jtGoal('hard'))).rejects.toThrow(/doesn't reach/);
  });

  it('follows another star’s own pointers when heading for them', async () => {
    expect(await path(JT, BECKHAM)).toEqual(['The Social Network > Armie Hammer', 'The Man from U.N.C.L.E. > David Beckham']);
    expect(await path(11571, BECKHAM)).toEqual(['Goal III > David Beckham']);
    expect(await path(10, BECKHAM)).toEqual([]);
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

  it('adds the standing under the score when there is one', () => {
    const base = { daily: 1, mode: 'normal' as const, start: 'X', moves: [{ grade: 'closer' as const, hinted: false }], par: 1, gaveUp: false, url: 'u' };
    expect(shareText({ ...base, standing: 'Beat 72% of players' })).toBe('Six Degrees of JT #1\nX → Justin Timberlake\n🟩 1 film (par 1)\nBeat 72% of players\nu');
    expect(shareText({ ...base, standing: null })).toBe(shareText(base));
  });

  it('names another star in the title and the goal', () => {
    const text = shareText({ daily: null, mode: 'normal', start: 'X', goal: BECKHAM, moves: [{ grade: 'closer', hinted: false }], par: 1, gaveUp: false, url: 'u' });
    expect(text).toBe('Six Degrees of David Beckham\nX → David Beckham\n🟩 1 film (par 1)\nu');
    expect(shareText({ daily: null, mode: 'normal', start: 'X', goal: jtGoal(), moves: [], par: 1, gaveUp: true, url: 'u' })).toMatch(/^Six Degrees of JT\nX → Justin Timberlake\n/);
  });

  it('marks Bollywood hard mode, heading for Shah Rukh Khan', () => {
    const srk: Goal = { id: 9535, name: 'Shah Rukh Khan', mode: 'bollywood-hard' };
    const text = shareText({ daily: 3, mode: 'bollywood-hard', start: 'Kajol', goal: srk, moves: [{ grade: 'closer', hinted: false }], par: 1, gaveUp: false, url: 'u' });
    expect(text).toBe('Six Degrees of Shah Rukh Khan #3 (hard)\nKajol → Shah Rukh Khan\n🟩 1 film (par 1)\nu');
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

describe('goals', () => {
  const meta = { targets: [{ id: 10, name: 'David Beckham', film: 'Goal III' }] };

  it('head for JT unless a link names one of the other stars', () => {
    expect(goalFor(meta, undefined, 'hard')).toEqual(jtGoal('hard'));
    expect(goalFor(meta, JT, 'normal')).toEqual(jtGoal());
    expect(goalFor(meta, 10, 'normal')).toEqual(BECKHAM);
  });

  it('refuse anyone else, and another star in hard mode', () => {
    expect(goalFor(meta, 11571, 'normal')).toBeNull();
    expect(goalFor(meta, 10, 'hard')).toBeNull();
  });

  it('head for the day’s star in the star daily, which needs one', () => {
    expect(goalFor(meta, 10, 'star')).toEqual({ ...BECKHAM, mode: 'star' });
    expect(goalFor(meta, undefined, 'star')).toBeNull();
    expect(goalFor(meta, JT, 'star')).toBeNull();
  });

  it('leave JT out of routes', () => {
    expect(targetOf(jtGoal('hard'))).toBeUndefined();
    expect(targetOf(BECKHAM)).toBe(10);
  });
});

describe('starOfDay', () => {
  const ids = (list: number[]) => list.map((id) => ({ id }));
  const days = Array.from({ length: 40 }, (_, i) => dayOfNumber(i + 1));
  const far = async () => 3;

  it('gives everyone the same star on a day, whatever order the stars come in, and moves around', async () => {
    const picks = await Promise.all(days.map((d) => starOfDay(ids([1, 2, 3]), d, 99, far)));
    for (const [i, d] of days.entries()) expect(await starOfDay(ids([3, 1, 2]), d, 99, far)).toEqual(picks[i]);
    expect(new Set(picks.map((p) => p!.id))).toEqual(new Set([1, 2, 3]));
    expect(picks[0]!.par).toBe(3);
  });

  it('keeps the day’s star when other stars come and go', async () => {
    for (const d of days) {
      const { id } = (await starOfDay(ids([1, 2, 3, 4]), d, 99, far))!;
      // A new star takes the day only if it outranks the old one; dropping others never moves it.
      expect([id, 5, 6]).toContain((await starOfDay(ids([1, 2, 3, 4, 5, 6]), d, 99, far))!.id);
      expect((await starOfDay(ids([id, ...[1, 2, 3, 4].filter((x) => x !== id).slice(2)]), d, 99, far))!.id).toBe(id);
    }
  });

  it('passes over the start, and any star within one film of them or out of reach', async () => {
    const d = days[0];
    const top = (await starOfDay(ids([1, 2, 3]), d, 99, far))!.id;
    const next = (await starOfDay(ids([1, 2, 3].filter((x) => x !== top)), d, 99, far))!.id;
    expect(await starOfDay(ids([1, 2, 3]), d, 99, async (s) => (s === top ? 1 : 2))).toEqual({ id: next, par: 2 });
    expect(await starOfDay(ids([1, 2, 3]), d, 99, async (s) => (s === top ? Infinity : 2))).toEqual({ id: next, par: 2 });
    expect((await starOfDay(ids([1, 2, 3]), d, top, far))!.id).toBe(next);
  });

  it('looks at no more than a few stars, and has none when none of them will do', async () => {
    const asked: number[] = [];
    const near = async (s: number) => {
      asked.push(s);
      return 1;
    };
    expect(await starOfDay(ids([1, 2, 3, 4, 5, 6, 7, 8]), days[0], 99, near)).toBeNull();
    expect(asked).toHaveLength(STAR_CANDIDATES);
    expect(await starOfDay(ids([]), days[0], 99, far)).toBeNull();
  });
});

describe('stars added later', () => {
  const days = Array.from({ length: 60 }, (_, i) => dayOfNumber(i + 1));
  const old = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const grown = [...old, { id: 4, from: '2026-11-01' }, { id: 5, from: '2026-11-01' }, { id: 6, world: 'bollywood' as const }];
  const far = async () => 3;

  it('never change a day before their first day, and only then may take one', async () => {
    let changed = 0;
    for (const day of days) {
      const before = await starOfDay(old, day, 99, far);
      const after = await starOfDay(grown, day, 99, far);
      if (day < '2026-11-01') expect(after).toEqual(before);
      else if (after!.id !== before!.id) changed++;
    }
    expect(changed).toBeGreaterThan(0);
  });

  it('leave Bollywood mode’s stars out of the star daily', () => {
    expect(starsOn(grown, '2026-10-20')).toEqual([1, 2, 3]);
    expect(starsOn(grown, '2026-11-01')).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('bollywoodOfDay', () => {
  const file = { goal: 10, starts: [1, 2, 3, 4, 5] };
  const days = Array.from({ length: 40 }, (_, i) => dayOfNumber(i + 1));

  it('picks one of the starts, heading for Shah Rukh Khan, the same for everyone', () => {
    const picks = days.map((d) => bollywoodOfDay(file, d)!);
    for (const { start, goal } of picks) {
      expect(file.starts).toContain(start);
      expect(goal).toBe(10);
    }
    expect(new Set(picks.map((p) => p.start)).size).toBeGreaterThan(1);
    expect(bollywoodOfDay({ goal: 10, starts: [5, 3, 1, 4, 2] }, days[0])).toEqual(picks[0]);
  });

  it('picks apart from the JT daily, though the pools share people', () => {
    const pool = [1, 2, 3, 4, 5];
    expect(days.filter((d) => bollywoodOfDay({ goal: 10, starts: pool }, d)!.start === dailyPick(pool, d)).length).toBeLessThan(days.length / 2);
  });

  it('has none without any starts', () => {
    expect(bollywoodOfDay({ goal: 10, starts: [] }, days[0])).toBeNull();
  });

  it('heads for a star like the star daily does, by normal rules or hard', () => {
    expect(starDaily('bollywood') && starDaily('bollywood-hard') && starDaily('star')).toBe(true);
    expect(starDaily('normal') || starDaily('hard')).toBe(false);
    expect(hardRules('hard') && hardRules('bollywood-hard')).toBe(true);
    expect(hardRules('normal') || hardRules('star') || hardRules('bollywood')).toBe(false);
    expect(goalFor({ targets: [{ id: 10, name: 'Shah Rukh Khan', film: 'Om Shanti Om', world: 'bollywood' }] }, 10, 'bollywood-hard')).toEqual({ id: 10, name: 'Shah Rukh Khan', mode: 'bollywood-hard' });
    expect(goalFor({ targets: [{ id: 10, name: 'Shah Rukh Khan', film: 'Om Shanti Om', world: 'bollywood' }] }, 10, 'bollywood')).toEqual({ id: 10, name: 'Shah Rukh Khan', mode: 'bollywood' });
    expect(goalFor({ targets: [] }, undefined, 'bollywood')).toBeNull();
  });
});
