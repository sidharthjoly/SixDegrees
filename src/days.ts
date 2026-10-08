import { EPOCH } from './logic';

/**
 * Calendar arithmetic on YYYY-MM-DD strings. Everything runs in UTC, where every day is
 * exactly 24 hours long, so daylight saving and the player's time zone can't shift a date.
 * (Which date is "today" is still the player's local date: see dayKey in logic.ts.)
 */

const DAY_MS = 86_400_000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const msOf = (key: string) => Date.parse(`${key}T00:00:00Z`);

/** A real calendar date in YYYY-MM-DD form ("2026-02-30" is not). */
export function isDayKey(key: unknown): key is string {
  if (typeof key !== 'string' || !DAY_RE.test(key)) return false;
  const ms = msOf(key);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === key;
}

/** The date `n` days after `key` (before, when n is negative). */
export function addDays(key: string, n: number): string {
  return new Date(msOf(key) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `a` to `b`: 1 when b is the day after a. */
export function daysBetween(a: string, b: string): number {
  return Math.round((msOf(b) - msOf(a)) / DAY_MS);
}

/** Every daily from `today` back to Daily #1, newest first. Empty if the clock is before EPOCH. */
export function archiveDays(today: string): string[] {
  if (!isDayKey(today) || today < EPOCH) return [];
  const out: string[] = [];
  for (let d = today; d >= EPOCH; d = addDays(d, -1)) out.push(d);
  return out;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "Thu 8 Oct", with the year added when it isn't `today`'s year so a long archive stays
 * unambiguous. Hand-rolled rather than Intl so it reads the same in every browser.
 */
export function formatDay(key: string, today: string): string {
  const d = new Date(msOf(key));
  const base = `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  return key.slice(0, 4) === today.slice(0, 4) ? base : `${base} ${key.slice(0, 4)}`;
}
