import { WRITES } from './gate';
import type { MoveSummary } from './logic';
import type { Mode, Qid } from './types';

/*
 * The only part of the game with a server: anonymous daily results for the day's global
 * stats ("Beat 72% of players"), and group leaderboards. It talks to the sixdegrees_*
 * functions in supabase/schema.sql through Supabase's REST API, except for the ones that add
 * rows, which go through the Worker's gate on the site's own address (src/gate.ts).
 *
 * Without VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY at build time (local dev, CI,
 * forks) `online` is false and the game works as before, with those features hidden. Every
 * call can fail (offline, paused project); callers treat that as "not available right now".
 */

const BASE = import.meta.env.VITE_SUPABASE_URL?.replace(/\/+$/, '') ?? '';
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';
/** Relative to the site root, like the data files, so it works on any page. */
const API = (import.meta.env.VITE_API_URL ?? `${import.meta.env.BASE_URL}api/`).replace(/\/*$/, '/');

export const online = !!(BASE && KEY);

/** A failed call. `code` is Postgres's error code when the server refused, e.g. P0002 for a missing group. */
export class OnlineError extends Error {
  constructor(
    message: string,
    readonly code: string | null = null,
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 8000;

/** A signal that aborts after `ms`. AbortSignal.timeout is Safari 16+, so fall back by hand. */
function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  if (!online) throw new OnlineError('Not connected');
  const write = WRITES.has(fn);
  // The gate adds its own key; the public one is only for Supabase itself.
  const headers: Record<string, string> = write ? { 'Content-Type': 'application/json' } : { apikey: KEY, 'Content-Type': 'application/json' };
  // Legacy anon keys are JWTs and go in Authorization too; publishable keys must not.
  if (!write && KEY.startsWith('eyJ')) headers.Authorization = `Bearer ${KEY}`;
  let res: Response;
  try {
    res = await fetch(write ? `${API}rpc/${fn}` : `${BASE}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args), signal: timeoutSignal(TIMEOUT_MS) });
  } catch {
    throw new OnlineError('Couldn’t reach the server');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string; code?: string } | null;
    throw new OnlineError(body?.message ?? `HTTP ${res.status}`, body?.code ?? null);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

// ------------------------------------------------------------------ the player

const CLIENT_KEY = 'sixdeg:client';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function store(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

let memoryId: string | null = null;

/**
 * This browser's anonymous player id, made on first use. It works like a password for the
 * player's results and group memberships, so it's sent only to the server, never shown or
 * shared. Without storage it lasts for the visit.
 */
export function clientId(): string {
  const s = store();
  const saved = s?.getItem(CLIENT_KEY);
  if (saved && UUID_RE.test(saved)) return saved;
  memoryId ??= crypto.randomUUID();
  try {
    s?.setItem(CLIENT_KEY, memoryId);
  } catch {
    // Blocked: keep the in-memory id.
  }
  return memoryId;
}

// ------------------------------------------------------------------ results

export interface ResultUpload {
  day: string;
  mode: Mode;
  par: number;
  moves: MoveSummary[];
  /** [film, person] per move. */
  path: [Qid, Qid][];
  gaveUp: boolean;
  late: boolean;
}

/** The route as film-person pairs in base36, the same shape as a challenge link's path. */
export const routeCode = (path: [Qid, Qid][]) => path.map(([f, p]) => `${f.toString(36)}-${p.toString(36)}`).join('_');

export function uploadArgs(r: ResultUpload, client: string): Record<string, unknown> {
  return {
    p_client: client,
    p_day: r.day,
    p_mode: r.mode,
    p_films: r.moves.length,
    p_hints: r.moves.filter((m) => m.hinted).length,
    p_par: r.par,
    p_gave_up: r.gaveUp,
    p_late: r.late,
    p_first_film: r.path[0]?.[0] ?? null,
    // Given-up games too: the gate checks the route (src/route-check.ts), and the database
    // only keeps finished ones.
    p_route: r.path.length === 0 ? null : routeCode(r.path),
  };
}

/**
 * The device's offset from UTC in minutes, sent with every write that places the player's day.
 * The server decides whether a daily arrived on its day (sixdegrees.player_day in
 * supabase/schema.sql), so it's taken when sending, not when playing.
 */
export const utcOffset = () => -new Date().getTimezoneOffset();

const PENDING_KEY = 'sixdeg:pending';
const MAX_PENDING = 20;

/**
 * Whether a result the server didn't take is worth sending again later: it couldn't be
 * reached, or it was at its daily cap (54000) or storage budget (53100), which anyone can run
 * up with made-up ids. Those caps reset at UTC midnight, so a later try the same day can still
 * be on time; one that arrives after the player's own midnight counts as late. Anything else
 * it refused (bad or out-of-date input) won't go in later either.
 */
export const retryLater = (err: unknown) => err instanceof OnlineError && (err.code === null || err.code === '54000' || err.code === '53100');

function loadPending(): Record<string, unknown>[] {
  try {
    const list: unknown = JSON.parse(store()?.getItem(PENDING_KEY) ?? '[]');
    return Array.isArray(list) ? (list as Record<string, unknown>[]) : [];
  } catch {
    return [];
  }
}

function savePending(list: Record<string, unknown>[]): void {
  try {
    if (list.length) store()?.setItem(PENDING_KEY, JSON.stringify(list.slice(-MAX_PENDING)));
    else store()?.removeItem(PENDING_KEY);
  } catch {
    // Storage blocked: the result just isn't retried.
  }
}

/** The server's word on a result: whether it counted as late (played after its day). */
export interface Verdict {
  late: boolean;
}

/**
 * Sends a finished daily, and answers with the server's verdict on it (undefined if it
 * didn't go in). If the server can't be reached it's kept and sent with the next one (or on
 * the next visit); it still counts if that's before the player's midnight. The server keeps
 * only a player's first result per day and mode, so resending is harmless.
 */
export async function submitResult(r: ResultUpload): Promise<Verdict | undefined> {
  if (!online) return undefined;
  const mine = uploadArgs(r, clientId());
  const queue = [...loadPending(), mine];
  const failed: Record<string, unknown>[] = [];
  let verdict: Verdict | undefined;
  for (const args of queue) {
    try {
      const answer = await rpc<Verdict | null>('sixdegrees_submit', { ...args, p_offset: utcOffset() });
      if (args === mine && answer) verdict = answer;
    } catch (err) {
      if (retryLater(err)) failed.push(args);
    }
  }
  savePending(failed);
  return verdict;
}

/** Sends anything left over from an earlier visit. */
export function flushPending(): void {
  if (!online || loadPending().length === 0) return;
  const queue = loadPending();
  savePending([]);
  void (async () => {
    const failed: Record<string, unknown>[] = [];
    for (const args of queue) {
      try {
        await rpc('sixdegrees_submit', { ...args, p_offset: utcOffset() });
      } catch (err) {
        if (retryLater(err)) failed.push(args);
      }
    }
    if (failed.length) savePending([...failed, ...loadPending()]);
  })();
}

export interface DayStats {
  players: number;
  atPar: number;
  gaveUp: number;
  /** Finishers by films played. */
  films: Record<string, number>;
  /** The most common first film. */
  opener: { film: Qid; players: number } | null;
  /** Where this player stands, if they played that day. */
  me: { beat: number; sameOpener: number; sameRoute: number } | null;
}

/**
 * A hint in a daily (normal, or the star daily): the next film and person on a shortest route
 * from `person`. It comes from the server, which records the asking first, so the result
 * counts it (src/gate.ts).
 */
export const dailyHint = (day: string, mode: Mode, person: Qid) =>
  rpc<{ film: Qid; person: Qid }>('sixdegrees_hint', { p_client: clientId(), p_day: day, p_mode: mode, p_person: person });

export const dayStats = (day: string, mode: Mode) => rpc<DayStats>('sixdegrees_day', { p_day: day, p_mode: mode, p_client: clientId() });

/** Fewer players than this and a percentage says more about luck than about you. */
export const MIN_PLAYERS_FOR_STANDING = 10;

/** "Beat 72% of players", or null when there's too few players or nothing to boast about. */
export function standingText(s: DayStats, gaveUp: boolean): string | null {
  if (gaveUp || !s.me || s.players < MIN_PLAYERS_FOR_STANDING) return null;
  const pct = Math.floor((100 * s.me.beat) / (s.players - 1));
  return pct >= 1 ? `Beat ${pct}% of players` : null;
}

/**
 * The opening line of "Everyone today", as [before, highlighted, after]: the highlight is the
 * standing when there is one ("You [beat 72% of players] · 140 so far today.").
 */
export function everyoneLead(s: DayStats, gaveUp: boolean, late: boolean): [string, string | null, string] {
  const players = `${s.players} ${s.players === 1 ? 'player' : 'players'}`;
  if (late) return [`${players} played it on the day. Late plays like yours aren’t counted.`, null, ''];
  if (s.players <= 1) return ['You’re the first to play today. Come back later to see where you stand.', null, ''];
  if (s.players < MIN_PLAYERS_FOR_STANDING) return [`You’re one of the first ${players} today. Come back later to see where you stand.`, null, ''];
  const standing = standingText(s, gaveUp);
  if (standing) return ['You ', standing.replace(/^Beat/, 'beat'), ` · ${players} so far today.`];
  return [`${players} so far today.`, null, ''];
}

// ------------------------------------------------------------------ groups

export interface GroupResult {
  films: number;
  hints: number;
  par: number;
  gaveUp: boolean;
}

export interface GroupMember {
  /** Only for the group's starter to remove them by. Missing before the server had it. */
  id?: number;
  name: string;
  me: boolean;
  normal: GroupResult | null;
  hard: GroupResult | null;
  /** The star daily's. Missing before the server had it. */
  star?: GroupResult | null;
  week: { played: number; points: number };
}

export interface GroupBoard {
  code: string;
  name: string;
  member: boolean;
  /** This player started the group, so can remove members and replace its code. */
  owner?: boolean;
  members: GroupMember[];
}

export interface GroupSummary {
  code: string;
  name: string;
  members: number;
}

/** Group codes: 10 letters and digits, from an alphabet without look-alikes (see schema.sql). */
export const GROUP_CODE_RE = /^[a-hj-km-np-z2-9]{10}$/;

export const createGroup = (groupName: string, playerName: string) =>
  rpc<string>('sixdegrees_create_group', { p_client: clientId(), p_group_name: groupName, p_player_name: playerName, p_offset: utcOffset() });

export const joinGroup = (code: string, playerName: string) =>
  rpc<{ code: string; name: string }>('sixdegrees_join_group', { p_code: code, p_client: clientId(), p_player_name: playerName, p_offset: utcOffset() });

export const leaveGroup = (code: string) => rpc<null>('sixdegrees_leave_group', { p_code: code, p_client: clientId() });

/** For the group's starter: takes a member off the board. They can rejoin until the code changes. */
export const removeMember = (code: string, id: number) => rpc<null>('sixdegrees_remove_member', { p_code: code, p_client: clientId(), p_member: id });

/** For the group's starter: swaps the code for a new one, so the old invite link stops working. */
export const newGroupCode = (code: string) => rpc<string>('sixdegrees_new_code', { p_code: code, p_client: clientId() });

/** A group's board for `day`, or null if there's no such group. */
export const groupBoard = (code: string, day: string) => rpc<GroupBoard | null>('sixdegrees_group', { p_code: code, p_client: clientId(), p_day: day });

export const myGroups = () => rpc<GroupSummary[]>('sixdegrees_my_groups', { p_client: clientId() });

/** Lower is better, like the server's ranking: finished before gave up, then films, then hints. */
export function compareResults(a: GroupResult | null, b: GroupResult | null): number {
  const key = (r: GroupResult | null) => (r === null ? [2, 0, 0] : r.gaveUp ? [1, 0, 0] : [0, r.films, r.hints]);
  const [x, y] = [key(a), key(b)];
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}
