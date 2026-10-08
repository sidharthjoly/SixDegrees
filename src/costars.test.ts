import { describe, expect, it } from 'vitest';
import { CostarIndex, CostarSearch, bestFilm, nameRank } from './costars';
import { JT } from './logic';
import type { Film, FilmRef, PersonRef } from './types';

const ME = 1;
const film = (id: number, title: string, fame: number, cast: [number, string, number][]): Film => ({
  id,
  title,
  year: 2000 + id,
  fame,
  cast: cast.map(([pid, name, pfame]) => ({ id: pid, name, fame: pfame })),
});

const socialNetwork = film(10, 'The Social Network', 125, [
  [ME, 'Me', 50],
  [JT, 'Justin Timberlake', 111],
  [11, 'Armie Hammer', 79],
  [12, 'Jesse Eisenberg', 90],
]);
const unc = film(20, 'The Man from U.N.C.L.E.', 80, [
  [ME, 'Me', 50],
  [11, 'Armie Hammer', 79],
  [13, 'Hammer Jones', 5],
]);
const tiny = film(30, 'Tiny Film', 2, [
  [ME, 'Me', 50],
  [11, 'Armie Hammer', 79],
  [14, 'Zoë Hammersmith', 3],
  [15, 'Justine Waddell', 40],
]);

function indexOf(films: Film[], banned: number[] = []): CostarIndex {
  const idx = new CostarIndex(ME, new Set(banned));
  films.forEach((f) => idx.add(f));
  return idx;
}
const names = (idx: CostarIndex, q: string) => idx.search(q).hits.map((h) => h.person.name);

describe('nameRank', () => {
  const rank = (name: string, q: string) => nameRank(name, name.split(' '), q, q.split(' '));
  it('ranks exact, prefix, word prefix, substring', () => {
    expect(rank('armie hammer', 'armie hammer')).toBe(0);
    expect(rank('armie hammer', 'arm')).toBe(1);
    expect(rank('armie hammer', 'ham')).toBe(2);
    expect(rank('armie hammer', 'a ha')).toBe(2);
    expect(rank('armie hammer', 'mmer')).toBe(3);
    expect(rank('armie hammer', 'bacon')).toBe(-1);
  });
});

describe('CostarIndex', () => {
  it('never matches the current person', () => {
    expect(names(indexOf([socialNetwork]), 'me')).not.toContain('Me');
    expect(indexOf([socialNetwork]).size).toBe(3);
  });

  it('ranks like the name search, better-known people first within a rank', () => {
    const idx = indexOf([socialNetwork, unc, tiny]);
    // "Hammer Jones" is a prefix match; the other two are word-prefix matches, so fame orders them.
    expect(names(idx, 'hammer')).toEqual(['Hammer Jones', 'Armie Hammer', 'Zoë Hammersmith']);
    expect(names(idx, 'armie hammer')).toEqual(['Armie Hammer']);
    expect(names(idx, 'senb')).toEqual(['Jesse Eisenberg']);
  });

  it('folds accents and case', () => {
    expect(names(indexOf([tiny]), 'ZOE')).toEqual(['Zoë Hammersmith']);
  });

  it('puts JT first whenever he matches', () => {
    // "Justine Waddell" is an equally good prefix match, but JT always comes first.
    expect(names(indexOf([tiny, socialNetwork]), 'justin')).toEqual(['Justin Timberlake', 'Justine Waddell']);
    expect(names(indexOf([tiny, socialNetwork]), 'ti')[0]).toBe('Justin Timberlake');
  });

  it('goes through the best-known shared film and counts the others', () => {
    const [hit] = indexOf([tiny, unc, socialNetwork]).search('armie').hits;
    expect(hit.via.title).toBe('The Social Network');
    expect(hit.more).toBe(2);
  });

  it('skips banned films entirely', () => {
    const idx = indexOf([tiny, unc, socialNetwork], [10]);
    expect(names(idx, 'justin')).toEqual(['Justine Waddell']);
    const [hit] = idx.search('armie').hits;
    expect(hit.via.title).toBe('The Man from U.N.C.L.E.');
    expect(hit.more).toBe(1);
  });

  it('limits hits but reports the full count', () => {
    const res = indexOf([socialNetwork, unc, tiny]).search('e', 2);
    expect(res.hits).toHaveLength(2);
    expect(res.total).toBe(6);
  });

  it('ignores blank queries', () => {
    expect(indexOf([socialNetwork]).search('  ')).toEqual({ hits: [], total: 0 });
  });
});

describe('bestFilm', () => {
  const f = (id: number, fame: number): FilmRef => ({ id, title: `F${id}`, year: null, fame });
  it('picks the best-known usable film, earlier credit on ties', () => {
    expect(bestFilm([f(1, 5), f(2, 9), f(3, 9)])?.id).toBe(2);
    expect(bestFilm([f(1, 5), f(2, 9)], new Set([2]))?.id).toBe(1);
    expect(bestFilm([f(2, 9)], new Set([2]))).toBeUndefined();
  });
});

describe('CostarSearch', () => {
  const refs = (n: number): FilmRef[] => Array.from({ length: n }, (_, i) => ({ id: 100 + i, title: `Film ${i}`, year: null, fame: n - i }));
  const castOf = (id: number): PersonRef[] => [
    { id: ME, name: 'Me', fame: 1 },
    { id: 1000 + id, name: `Co Star ${id}`, fame: 1 },
  ];

  /** A loader whose fetches resolve only when the test says so. */
  function controlled() {
    const pending = new Map<number, () => void>();
    let inFlight = 0;
    let peak = 0;
    const requested: number[] = [];
    const load = (id: number) =>
      new Promise<Film>((resolve, reject) => {
        requested.push(id);
        peak = Math.max(peak, ++inFlight);
        pending.set(id, () => {
          inFlight--;
          pending.delete(id);
          if (id === 666) reject(new Error('gone'));
          else resolve({ id, title: `Film ${id}`, year: null, fame: 1, cast: castOf(id) });
        });
      });
    const flush = async () => {
      for (const done of [...pending.values()]) done();
      // Let the awaiting fetches and their follow-up pumps run.
      for (let i = 0; i < 5; i++) await Promise.resolve();
    };
    return { load, flush, requested, peak: () => peak, pending };
  }

  it('loads at most four films at a time, best known first, reporting progress', async () => {
    const c = controlled();
    const s = new CostarSearch({ id: ME, films: refs(10) }, new Set(), c.load);
    let changes = 0;
    s.watch(() => changes++);
    expect(c.requested).toEqual([100, 101, 102, 103]);
    while (!s.done) await c.flush();
    expect(c.peak()).toBe(4);
    expect(c.requested).toEqual(refs(10).map((f) => f.id));
    expect(s.loaded).toBe(10);
    expect(changes).toBe(10);
    expect(s.index.search('co star').total).toBe(10);
  });

  it('never fetches banned films', async () => {
    const c = controlled();
    const s = new CostarSearch({ id: ME, films: refs(6) }, new Set([100, 102]), c.load);
    expect(s.total).toBe(4);
    s.watch(() => {});
    while (!s.done) await c.flush();
    expect(c.requested).toEqual([101, 103, 104, 105]);
  });

  it('pauses when unwatched and resumes where it left off', async () => {
    const c = controlled();
    const s = new CostarSearch({ id: ME, films: refs(10) }, new Set(), c.load);
    s.watch(() => {});
    s.unwatch();
    await c.flush();
    // The four in flight landed, but nothing new started.
    expect(s.loaded).toBe(4);
    expect(c.requested).toHaveLength(4);
    s.watch(() => {});
    expect(c.requested).toHaveLength(8);
    while (!s.done) await c.flush();
    expect(new Set(c.requested).size).toBe(10);
  });

  it('counts a film that fails to load and carries on', async () => {
    const c = controlled();
    const films = [...refs(2), { id: 666, title: 'Broken', year: null }];
    const s = new CostarSearch({ id: ME, films }, new Set(), c.load);
    s.watch(() => {});
    while (!s.done) await c.flush();
    expect(s.loaded).toBe(2);
    expect(s.failed).toBe(1);
  });

  it('fetches a film credited twice only once', () => {
    const c = controlled();
    const [a, b] = refs(2);
    const s = new CostarSearch({ id: ME, films: [a, b, a] }, new Set(), c.load);
    expect(s.total).toBe(2);
  });
});
