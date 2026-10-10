import { describe, expect, it } from 'vitest';
import type { MoveSummary } from './logic';
import { bucketOf, computeStats, isUsable, modeStats, percent, streakDays, streaks } from './scores';
import type { DailyRecord } from './storage';

const TODAY = '2026-10-20';

const moves = (n: number, hinted = 0): MoveSummary[] => Array.from({ length: n }, (_, i) => ({ grade: 'closer', hinted: i < hinted }));

const rec = (day: string, over: Partial<DailyRecord> = {}): DailyRecord => ({
  v: 2,
  day,
  mode: 'normal',
  start: 11571,
  par: 3,
  moves: moves(3),
  path: [],
  gaveUp: false,
  late: false,
  at: `${day}T20:00:00.000Z`,
  ...over,
});

const days = (...list: string[]) => new Set(list);

describe('bucketOf', () => {
  it('sorts results by films over par', () => {
    expect(bucketOf({ moves: moves(3), par: 3, gaveUp: false })).toBe('par');
    expect(bucketOf({ moves: moves(4), par: 3, gaveUp: false })).toBe('plus1');
    expect(bucketOf({ moves: moves(5), par: 3, gaveUp: false })).toBe('plus2');
    expect(bucketOf({ moves: moves(6), par: 3, gaveUp: false })).toBe('plus3');
    expect(bucketOf({ moves: moves(12), par: 3, gaveUp: false })).toBe('plus3');
    expect(bucketOf({ moves: moves(1), par: 3, gaveUp: true })).toBe('gaveUp');
  });

  it('counts a hinted par as par', () => {
    expect(bucketOf({ moves: moves(3, 2), par: 3, gaveUp: false })).toBe('par');
  });
});

describe('modeStats', () => {
  it('counts each mode on its own', () => {
    const all = [
      rec('2026-10-10'),
      rec('2026-10-11', { moves: moves(4) }),
      rec('2026-10-12', { gaveUp: true, moves: moves(2) }),
      rec('2026-10-13', { late: true, moves: moves(7) }),
      rec('2026-10-10', { mode: 'hard', par: 4, moves: moves(4) }),
      rec('2026-10-11', { mode: 'hard', par: 4, gaveUp: true }),
    ];
    expect(modeStats(all, 'normal')).toEqual({ played: 4, completed: 3, parOrBetter: 1, distribution: { par: 1, plus1: 1, plus2: 0, plus3: 1, gaveUp: 1 } });
    expect(modeStats(all, 'hard')).toEqual({ played: 2, completed: 1, parOrBetter: 1, distribution: { par: 1, plus1: 0, plus2: 0, plus3: 0, gaveUp: 1 } });
  });

  it('keeps star dailies’ scores to themselves, while they keep the streak going', () => {
    const all = [rec('2026-10-18'), rec('2026-10-19', { mode: 'star', target: 3454165, par: 2, moves: moves(2) }), rec('2026-10-20')];
    const stats = computeStats(all, TODAY);
    expect(stats.star).toEqual({ played: 1, completed: 1, parOrBetter: 1, distribution: { par: 1, plus1: 0, plus2: 0, plus3: 0, gaveUp: 0 } });
    expect(stats.normal.played).toBe(2);
    expect(stats.streak).toEqual({ current: 3, best: 3 });
  });

  it('is all zeros with nothing played', () => {
    expect(modeStats([], 'normal')).toEqual({ played: 0, completed: 0, parOrBetter: 0, distribution: { par: 0, plus1: 0, plus2: 0, plus3: 0, gaveUp: 0 } });
  });
});

describe('streakDays', () => {
  it('counts the JT, star and Bollywood dailies finished on their own day, not hard mode', () => {
    const all = [
      rec('2026-10-10'),
      rec('2026-10-11', { late: true }),
      rec('2026-10-12', { gaveUp: true }),
      rec('2026-10-13', { mode: 'hard' }),
      rec('2026-10-14', { late: undefined as unknown as boolean }),
      rec('2026-10-15', { moves: moves(9) }),
      rec('2026-10-16', { mode: 'star', target: 3454165 }),
      rec('2026-10-17', { mode: 'star', target: 3454165, late: true }),
      rec('2026-10-18', { mode: 'bollywood', target: 9535 }),
      rec('2026-10-19', { mode: 'bollywood-hard', target: 9535 }),
    ];
    expect([...streakDays(all)].sort()).toEqual(['2026-10-10', '2026-10-15', '2026-10-16', '2026-10-18']);
  });
});

describe('streaks', () => {
  it('is zero with nothing played', () => {
    expect(streaks(days(), TODAY)).toEqual({ current: 0, best: 0 });
  });

  it('counts a run ending today', () => {
    expect(streaks(days('2026-10-18', '2026-10-19', '2026-10-20'), TODAY)).toEqual({ current: 3, best: 3 });
  });

  it('keeps a run ending yesterday alive until today is over', () => {
    expect(streaks(days('2026-10-18', '2026-10-19'), TODAY)).toEqual({ current: 2, best: 2 });
  });

  it('breaks after a missed day', () => {
    expect(streaks(days('2026-10-17', '2026-10-18'), TODAY)).toEqual({ current: 0, best: 2 });
  });

  it('remembers the best run separately', () => {
    const d = days('2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-13', '2026-10-19', '2026-10-20');
    expect(streaks(d, TODAY)).toEqual({ current: 2, best: 4 });
  });

  it('runs across month and year ends', () => {
    expect(streaks(days('2026-12-30', '2026-12-31', '2027-01-01'), '2027-01-01')).toEqual({ current: 3, best: 3 });
    expect(streaks(days('2028-02-28', '2028-02-29', '2028-03-01'), '2028-03-02')).toEqual({ current: 3, best: 3 });
  });

  it('is not fooled by daylight saving (Europe 25 Oct, US 1 Nov)', () => {
    const d = days('2026-10-24', '2026-10-25', '2026-10-26', '2026-10-31', '2026-11-01', '2026-11-02');
    expect(streaks(d, '2026-11-02')).toEqual({ current: 3, best: 3 });
  });
});

describe('isUsable and computeStats', () => {
  it('skips records that would break the charts', () => {
    const bad = [
      rec('2026-13-40'),
      rec('2026-10-21'), // in the future: the clock was changed
      rec('2026-10-10', { par: 0 }),
      rec('2026-10-10', { par: undefined as unknown as number }),
      rec('2026-10-10', { par: 2.5 }),
      rec('2026-10-10', { gaveUp: 'no' as unknown as boolean }),
      rec('2026-10-10', { moves: [{ grade: 'sideways' }] as unknown as MoveSummary[] }),
      rec('2026-10-10', { moves: [null] as unknown as MoveSummary[] }),
      rec(42 as unknown as string),
    ];
    for (const r of bad) expect(isUsable(r, TODAY)).toBe(false);
    expect(() => computeStats(bad, TODAY)).not.toThrow();
    expect(computeStats(bad, TODAY).normal.played).toBe(0);
    expect(isUsable(rec(TODAY), TODAY)).toBe(true);
  });

  it('puts it all together', () => {
    const all = [
      rec('2026-10-17'),
      rec('2026-10-18', { moves: moves(5) }),
      rec('2026-10-19', { moves: moves(4, 1) }),
      rec('2026-10-19', { mode: 'hard', par: 4, moves: moves(4) }),
      rec('2026-10-12', { late: true, gaveUp: true }),
    ];
    const s = computeStats(all, TODAY);
    expect(s.normal).toMatchObject({ played: 4, completed: 3, parOrBetter: 1 });
    expect(s.hard).toMatchObject({ played: 1, completed: 1, parOrBetter: 1 });
    expect(s.streak).toEqual({ current: 3, best: 3 });
  });
});

describe('percent', () => {
  it('rounds, and is null for nothing played', () => {
    expect(percent(1, 3)).toBe(33);
    expect(percent(2, 3)).toBe(67);
    expect(percent(0, 4)).toBe(0);
    expect(percent(0, 0)).toBeNull();
  });
});
