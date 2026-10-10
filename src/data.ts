import { bollywoodOfDay, dailyPick, starOfDay } from './logic';
import type { BollywoodFile, Film, FilmRow, Loader, Meta, Person, PersonRow, Qid, Reach, SearchRow, Target, TargetRow } from './types';

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
/** Bollywood mode's daily and suggestions. */
export const loadBollywood = () => once(files, 'bollywood', () => getJson<BollywoodFile>('bollywood.json')) as Promise<BollywoodFile>;
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

/** Where someone's rows towards a star are: Bollywood hard mode's, without its banned films, have their own. */
export const towardPath = (star: Qid, id: Qid, shards: number, hard = false) => `t/${star}${hard ? '-hard' : ''}/${id % shards}.json`;

/** How far someone is from one of the other stars free play can head for (meta.targets); `hard` for Bollywood hard mode. */
export async function getReach(target: Qid, id: Qid, hard = false): Promise<Reach> {
  const { targetShards } = await loadMeta();
  const r = await shardRow<TargetRow>(towardPath(target, id, targetShards, hard), id);
  // Hard mode's files leave out whoever only links through its banned films.
  if (!r && hard) return reach(-1, 0, 0);
  if (!r) throw new Error(`No one with id Q${id} is connected to Q${target}`);
  return reach(...r);
}

export const loader: Loader = { person: getPerson, film: getFilm, reach: getReach };

/** A day's star or Bollywood daily: its start, its star and par, or null when that day has none. */
export interface StarDaily {
  start: Qid;
  star: Target;
  par: number;
}

/** How far `start` is from a star, as the Worker reads it (src/route-check.ts): Infinity without a row. */
async function distanceTo(star: Qid, start: Qid, hard = false): Promise<number> {
  const { targetShards } = await loadMeta();
  const r = await shardRow<TargetRow>(towardPath(star, start, targetShards, hard), start);
  return r && r[0] >= 0 ? r[0] : Infinity;
}

/** The star daily for `day` (see starOfDay), picked as the Worker picks it when it checks a result. */
export async function dailyStar(day: string): Promise<StarDaily | null> {
  const meta = await loadMeta();
  const start = dailyPick(meta.daily, day);
  const found = await starOfDay(meta.targets, day, start, (star) => distanceTo(star, start));
  const star = found && meta.targets.find((t) => t.id === found.id);
  return found && star ? { start, star, par: found.par } : null;
}

/** The Bollywood daily for `day` (see bollywoodOfDay), picked as the Worker picks it; `hard` for par in hard mode. */
export async function dailyBollywood(day: string, hard = false): Promise<StarDaily | null> {
  const [meta, file] = await Promise.all([loadMeta(), loadBollywood()]);
  const pick = bollywoodOfDay(file, day);
  const star = pick && meta.targets.find((t) => t.id === pick.goal);
  if (!pick || !star) return null;
  const par = await distanceTo(pick.goal, pick.start, hard);
  return par === Infinity ? null : { start: pick.start, star, par };
}

/** The day's daily heading for another star, in the mode given. */
export const dailyFor = (day: string, mode: 'star' | 'bollywood' | 'bollywood-hard') =>
  mode === 'star' ? dailyStar(day) : dailyBollywood(day, mode === 'bollywood-hard');
