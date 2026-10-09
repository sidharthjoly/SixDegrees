import { JT } from './logic';
import type { RouteData } from './route-check';
import type { PersonRow, Qid, Target, TargetRow } from './types';

/*
 * A made-up corner of the film graph, for tests of the route check (route-check.test.ts) and
 * the gate that runs it (gate.test.ts).
 *
 *   normal: START -F1- A -F2- JT          par 2
 *           START -F3- B -BANNED- JT      also 2, but BANNED is out in hard mode
 *   hard:   START -F3- B -F4- C -F5- JT   par 3
 *
 * NO_HARD only links to JT through a banned film, so hard mode can't start from them.
 *
 * Two other stars, for the star daily:
 *
 *   NEAR:   START -F1- NEAR                 one film, so the star daily passes them over
 *   FAR:    START -F3- B -F6- FAR           par 2
 */

export const START = 100;
export const A = 200;
export const B = 300;
export const C = 400;
export const NO_HARD = 500;
export const F1 = 1000;
export const F2 = 2000;
export const F3 = 3000;
export const F4 = 4000;
export const F5 = 5000;
export const F6 = 6000;
export const NEAR = 600;
export const FAR = 700;
/** The Social Network, one of hard mode's bans. */
export const BANNED = 185888;

const credits = (...ids: Qid[]) => ids.map((id): [Qid, string, number, number] => [id, `Film ${id}`, 2000, 1]);

export const ROWS: Record<Qid, PersonRow> = {
  [START]: ['Start', 1, 2, F1, A, credits(F1, F3), 3, F3, B],
  [A]: ['A', 1, 1, F2, JT, credits(F1, F2), 1, F2, JT],
  [B]: ['B', 1, 1, BANNED, JT, credits(F3, BANNED, F4, F6), 2, F4, C],
  [C]: ['C', 1, 1, F5, JT, credits(F4, F5), 1, F5, JT],
  [NO_HARD]: ['Only banned films', 1, 1, BANNED, JT, credits(BANNED), -1, 0, 0],
  [JT]: ['Justin Timberlake', 1, 0, 0, 0, credits(F2, BANNED, F5), 0, 0, 0],
  [NEAR]: ['Near Star', 1, 2, F1, A, credits(F1), 3, F1, START],
  [FAR]: ['Far Star', 1, 2, F6, B, credits(F6), 3, F6, B],
};

export const TARGETS: Target[] = [
  { id: NEAR, name: 'Near Star', film: `Film ${F1}` },
  { id: FAR, name: 'Far Star', film: `Film ${F6}` },
];

/** Each star's rows (t/<star>/…): distance and first step towards them. */
export const TOWARD: Record<Qid, Record<Qid, TargetRow>> = {
  [NEAR]: { [START]: [1, F1, NEAR], [A]: [1, F1, NEAR], [B]: [2, F3, START], [C]: [3, F4, B], [JT]: [2, F2, A], [NEAR]: [0, 0, 0], [FAR]: [3, F6, B] },
  [FAR]: { [START]: [2, F3, B], [A]: [3, F1, START], [B]: [1, F6, FAR], [C]: [2, F4, B], [JT]: [2, BANNED, B], [NEAR]: [3, F1, START], [FAR]: [0, 0, 0] },
};

const HARD_BANNED = [{ id: BANNED, title: 'The Social Network', year: 2010 }];

/** A route in the game's own form (routeCode in online.ts). */
export const route = (...steps: [Qid, Qid][]) => steps.map(([f, p]) => `${f.toString(36)}-${p.toString(36)}`).join('_');

export const fixtureData = (pool: Qid[] = [START], targets: Target[] = TARGETS): RouteData => ({
  meta: { daily: pool, hardBanned: HARD_BANNED, targets },
  person: async (id) => ROWS[id],
  toward: async (star, id) => TOWARD[star]?.[id],
});

/** The site's files for the same graph, as the gate reads them, or undefined for anything else. */
export function siteFile(url: string, origin: string, pool: Qid[] = [START], stars = true): Response | undefined {
  const SHARDS = 8;
  const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  const inShard = (rows: Record<Qid, unknown>, shard: string) => Object.fromEntries(Object.entries(rows).filter(([id]) => Number(id) % SHARDS === Number(shard)));
  if (url === `${origin}/data/version.json`) return json({ version: 'test' });
  // Without `stars`, the data from before there were other stars.
  if (url === `${origin}/data/v/test/meta.json`) return json({ daily: pool, hardBanned: HARD_BANNED, shards: SHARDS, ...(stars && { targets: TARGETS, targetShards: SHARDS }) });
  const shard = new RegExp(`^${origin}/data/v/test/p/(\\d+)\\.json$`).exec(url);
  if (shard) return json(inShard(ROWS, shard[1]));
  const toward = new RegExp(`^${origin}/data/v/test/t/(\\d+)/(\\d+)\\.json$`).exec(url);
  if (toward && stars && TOWARD[Number(toward[1])]) return json(inShard(TOWARD[Number(toward[1])], toward[2]));
  return undefined;
}
