import { JT } from './logic';
import type { RouteData } from './route-check';
import type { PersonRow, Qid } from './types';

/*
 * A made-up corner of the film graph, for tests of the route check (route-check.test.ts) and
 * the gate that runs it (gate.test.ts).
 *
 *   normal: START -F1- A -F2- JT          par 2
 *           START -F3- B -BANNED- JT      also 2, but BANNED is out in hard mode
 *   hard:   START -F3- B -F4- C -F5- JT   par 3
 *
 * NO_HARD only links to JT through a banned film, so hard mode can't start from them.
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
/** The Social Network, one of hard mode's bans. */
export const BANNED = 185888;

const credits = (...ids: Qid[]) => ids.map((id): [Qid, string, number, number] => [id, `Film ${id}`, 2000, 1]);

export const ROWS: Record<Qid, PersonRow> = {
  [START]: ['Start', 1, 2, F1, A, credits(F1, F3), 3, F3, B],
  [A]: ['A', 1, 1, F2, JT, credits(F1, F2), 1, F2, JT],
  [B]: ['B', 1, 1, BANNED, JT, credits(F3, BANNED, F4), 2, F4, C],
  [C]: ['C', 1, 1, F5, JT, credits(F4, F5), 1, F5, JT],
  [NO_HARD]: ['Only banned films', 1, 1, BANNED, JT, credits(BANNED), -1, 0, 0],
  [JT]: ['Justin Timberlake', 1, 0, 0, 0, credits(F2, BANNED, F5), 0, 0, 0],
};

const HARD_BANNED = [{ id: BANNED, title: 'The Social Network', year: 2010 }];

/** A route in the game's own form (routeCode in online.ts). */
export const route = (...steps: [Qid, Qid][]) => steps.map(([f, p]) => `${f.toString(36)}-${p.toString(36)}`).join('_');

export const fixtureData = (pool: Qid[] = [START]): RouteData => ({
  meta: { daily: pool, hardBanned: HARD_BANNED },
  person: async (id) => ROWS[id],
});

/** The site's files for the same graph, as the gate reads them, or undefined for anything else. */
export function siteFile(url: string, origin: string, pool: Qid[] = [START]): Response | undefined {
  const SHARDS = 8;
  const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  if (url === `${origin}/data/version.json`) return json({ version: 'test' });
  if (url === `${origin}/data/v/test/meta.json`) return json({ daily: pool, hardBanned: HARD_BANNED, shards: SHARDS });
  const shard = new RegExp(`^${origin}/data/v/test/p/(\\d+)\\.json$`).exec(url);
  if (shard) return json(Object.fromEntries(Object.entries(ROWS).filter(([id]) => Number(id) % SHARDS === Number(shard[1]))));
  return undefined;
}
