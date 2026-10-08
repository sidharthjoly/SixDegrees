import { describe, expect, it } from 'vitest';
import { GROUP_CODE_RE, MIN_PLAYERS_FOR_STANDING, compareResults, everyoneLead, online, routeCode, standingText, uploadArgs, type DayStats } from './online';

describe('online', () => {
  it('is off without the Supabase settings, as in tests and CI', () => {
    expect(online).toBe(false);
  });
});

describe('uploadArgs', () => {
  const base = {
    day: '2026-10-08',
    mode: 'normal' as const,
    par: 2,
    moves: [
      { grade: 'closer' as const, hinted: false },
      { grade: 'same' as const, hinted: true },
    ],
    path: [
      [100, 43432],
      [36, 71],
    ] as [number, number][],
    gaveUp: false,
    late: false,
  };

  it('sends the counts, the opener and the route', () => {
    expect(uploadArgs(base, 'id')).toEqual({
      p_client: 'id',
      p_day: '2026-10-08',
      p_mode: 'normal',
      p_films: 2,
      p_hints: 1,
      p_par: 2,
      p_gave_up: false,
      p_late: false,
      p_first_film: 100,
      p_route: '2s-xig_10-1z',
    });
  });

  it('leaves the route out when the player gave up, and the opener when they never moved', () => {
    expect(uploadArgs({ ...base, gaveUp: true }, 'id').p_route).toBeNull();
    const none = uploadArgs({ ...base, moves: [], path: [], gaveUp: true }, 'id');
    expect(none.p_first_film).toBeNull();
    expect(none.p_films).toBe(0);
  });

  it('writes routes in the same base36 shape as challenge links, which the server checks', () => {
    expect(routeCode([[35, 36]])).toBe('z-10');
    expect(routeCode([[1, 2], [3, 4]])).toMatch(/^[0-9a-z]+-[0-9a-z]+(_[0-9a-z]+-[0-9a-z]+)*$/);
  });
});

describe('standingText', () => {
  const stats = (players: number, beat: number): DayStats => ({ players, atPar: 0, gaveUp: 0, films: {}, opener: null, me: { beat, sameOpener: 0, sameRoute: 0 } });

  it('gives the share of the other players beaten, rounded down', () => {
    expect(standingText(stats(101, 72), false)).toBe('Beat 72% of players');
    expect(standingText(stats(11, 10), false)).toBe('Beat 100% of players');
    expect(standingText(stats(4, 2), false)).toBeNull();
  });

  it('stays quiet with too few players, after giving up, or with nobody beaten', () => {
    expect(standingText(stats(MIN_PLAYERS_FOR_STANDING - 1, 5), false)).toBeNull();
    expect(standingText(stats(50, 30), true)).toBeNull();
    expect(standingText(stats(50, 0), false)).toBeNull();
    expect(standingText({ ...stats(50, 0), me: null }, false)).toBeNull();
  });
});

describe('everyoneLead', () => {
  const stats = (players: number, beat: number): DayStats => ({ players, atPar: 0, gaveUp: 0, films: {}, opener: null, me: { beat, sameOpener: 0, sameRoute: 0 } });

  it('welcomes the first player of the day', () => {
    expect(everyoneLead(stats(1, 0), false, false)).toEqual(['You’re the first to play today. Come back later to see where you stand.', null, '']);
  });

  it('holds back the standing while there are few players', () => {
    expect(everyoneLead(stats(4, 3), false, false)[0]).toBe('You’re one of the first 4 players today. Come back later to see where you stand.');
  });

  it('highlights the standing once there are enough', () => {
    expect(everyoneLead(stats(101, 72), false, false)).toEqual(['You ', 'beat 72% of players', ' · 101 players so far today.']);
    expect(everyoneLead(stats(101, 72), true, false)).toEqual(['101 players so far today.', null, '']);
  });

  it('explains that late plays aren’t counted', () => {
    expect(everyoneLead(stats(1, 0), false, true)[0]).toBe('1 player played it on the day. Late plays like yours aren’t counted.');
  });
});

describe('compareResults', () => {
  const r = (films: number, hints = 0, gaveUp = false) => ({ films, hints, par: 2, gaveUp });

  it('ranks fewer films, then fewer hints, then giving up, then not playing', () => {
    const sorted = [null, r(3), r(1, 0, true), r(2, 1), r(2)].sort(compareResults);
    expect(sorted).toEqual([r(2), r(2, 1), r(3), r(1, 0, true), null]);
  });
});

describe('GROUP_CODE_RE', () => {
  it('matches the codes the server makes', () => {
    expect(GROUP_CODE_RE.test('nhdxc4tcbv')).toBe(true);
    expect(GROUP_CODE_RE.test('nhdxc4tcbl')).toBe(false);
    expect(GROUP_CODE_RE.test('NHDXC4TCBV')).toBe(false);
    expect(GROUP_CODE_RE.test('short')).toBe(false);
  });
});
