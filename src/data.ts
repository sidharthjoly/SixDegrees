import type { Film, FilmRow, Loader, Meta, Person, PersonRow, Qid, SearchRow } from './types';

const BASE = `${import.meta.env.BASE_URL}data/`;

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(`Couldn't load ${path} (HTTP ${res.status})`);
  return (await res.json()) as T;
}

/** Memoise a fetch, but forget failures so a retry can succeed. */
function once<T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
  let p = cache.get(key);
  if (!p) {
    p = load();
    cache.set(key, p);
    p.catch(() => cache.delete(key));
  }
  return p;
}

const files = new Map<string, Promise<unknown>>();

export const loadMeta = () => once(files, 'meta', () => getJson<Meta>('meta.json')) as Promise<Meta>;
export const loadSearch = () => once(files, 'search', () => getJson<SearchRow[]>('search.json')) as Promise<SearchRow[]>;

async function row<T>(kind: 'p' | 'f', id: Qid): Promise<T | undefined> {
  const { shards } = await loadMeta();
  const path = `${kind}/${id % shards}.json`;
  const shard = (await once(files, path, () => getJson(path))) as Record<string, T>;
  return shard[id];
}

export async function getPerson(id: Qid): Promise<Person> {
  const r = await row<PersonRow>('p', id);
  if (!r) throw new Error(`No one with id Q${id} is connected to Justin Timberlake`);
  const [name, fame, dist, parentFilm, parentPerson, films] = r;
  return {
    id,
    name,
    fame,
    dist,
    parentFilm,
    parentPerson,
    films: films.map(([fid, title, year]) => ({ id: fid, title, year })),
  };
}

export async function getFilm(id: Qid): Promise<Film> {
  const r = await row<FilmRow>('f', id);
  if (!r) throw new Error(`Unknown film Q${id}`);
  const [title, year, fame, cast] = r;
  return { id, title, year, fame, cast: cast.map(([pid, name]) => ({ id: pid, name })) };
}

export const loader: Loader = { person: getPerson, film: getFilm };
