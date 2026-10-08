import type { FilmRef, Loader, Mode, Person, Qid, Reach, SearchRow } from './types';

export const JT: Qid = 43432;

/** Daily #1. */
export const EPOCH = '2026-10-08';

export interface Step {
  film: FilmRef;
  person: Person;
}

/** Distance and first step towards JT in the given mode. */
export function reachIn(p: Person, mode: Mode): Reach {
  return mode === 'hard' ? p.hard : p.normal;
}

/** Follow parent pointers from `from` to JT. Uses only person shards: the film title is in the person's own credits. */
export async function optimalPath(from: Person, load: Loader, mode: Mode = 'normal'): Promise<Step[]> {
  const steps: Step[] = [];
  let cur = from;
  while (cur.id !== JT) {
    const { parentFilm, parentPerson } = reachIn(cur, mode);
    if (steps.length > 20 || !parentPerson) throw new Error(`Path from Q${from.id} doesn't reach JT`);
    const film = cur.films.find((f) => f.id === parentFilm);
    if (!film) throw new Error(`Q${cur.id} has no credit for Q${parentFilm}`);
    cur = await load.person(parentPerson);
    steps.push({ film, person: cur });
  }
  return steps;
}

export type Grade = 'closer' | 'same' | 'further';

export function grade(fromDist: number, toDist: number): Grade {
  if (toDist < fromDist) return 'closer';
  return toDist === fromDist ? 'same' : 'further';
}

const GRADE_EMOJI: Record<Grade, string> = { closer: '🟩', same: '🟨', further: '🟥' };

export interface MoveSummary {
  grade: Grade;
  hinted: boolean;
}

export function emojiRow(moves: MoveSummary[]): string {
  return moves.map((m) => (m.hinted ? '💡' : GRADE_EMOJI[m.grade])).join('');
}

export interface ShareInput {
  daily: number | null;
  mode: Mode;
  start: string;
  moves: MoveSummary[];
  par: number;
  gaveUp: boolean;
  url: string;
  /** How the player did against everyone that day, e.g. "Beat 72% of players". */
  standing?: string | null;
}

export function shareText(s: ShareInput): string {
  const title = (s.daily === null ? 'Six Degrees of JT' : `Six Degrees of JT #${s.daily}`) + (s.mode === 'hard' ? ' (hard)' : '');
  const result = s.gaveUp
    ? `gave up after ${plural(s.moves.length, 'film')} (par ${s.par})`
    : `${plural(s.moves.length, 'film')} (par ${s.par})`;
  return [title, `${s.start} → Justin Timberlake`, `${emojiRow(s.moves)} ${result}`.trim(), s.standing, s.url].filter(Boolean).join('\n');
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Lowercase and strip accents, so "pele" finds "Pelé". */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

export interface SearchHit {
  row: SearchRow;
  /** The nickname that matched, when the match wasn't on the name itself. */
  alias?: string;
}

/**
 * Build a ranked people search over the autocomplete index (already sorted best known first).
 * Rank: exact name, exact nickname ("CR7"), name prefix, nickname prefix, every query word
 * starting a name word, then substring. A real name beats a nickname at the same rank, so
 * "Ronaldo" finds Ronaldo Nazário before Cristiano Ronaldo (whose nickname it is).
 */
export function makeSearch(index: SearchRow[]): (query: string, limit?: number) => SearchHit[] {
  const words = (s: string) => s.split(/[\s\-.'’]+/).filter(Boolean);
  const folded = index.map((row) => {
    const name = fold(row[1]);
    return { row, name, words: words(name), aliases: (row[6] ?? []).map((a) => ({ alias: a, key: fold(a) })) };
  });
  return (query, limit = 8) => {
    const q = fold(query).trim().replace(/\s+/g, ' ');
    if (!q) return [];
    const qWords = q.split(' ');
    const buckets: SearchHit[][] = [[], [], [], [], [], []];
    for (const { row, name, words: nameWords, aliases } of folded) {
      if (name === q) buckets[0].push({ row });
      else if (aliases.some((a) => a.key === q)) buckets[1].push({ row, alias: aliases.find((a) => a.key === q)!.alias });
      else if (name.startsWith(q)) buckets[2].push({ row });
      else if (aliases.some((a) => a.key.startsWith(q))) buckets[3].push({ row, alias: aliases.find((a) => a.key.startsWith(q))!.alias });
      else if (qWords.every((w) => nameWords.some((nw) => nw.startsWith(w)))) buckets[4].push({ row });
      else if (name.includes(q)) buckets[5].push({ row });
    }
    return buckets.flat().slice(0, limit);
  };
}

export function filterByText<T>(items: T[], query: string, text: (item: T) => string): T[] {
  const q = fold(query).trim();
  return q ? items.filter((it) => fold(text(it)).includes(q)) : items;
}

/** Local calendar date as YYYY-MM-DD. */
export function dayKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const DAY_MS = 86_400_000;

export function dayNumber(key: string): number {
  const ms = Date.parse(`${key}T00:00:00Z`) - Date.parse(`${EPOCH}T00:00:00Z`);
  return Math.round(ms / DAY_MS) + 1;
}

/** The YYYY-MM-DD of daily number n (1 = EPOCH). */
export function dayOfNumber(n: number): string {
  return new Date(Date.parse(`${EPOCH}T00:00:00Z`) + (n - 1) * DAY_MS).toISOString().slice(0, 10);
}

/** A real calendar date between the first daily and `today`, inclusive. */
export function isPlayableDay(key: string, today: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || Number.isNaN(Date.parse(`${key}T00:00:00Z`))) return false;
  return dayOfNumber(dayNumber(key)) === key && key >= EPOCH && key <= today;
}

/** FNV-1a, so every player gets the same start for a given day. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Rendezvous hashing: the day's pick is the pool member with the highest hash. A data
 * rebuild that adds or drops other people leaves the day's pick alone.
 */
export function dailyPick(pool: Qid[], key: string): Qid {
  if (pool.length === 0) throw new Error('Empty daily pool');
  let best = pool[0];
  let bestScore = -1;
  for (const id of pool) {
    const score = hash(`six-degrees:${key}:${id}`);
    if (score > bestScore || (score === bestScore && id < best)) {
      best = id;
      bestScore = score;
    }
  }
  return best;
}
