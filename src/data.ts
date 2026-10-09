import { dailyPick, starOfDay } from './logic';
import type { Film, FilmRow, Loader, Meta, Person, PersonRow, Qid, Reach, SearchRow, Target, TargetRow } from './types';

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
  // Gone: a 404 on the live site. Some servers (Vite's dev server among them) answer a
  // missing file with the page itself instead, which would otherwise surface as a JSON
  // parse error ("The string did not match the expected pattern" in Safari).
  if (res.status === 404 || res.headers.get('content-type')?.includes('text/html')) throw new StaleDataError();
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
/** The best-known rows of search.json, small enough to answer the first keystrokes. */
export const loadSearchTop = () => once(files, 'search-top', () => getJson<SearchRow[]>('search-top.json')) as Promise<SearchRow[]>;

/**
 * Shards, least recently used first. A co-star search on a prolific actor touches hundreds
 * of film shards (~15 KB of JSON each), so keep a bounded number, about 20 MB, rather than
 * every shard seen this session.
 */
const shardCache = new Map<string, Promise<unknown>>();
const MAX_SHARDS = 1200;

async function row<T>(kind: 'p' | 'f', id: Qid): Promise<T | undefined> {
  const { shards } = await loadMeta();
  return shardRow<T>(`${kind}/${id % shards}.json`, id);
}

async function shardRow<T>(path: string, id: Qid): Promise<T | undefined> {
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

/** How far someone is from one of the other stars free play can head for (meta.targets). */
export async function getReach(target: Qid, id: Qid): Promise<Reach> {
  const { targetShards } = await loadMeta();
  const r = await shardRow<TargetRow>(`t/${target}/${id % targetShards}.json`, id);
  if (!r) throw new Error(`No one with id Q${id} is connected to Q${target}`);
  return reach(...r);
}

export const loader: Loader = { person: getPerson, film: getFilm, reach: getReach };

/** The day's star daily: its start, its star and par, or null when no star will do (see starOfDay). */
export interface StarDaily {
  start: Qid;
  star: Target;
  par: number;
}

/**
 * The star daily for `day`, picked as the Worker picks it when it checks a result
 * (src/route-check.ts): someone without a row towards a star is Infinity away.
 */
export async function dailyStar(day: string): Promise<StarDaily | null> {
  const meta = await loadMeta();
  const start = dailyPick(meta.daily, day);
  const found = await starOfDay(
    meta.targets.map((t) => t.id),
    day,
    start,
    async (star) => {
      const r = await shardRow<TargetRow>(`t/${star}/${start % meta.targetShards}.json`, start);
      return r && r[0] >= 0 ? r[0] : Infinity;
    },
  );
  const star = found && meta.targets.find((t) => t.id === found.id);
  return found && star ? { start, star, par: found.par } : null;
}
