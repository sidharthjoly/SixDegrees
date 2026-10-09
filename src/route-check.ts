import { JT, dailyPick, starOfDay, type DayStar } from './logic';
import type { Meta, Mode, PersonRow, Qid, TargetRow } from './types';

/*
 * The check the Worker's gate (src/gate.ts) makes on a daily result before it reaches the
 * database, against the same data the game plays on. The game runs in the browser, so a
 * result is only what the browser says; on its own word anyone could claim par every day.
 * This makes a result stand for a real route instead: the day's start comes from the daily
 * pool as the game picks it, par from the start's distance to JT, and every step must be a
 * film both people are credited in (hard mode's banned films excluded), ending at JT for a
 * finished game. The star daily heads for the day's star instead (starOfDay), with par from
 * the start's row towards them. Film count and opening film then come from the route, not the
 * claim.
 *
 * What it can't tell is how the route was found: a player who looked up the answer first
 * submits a real route. Hints happen in the browser too, so they stay as claimed; they only
 * ever count against a player.
 *
 * Reading one person shard per step, so `data` is passed in: the Worker reads the site's own
 * files, tests a few made-up rows.
 */

/**
 * Longest route checked. Each step reads a shard and a Worker can only make 50 requests (the
 * star daily's own reads are counted in STAR_CANDIDATES, logic.ts).
 * Par is never near this, so a longer route goes in unchecked, as a give-up: a finish, however
 * long, would rank above everyone who gave up, so it has to be a real one. The film count
 * stays; there's no route or opening film to count in the day's stats.
 */
export const MAX_CHECKED_STEPS = 40;

export interface RouteData {
  /** `targets` is missing from data built before there were other stars. */
  meta: Pick<Meta, 'daily' | 'hardBanned'> & Partial<Pick<Meta, 'targets'>>;
  /** A person's row, or undefined for someone the game doesn't have. */
  person(id: Qid): Promise<PersonRow | undefined>;
  /** A person's row towards one of the other stars, or undefined. */
  toward(star: Qid, id: Qid): Promise<TargetRow | undefined>;
}

/** The day's star daily, as the game picks it (starOfDay), or null when that day has none. */
export function dayStar(day: string, data: RouteData): Promise<DayStar | null> {
  const start = dailyPick(data.meta.daily, day);
  return starOfDay((data.meta.targets ?? []).map((t) => t.id), day, start, async (star) => {
    const row = await data.toward(star, start);
    return row && row[0] >= 0 ? row[0] : Infinity;
  });
}

export interface Claim {
  day: string;
  mode: Mode;
  gaveUp: boolean;
  /** Film-person pairs in base36 (see routeCode in online.ts); null when no move was made. */
  route: string | null;
}

/** What a result really was: what the database stores in place of what was claimed. */
export interface Checked {
  par: number;
  /** As claimed, unless the route was too long to check (see MAX_CHECKED_STEPS). */
  gaveUp: boolean;
  films: number;
  firstFilm: Qid | null;
  /** The route if it was checked, else null. */
  route: string | null;
}

/** A refusal, with a reason for whoever sent it. */
export class RouteError extends Error {}

/** Base36 QIDs of at most 7 characters, as in challenge links. */
const QID_RE = /^[1-9a-z][0-9a-z]{0,6}$/;

/** "2s-xig_10-1z" as [film, person] pairs, or null if it isn't one. */
export function parseRoute(route: string): [Qid, Qid][] | null {
  const steps: [Qid, Qid][] = [];
  for (const step of route.split('_')) {
    const parts = step.split('-');
    if (parts.length !== 2 || !QID_RE.test(parts[0]) || !QID_RE.test(parts[1])) return null;
    steps.push([parseInt(parts[0], 36), parseInt(parts[1], 36)]);
  }
  return steps;
}

const credited = (row: PersonRow, film: Qid) => row[5].some((credit) => credit[0] === film);

export async function checkRoute(claim: Claim, data: RouteData): Promise<Checked> {
  const start = dailyPick(data.meta.daily, claim.day);
  const [startRow, star] = await Promise.all([data.person(start), claim.mode === 'star' ? dayStar(claim.day, data) : null]);
  if (!startRow) throw new RouteError('That daily isn’t in the game.');
  if (claim.mode === 'star' && !star) throw new RouteError('That day has no star daily.');
  const goal = star?.id ?? JT;
  const par = star ? star.par : claim.mode === 'hard' ? startRow[6] : startRow[2];
  if (par < 0) throw new RouteError('That daily can’t be played in hard mode.');

  const steps = claim.route ? parseRoute(claim.route) : [];
  if (!steps) throw new RouteError('That route isn’t one.');
  if (!claim.gaveUp && steps.length === 0) throw new RouteError('A finished game needs its route.');
  if (steps.length > MAX_CHECKED_STEPS) return { par, gaveUp: true, films: steps.length, firstFilm: null, route: null };

  const rows = new Map<Qid, PersonRow | undefined>([[start, startRow]]);
  await Promise.all(
    [...new Set(steps.map(([, person]) => person))].filter((id) => !rows.has(id)).map(async (id) => rows.set(id, await data.person(id))),
  );
  const banned = new Set(claim.mode === 'hard' ? data.meta.hardBanned.map((f) => f.id) : []);
  let from = start;
  for (const [i, [film, to]] of steps.entries()) {
    const fromRow = rows.get(from)!;
    const toRow = rows.get(to);
    if (!toRow || to === from || banned.has(film) || !credited(fromRow, film) || !credited(toRow, film)) {
      throw new RouteError(`Move ${i + 1} of that route isn’t possible.`);
    }
    // Reaching the goal ends the game, so they're only ever the last step, and only of a finished one.
    if ((to === goal) !== (!claim.gaveUp && i === steps.length - 1)) throw new RouteError('That route doesn’t end where the game does.');
    from = to;
  }
  return { par, gaveUp: claim.gaveUp, films: steps.length, firstFilm: steps[0]?.[0] ?? null, route: claim.route && !claim.gaveUp ? claim.route : null };
}
