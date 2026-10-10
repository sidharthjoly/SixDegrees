import { addDays, isDayKey } from './days';
import { hardRules, type Grade } from './logic';
import type { DailyRecord } from './storage';
import type { Mode } from './types';

/**
 * "Your charts": totals, par rate, score distribution and streaks, all derived from the
 * daily records saved in this browser. Pure, so it can be tested without a DOM.
 */

/** Where one finished daily lands on the score chart. */
export type Bucket = 'par' | 'plus1' | 'plus2' | 'plus3' | 'gaveUp';
export const BUCKETS: Bucket[] = ['par', 'plus1', 'plus2', 'plus3', 'gaveUp'];

export interface ModeStats {
  played: number;
  /** Finished without giving up. */
  completed: number;
  /** Finished in par films (hints allowed: the share already shows them). */
  parOrBetter: number;
  distribution: Record<Bucket, number>;
}

export interface Streaks {
  /** Run of days with an on-time daily (see streakDays) ending today, or yesterday when today isn't played yet. */
  current: number;
  best: number;
}

export interface Stats {
  normal: ModeStats;
  hard: ModeStats;
  star: ModeStats;
  bollywood: ModeStats;
  'bollywood-hard': ModeStats;
  streak: Streaks;
}

const GRADES: readonly Grade[] = ['closer', 'same', 'further'];

/**
 * Records come from localStorage, which anyone can edit and older builds may have written.
 * storage.ts only checks the outline, so check every field the charts read, and drop
 * future-dated ones (the clock was changed): a bad record must never take down the page.
 */
export function isUsable(r: DailyRecord, today: string): boolean {
  return (
    isDayKey(r.day) &&
    r.day <= today &&
    ['normal', 'hard', 'star', 'bollywood', 'bollywood-hard'].includes(r.mode) &&
    Number.isInteger(r.par) &&
    r.par >= 1 &&
    typeof r.gaveUp === 'boolean' &&
    Array.isArray(r.moves) &&
    r.moves.every((m) => !!m && GRADES.includes(m.grade))
  );
}

export function bucketOf(r: Pick<DailyRecord, 'moves' | 'par' | 'gaveUp'>): Bucket {
  if (r.gaveUp) return 'gaveUp';
  const over = r.moves.length - r.par;
  return over <= 0 ? 'par' : over === 1 ? 'plus1' : over === 2 ? 'plus2' : 'plus3';
}

export function modeStats(records: DailyRecord[], mode: Mode): ModeStats {
  const distribution: Record<Bucket, number> = { par: 0, plus1: 0, plus2: 0, plus3: 0, gaveUp: 0 };
  let played = 0;
  for (const r of records) {
    if (r.mode !== mode) continue;
    played++;
    distribution[bucketOf(r)]++;
  }
  return { played, completed: played - distribution.gaveUp, parOrBetter: distribution.par, distribution };
}

/**
 * Days that keep a streak alive: a daily finished on its own day without giving up, the JT one,
 * the star daily (for anyone who'd rather not end up at JT) or the Bollywood daily. Hard modes
 * are extra.
 */
export function streakDays(records: DailyRecord[]): Set<string> {
  // `late !== false` rather than `late`: a record missing the flag can't prove it was on time.
  return new Set(records.filter((r) => !hardRules(r.mode) && r.late === false && !r.gaveUp).map((r) => r.day));
}

export function streaks(days: Set<string>, today: string): Streaks {
  let best = 0;
  for (const day of days) {
    // Count each run once, from its first day.
    if (days.has(addDays(day, -1))) continue;
    let len = 1;
    while (days.has(addDays(day, len))) len++;
    best = Math.max(best, len);
  }
  // Today still counts as "in progress": a streak ending yesterday is alive until midnight.
  let end = days.has(today) ? today : addDays(today, -1);
  let current = 0;
  while (days.has(end)) {
    current++;
    end = addDays(end, -1);
  }
  return { current, best };
}

export function computeStats(all: DailyRecord[], today: string): Stats {
  const records = all.filter((r) => isUsable(r, today));
  return {
    normal: modeStats(records, 'normal'),
    hard: modeStats(records, 'hard'),
    star: modeStats(records, 'star'),
    bollywood: modeStats(records, 'bollywood'),
    'bollywood-hard': modeStats(records, 'bollywood-hard'),
    streak: streaks(streakDays(records), today),
  };
}

/** Whole-number percentage, or null when there's nothing to divide by. */
export function percent(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((100 * part) / whole) : null;
}
