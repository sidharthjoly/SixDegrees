import { describe, expect, it } from 'vitest';
import { addDays } from './days';
import { JT, dailyPick, starOfDay } from './logic';
import { checkRoute, dayStar, MAX_CHECKED_STEPS, parseRoute, RouteError, type Claim } from './route-check';
import { A, B, BANNED, C, F1, F2, F3, F4, F5, F6, FAR, NEAR, NO_HARD, START, TARGETS, fixtureData, route } from './route-fixture';

const claim = (over: Partial<Claim>): Claim => ({ day: '2026-10-09', mode: 'normal', gaveUp: false, route: null, ...over });
const refused = async (c: Claim, data = fixtureData()) => {
  const err = await checkRoute(c, data).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(RouteError);
  return (err as RouteError).message;
};

describe('parseRoute', () => {
  it('reads the game’s base36 film-person pairs', () => {
    expect(parseRoute('rs-4q_1jk-xig')).toEqual([
      [1000, 170],
      [2000, 43432],
    ]);
  });

  it('refuses anything else', () => {
    for (const bad of ['', 'rs', 'rs-4q-1', 'rs-4q_', 'RS-4q', '0-4q', 'rs-4q__1jk-xig', 'abcdefgh-1']) expect(parseRoute(bad)).toBeNull();
  });
});

describe('checkRoute', () => {
  it('takes a real route, with par from the start and films from the route', async () => {
    const r = route([F1, A], [F2, JT]);
    expect(await checkRoute(claim({ route: r }), fixtureData())).toEqual({ par: 2, gaveUp: false, films: 2, firstFilm: F1, route: r });
    const longer = route([F3, B], [F4, C], [F5, JT]);
    expect(await checkRoute(claim({ route: longer }), fixtureData())).toEqual({ par: 2, gaveUp: false, films: 3, firstFilm: F3, route: longer });
  });

  it('starts from the day’s pick from the daily pool, as the game does', async () => {
    const pool = [START, A];
    const day = Array.from({ length: 60 }, (_, i) => addDays('2026-10-08', i)).find((d) => dailyPick(pool, d) === A)!;
    expect(await checkRoute(claim({ day, route: route([F2, JT]) }), fixtureData(pool))).toMatchObject({ par: 1, films: 1 });
    expect(await refused(claim({ day, route: route([F1, A], [F2, JT]) }), fixtureData(pool))).toMatch(/Move 1/);
  });

  it('uses hard mode’s par, and its bans', async () => {
    expect(await checkRoute(claim({ mode: 'hard', route: route([F3, B], [F4, C], [F5, JT]) }), fixtureData())).toMatchObject({ par: 3, films: 3 });
    expect(await checkRoute(claim({ route: route([F3, B], [BANNED, JT]) }), fixtureData())).toMatchObject({ par: 2, films: 2 });
    expect(await refused(claim({ mode: 'hard', route: route([F3, B], [BANNED, JT]) }))).toMatch(/Move 2/);
    expect(await refused(claim({ mode: 'hard', gaveUp: true }), fixtureData([NO_HARD]))).toMatch(/hard mode/);
  });

  it('refuses moves the game wouldn’t allow', async () => {
    expect(await refused(claim({ route: route([F2, A], [F2, JT]) }))).toMatch(/Move 1/); // the start isn't in F2
    expect(await refused(claim({ route: route([F1, B], [F3, JT]) }))).toMatch(/Move 1/); // B isn't in F1
    expect(await refused(claim({ route: route([F1, 999], [F2, JT]) }))).toMatch(/Move 1/); // nobody the game has
    expect(await refused(claim({ route: route([F1, START], [F1, A], [F2, JT]) }))).toMatch(/Move 1/); // to yourself
    expect(await refused(claim({ route: route([F1, A], [F2, B]) }))).toMatch(/Move 2/);
  });

  it('wants a finished game to end at JT, and only there', async () => {
    expect(await refused(claim({ route: route([F1, A]) }))).toMatch(/end/);
    expect(await refused(claim({ route: route([F1, A], [F2, JT], [F5, C]) }))).toMatch(/end/);
    expect(await refused(claim({ route: null }))).toMatch(/needs its route/);
    expect(await refused(claim({ route: 'not a route' }))).toMatch(/isn’t one/);
  });

  it('checks a given-up game’s moves, which mustn’t reach JT, and keeps no route for it', async () => {
    expect(await checkRoute(claim({ gaveUp: true, route: route([F1, A]) }), fixtureData())).toEqual({ par: 2, gaveUp: true, films: 1, firstFilm: F1, route: null });
    expect(await checkRoute(claim({ gaveUp: true, route: null }), fixtureData())).toEqual({ par: 2, gaveUp: true, films: 0, firstFilm: null, route: null });
    expect(await refused(claim({ gaveUp: true, route: route([F1, A], [F2, JT]) }))).toMatch(/end/);
  });

  it('takes a route too long to check as a give-up, so a made-up finish can’t outrank real give-ups', async () => {
    const steps = Array.from({ length: MAX_CHECKED_STEPS + 1 }, (): [number, number] => [F1, A]);
    const unchecked = { par: 2, gaveUp: true, films: MAX_CHECKED_STEPS + 1, firstFilm: null, route: null };
    expect(await checkRoute(claim({ route: route(...steps) }), fixtureData())).toEqual(unchecked);
    expect(await checkRoute(claim({ gaveUp: true, route: route(...steps) }), fixtureData())).toEqual(unchecked);
  });
});

describe('the star daily', () => {
  const star = (over: Partial<Claim>) => claim({ mode: 'star', ...over });
  const days = Array.from({ length: 60 }, (_, i) => addDays('2026-10-08', i));
  /** The first day whose top-ranked star is `id`, were every star far enough away. */
  const dayWithFirst = async (id: number) => {
    for (const day of days) if ((await starOfDay([NEAR, FAR], day, START, async () => 5))?.id === id) return day;
    throw new Error('no such day');
  };

  it('heads for the day’s star, passing over one within a film of the start', async () => {
    for (const day of [await dayWithFirst(NEAR), await dayWithFirst(FAR)]) {
      expect(await dayStar(day, fixtureData())).toEqual({ id: FAR, par: 2 });
      const r = route([F3, B], [F6, FAR]);
      expect(await checkRoute(star({ day, route: r }), fixtureData())).toEqual({ par: 2, gaveUp: false, films: 2, firstFilm: F3, route: r });
    }
  });

  it('has JT as just another co-star on the way, through any film', async () => {
    const r = route([F1, A], [F2, JT], [BANNED, B], [F6, FAR]);
    expect(await checkRoute(star({ route: r }), fixtureData())).toMatchObject({ par: 2, films: 4 });
  });

  it('wants a finished route to end at the star, not JT, and a given-up one never to reach them', async () => {
    expect(await refused(star({ route: route([F1, A], [F2, JT]) }))).toMatch(/end/);
    expect(await refused(star({ route: route([F3, B], [F6, FAR], [F6, B]) }))).toMatch(/end/);
    expect(await refused(star({ gaveUp: true, route: route([F3, B], [F6, FAR]) }))).toMatch(/end/);
    expect(await checkRoute(star({ gaveUp: true, route: route([F3, B]) }), fixtureData())).toEqual({ par: 2, gaveUp: true, films: 1, firstFilm: F3, route: null });
  });

  it('doesn’t exist without other stars, or when every star is within a film of the start', async () => {
    expect(await refused(star({ route: route([F3, B], [F6, FAR]) }), fixtureData([START], []))).toMatch(/no star daily/);
    expect(await refused(star({ gaveUp: true }), fixtureData([START], TARGETS.filter((t) => t.id === NEAR)))).toMatch(/no star daily/);
  });
});
