import type { Film, FilmRow, Loader, Meta, Person, PersonRow, Qid, SearchRow } from './types';

/**
 * Data lives under a content-hashed folder whose name is compiled into the bundle, so a
 * bundle only ever reads the data it was built against.
 */
const BASE = `${import.meta.env.BASE_URL}data/v/${__DATA_VERSION__}/`;

/** The data this bundle was built for has gone: the site was redeployed while the page was open. */
export class StaleDataError extends Error {
  constructor() {
    super('The game was just updated. Reload the page to get the new version.');
  }
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(BASE + path);
  if (res.status === 404) throw new StaleDataError();
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

/**
 * Shards, least recently used first. A co-star search on a prolific actor touches 100+
 * film shards (~100 KB of JSON each), so keep a bounded number rather than every shard
 * seen this session.
 */
const shardCache = new Map<string, Promise<unknown>>();
const MAX_SHARDS = 160;

async function row<T>(kind: 'p' | 'f', id: Qid): Promise<T | undefined> {
  const { shards } = await loadMeta();
  const path = `${kind}/${id % shards}.json`;
  const cached = shardCache.get(path);
  if (cached) {
    shardCache.delete(path);
    shardCache.set(path, cached);
  }
  const shard = (await once(shardCache, path, () => getJson(path))) as Record<string, T>;
  while (shardCache.size > MAX_SHARDS) shardCache.delete(shardCache.keys().next().value!);
  return shard[id];
}

const reach = (dist: number, parentFilm: Qid, parentPerson: Qid) => ({
  dist: dist < 0 ? Infinity : dist,
  parentFilm,
  parentPerson,
});

export async function getPerson(id: Qid): Promise<Person> {
  const r = await row<PersonRow>('p', id);
  if (!r) throw new Error(`No one with id Q${id} is connected to Justin Timberlake`);
  const [name, fame, dist, parentFilm, parentPerson, films, hardDist, hardParentFilm, hardParentPerson] = r;
  return {
    id,
    name,
    fame,
    normal: reach(dist, parentFilm, parentPerson),
    hard: reach(hardDist, hardParentFilm, hardParentPerson),
    films: films.map(([fid, title, year, fame]) => ({ id: fid, title, year, fame })),
  };
}

export async function getFilm(id: Qid): Promise<Film> {
  const r = await row<FilmRow>('f', id);
  if (!r) throw new Error(`Unknown film Q${id}`);
  const [title, year, fame, cast] = r;
  return { id, title, year, fame, cast: cast.map(([pid, name, fame]) => ({ id: pid, name, fame })) };
}

export const loader: Loader = { person: getPerson, film: getFilm };
