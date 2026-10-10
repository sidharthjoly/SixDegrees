import { isValidName } from './challenge-code';
import { isDayKey } from './days';
import { JT } from './logic';
import { checkRoute, dailyPuzzle, RouteError, type RouteData } from './route-check';
import type { BollywoodFile, Meta, Mode, PersonRow, TargetRow } from './types';

/*
 * The gate in front of the game's database writes, which the Cloudflare Worker (worker/) runs
 * at <site>/api/rpc/<function>. Anyone can make up player ids, so the functions that add rows
 * (results, groups, joins, new codes) only take a secret key the Worker holds, and the Worker
 * passes keys for the connection each call came from, which the database counts writes by
 * (see supabase/schema.sql). Using up everyone's share of a day then takes hundreds of
 * separate addresses, not one script.
 *
 * The connection keys are HMACs of the IP address, so the database never sees an address.
 * IPv6 addresses count by their /64, since one home or phone is given a whole /64, and again,
 * more loosely, by their /48, since anyone can get a /48 (65,536 /64s) free from a tunnel
 * broker. Tor counts as a single connection: anyone can hop between its exits for free.
 *
 * Results are checked against the game's own data on the way through (src/route-check.ts), so
 * a score stands for a real route rather than whatever the browser claimed. A daily's hints
 * come from here too, recorded before they're given, so a result counts every one asked for.
 *
 * Pure apart from fetching, which is passed in, so it runs in the Worker and tests alike.
 */

/** The functions that add rows. The game sends these through the gate, everything else straight to Supabase. */
export const WRITES: ReadonlySet<string> = new Set(['sixdegrees_submit', 'sixdegrees_hint', 'sixdegrees_create_group', 'sixdegrees_join_group', 'sixdegrees_new_code']);

export const API_PATH = '/api/rpc/';

/** The Worker's secrets (see worker/wrangler.toml). */
export interface GateEnv {
  /** The Supabase project's URL. */
  SUPABASE_URL?: string;
  /** A secret key (sb_secret_…, or a legacy service_role JWT): the only kind the write functions take. */
  SUPABASE_SECRET_KEY?: string;
  /** Any long random string, for the connection keys. */
  SOURCE_SECRET?: string;
}

/** Every daily's mode, as the database takes them. */
const MODES: readonly Mode[] = ['normal', 'hard', 'star', 'bollywood', 'bollywood-hard'];
const isMode = (m: unknown): m is Mode => MODES.includes(m as Mode);

/** Far beyond any real call: a result's route is at most 200 films of 13 characters. */
const MAX_BODY = 4096;

// ------------------------------------------------------------------ the game's data

/**
 * The site's data, as the game reads it (src/data.ts): the current version from
 * data/version.json, then that version's meta.json, person shards, the other stars' shards
 * and bollywood.json (for the star and Bollywood dailies). Versions are
 * content-hashed, so their files never change and are kept across requests while the Worker
 * stays warm; which version is current is asked again after a few minutes.
 */
const VERSION_TTL_MS = 5 * 60_000;
const MAX_SHARDS = 200;
const versions = new Map<string, { version: Promise<string>; at: number }>();
const metas = new Map<string, Promise<Meta>>();
const bollywoods = new Map<string, Promise<BollywoodFile | undefined>>();
const shards = new Map<string, Promise<Record<string, unknown>>>();

/** Forgets every cached file. For tests. */
export function forgetSiteData(): void {
  versions.clear();
  metas.clear();
  bollywoods.clear();
  shards.clear();
}

async function getJson<T>(url: string, upstream: typeof fetch): Promise<T> {
  const res = await upstream(url);
  if (!res.ok || !res.headers.get('content-type')?.includes('json')) throw new Error(`Couldn't read ${url} (HTTP ${res.status})`);
  return (await res.json()) as T;
}

/** Remembers a fetch, but forgets a failure so the next request tries again. */
function remember<T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
  let p = cache.get(key);
  if (!p) {
    p = load();
    cache.set(key, p);
    p.catch(() => cache.delete(key));
  }
  return p;
}

async function siteData(origin: string, upstream: typeof fetch): Promise<RouteData> {
  let current = versions.get(origin);
  if (!current || Date.now() - current.at > VERSION_TTL_MS) {
    current = { version: getJson<{ version: string }>(`${origin}/data/version.json`, upstream).then((v) => v.version), at: Date.now() };
    versions.set(origin, current);
    current.version.catch(() => versions.delete(origin));
  }
  const base = `${origin}/data/v/${await current.version}/`;
  const meta = await remember(metas, base, () => getJson<Meta>(`${base}meta.json`, upstream));
  const row = async (url: string, id: number) => {
    const shard = await remember(shards, url, () => getJson<Record<string, unknown>>(url, upstream));
    // Oldest out first: a Map keeps insertion order.
    while (shards.size > MAX_SHARDS) shards.delete(shards.keys().next().value!);
    return shard[id];
  };
  return {
    meta,
    person: async (id) => (await row(`${base}p/${id % meta.shards}.json`, id)) as PersonRow | undefined,
    // Data built before the other stars has none of their files, nor any stars to ask about.
    toward: async (star, id, hard = false) =>
      meta.targetShards ? ((await row(`${base}t/${star}${hard ? '-hard' : ''}/${id % meta.targetShards}.json`, id)) as TargetRow | undefined) : undefined,
    // Nor, before Bollywood mode, a Bollywood file: Bollywood stars come with it.
    bollywood: () =>
      meta.targets?.some((t) => t.world === 'bollywood')
        ? remember(bollywoods, base, () => getJson<BollywoodFile>(`${base}bollywood.json`, upstream))
        : Promise.resolve(undefined),
  };
}

/** An IPv6 address as its eight groups, or null if it isn't one. */
function ipv6Groups(address: string): number[] | null {
  const halves = address.split('::');
  if (halves.length > 2) return null;
  const parse = (part: string): number[] | null => {
    if (part === '') return [];
    const groups: number[] = [];
    const pieces = part.split(':');
    for (const [i, piece] of pieces.entries()) {
      if (i === pieces.length - 1 && piece.includes('.')) {
        // An IPv4 address written into the last two groups, as in ::ffff:203.0.113.7.
        const bytes = piece.split('.').map((b) => (/^\d{1,3}$/.test(b) ? Number(b) : NaN));
        if (bytes.length !== 4 || bytes.some((b) => !(b <= 255))) return null;
        groups.push((bytes[0] << 8) | bytes[1], (bytes[2] << 8) | bytes[3]);
      } else if (/^[0-9a-f]{1,4}$/.test(piece)) groups.push(parseInt(piece, 16));
      else return null;
    }
    return groups;
  };
  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  if (!head || !tail) return null;
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  return [...head, ...new Array<number>(missing).fill(0), ...tail];
}

/**
 * What a connection is counted by: an IPv4 address as it is (also when written as IPv6,
 * ::ffff:a.b.c.d), an IPv6 one by its first `prefix` bits. Anything else is kept as given.
 */
export function sourceAddress(ip: string, prefix: 64 | 48 = 64): string {
  const address = ip.trim().toLowerCase();
  if (!address.includes(':')) return address;
  const g = ipv6Groups(address.replace(/%.*$/, ''));
  if (!g) return address;
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return [g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255].join('.');
  return `${g.slice(0, prefix / 16).map((x) => x.toString(16)).join(':')}::/${prefix}`;
}

/** A key the database counts by: 16 characters of an HMAC of what's counted (see sourceAddress). */
export async function sourceKey(counted: string, secret: string): Promise<string> {
  const text = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', text.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, text.encode(counted)));
  return btoa(String.fromCharCode(...mac.slice(0, 12)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

// Functions that return nothing are answered 204, and a 204 can't carry a body, not even an empty one.
const reply = (status: number, body: string) =>
  new Response(status === 204 || status === 205 ? null : body, { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const refuse = (status: number, message: string, code?: string) => reply(status, JSON.stringify(code ? { code, message } : { message }));
/** No code, so the game takes it as the server being away and keeps a result to send again. */
const unavailable = () => refuse(503, 'The game’s server isn’t answering. Try again later.');

/**
 * Handles a request to <site>/api/…, passing allowed writes on to Supabase with `upstream`.
 * `country` is Cloudflare's for the request, which is T1 for Tor.
 */
export async function handleWrite(request: Request, env: GateEnv, upstream: typeof fetch, country?: string): Promise<Response> {
  const url = new URL(request.url);
  const fn = url.pathname.startsWith(API_PATH) ? url.pathname.slice(API_PATH.length) : '';
  if (!WRITES.has(fn)) return refuse(404, 'Not found');
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } });

  // Another site's page could otherwise use its visitors to write here, each from their own
  // connection. Browsers only send another site a JSON POST if it agrees first (CORS), which
  // this never does, and they say where a request comes from.
  const site = request.headers.get('Sec-Fetch-Site');
  const origin = request.headers.get('Origin');
  if (!/^application\/json\b/i.test(request.headers.get('Content-Type') ?? '') || (site && site !== 'same-origin' && site !== 'none') || (origin && origin !== url.origin)) {
    return refuse(403, 'Only the game can send this.');
  }
  const { SUPABASE_URL, SUPABASE_SECRET_KEY, SOURCE_SECRET } = env;
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY || !SOURCE_SECRET) return unavailable();

  const text = await request.text();
  if (text.length > MAX_BODY) return refuse(413, 'That’s too long.');
  let args: unknown;
  try {
    args = JSON.parse(text);
  } catch {
    args = null;
  }
  if (!args || typeof args !== 'object' || Array.isArray(args)) return refuse(400, 'That isn’t a call.', '22023');

  // The function's own arguments only. The connection keys are the gate's to set.
  const call: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) if (/^p_[a-z_]+$/.test(k) && k !== 'p_source' && k !== 'p_wide') call[k] = v;
  // Only names the game itself would make: it's the database's look-alike check that keeps
  // members apart, and that's simplest over letters, digits and a little punctuation.
  if ('p_player_name' in call && (typeof call.p_player_name !== 'string' || !isValidName(call.p_player_name))) {
    return refuse(400, 'Names can only have letters, numbers, spaces and . - ’', '22023');
  }
  // The device's offset from UTC in minutes, which places the player's day (see
  // sixdegrees.player_day): a real time zone's, UTC-12 to UTC+14 in quarter hours.
  const offset = call.p_offset;
  if (offset != null && !(typeof offset === 'number' && Number.isInteger(offset) && offset >= -720 && offset <= 840 && offset % 15 === 0)) {
    return refuse(400, 'That isn’t a time zone.', '22023');
  }

  // A hint is the next step of a shortest route from where the player is: towards JT in
  // normal mode, towards the day's star (as the game picks it, never as the call says) in the
  // star and Bollywood dailies. Hard modes have none. It's only given once the database has
  // recorded the asking.
  let hint: { film: number; person: number } | null = null;
  if (fn === 'sixdegrees_hint') {
    const { p_day: day, p_mode: mode, p_person: person } = call;
    if (!isDayKey(day) || (mode !== 'normal' && mode !== 'star' && mode !== 'bollywood') || typeof person !== 'number' || !Number.isInteger(person) || person <= 0) {
      return refuse(400, 'There’s no hint for that.', '22023');
    }
    let step: [number, number] | undefined;
    try {
      const data = await siteData(url.origin, upstream);
      if (mode === 'normal') {
        const row = person === JT ? undefined : await data.person(person);
        step = row && [row[3], row[4]];
      } else {
        const puzzle = await dailyPuzzle(day, mode, data);
        const row = puzzle && person !== puzzle.goal ? await data.toward(puzzle.goal, person) : undefined;
        step = row && [row[1], row[2]];
      }
    } catch {
      return unavailable();
    }
    if (!step || !step[0] || !step[1]) return refuse(400, 'There’s no hint for that.', '22023');
    hint = { film: step[0], person: step[1] };
  }

  if (fn === 'sixdegrees_submit') {
    const { p_day: day, p_mode: mode, p_gave_up: gaveUp, p_route: route } = call;
    if (!isDayKey(day) || !isMode(mode) || typeof gaveUp !== 'boolean' || (route != null && typeof route !== 'string')) {
      return refuse(400, 'That isn’t a result.', '22023');
    }
    let data: RouteData;
    try {
      data = await siteData(url.origin, upstream);
    } catch {
      return unavailable();
    }
    try {
      const checked = await checkRoute({ day, mode, gaveUp, route: route || null }, data);
      // What the route shows, in place of what was claimed.
      call.p_par = checked.par;
      call.p_gave_up = checked.gaveUp;
      call.p_films = checked.films;
      call.p_first_film = checked.firstFilm;
      call.p_route = checked.route;
      // A give-up sent before results carried their route counts no films, so no hints either.
      if (typeof call.p_hints === 'number' && call.p_hints > checked.films) call.p_hints = checked.films;
    } catch (err) {
      if (err instanceof RouteError) return refuse(400, err.message, '22023');
      return unavailable();
    }
  }

  const ip = request.headers.get('CF-Connecting-IP') ?? '';
  const tor = country === 'T1';
  call.p_source = await sourceKey(tor ? 'tor' : sourceAddress(ip, 64), SOURCE_SECRET);
  call.p_wide = await sourceKey(tor ? 'tor' : sourceAddress(ip, 48), SOURCE_SECRET);

  const headers: Record<string, string> = { apikey: SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' };
  // Legacy keys are JWTs and go in Authorization too; the new secret keys must not.
  if (SUPABASE_SECRET_KEY.startsWith('eyJ')) headers.Authorization = `Bearer ${SUPABASE_SECRET_KEY}`;
  let res: Response;
  let body: string;
  try {
    res = await upstream(`${SUPABASE_URL.replace(/\/+$/, '')}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(call) });
    body = await res.text();
  } catch {
    return unavailable();
  }
  if (res.ok) return hint ? reply(200, JSON.stringify(hint)) : reply(res.status, body);

  // The database's own refusals (bad input, a cap, a taken name) carry a Postgres error code,
  // and go back for the game to show or act on. Anything else, such as PostgREST's own errors
  // (PGRST…, like a function the database doesn't have yet) or a key it won't take, means the
  // gate or the database isn't set up right. To the game that's the server being away, so
  // results wait and go again later.
  let code: unknown = null;
  try {
    code = (JSON.parse(body) as { code?: unknown }).code;
  } catch {
    // Not JSON: not the database's answer.
  }
  if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) && res.status !== 401 && res.status !== 403) return reply(res.status, body);
  return unavailable();
}
