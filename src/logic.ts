import type { FilmRef, Loader, Person, Qid, SearchRow } from './types';

export const JT: Qid = 43432;

/** Daily #1. */
export const EPOCH = '2026-10-08';

export interface Step {
  film: FilmRef;
  person: Person;
}

/** Follow parent pointers from `from` to JT. Uses only person shards: the film title is in the person's own credits. */
export async function optimalPath(from: Person, load: Loader): Promise<Step[]> {
  const steps: Step[] = [];
  let cur = from;
  while (cur.id !== JT) {
    if (steps.length > 20) throw new Error(`Path from Q${from.id} doesn't reach JT`);
    const film = cur.films.find((f) => f.id === cur.parentFilm);
    if (!film) throw new Error(`Q${cur.id} has no credit for Q${cur.parentFilm}`);
    cur = await load.person(cur.parentPerson);
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
  start: string;
  moves: MoveSummary[];
  par: number;
  gaveUp: boolean;
  url: string;
}

export function shareText(s: ShareInput): string {
  const title = s.daily === null ? 'Six Degrees of JT' : `Six Degrees of JT #${s.daily}`;
  const result = s.gaveUp
    ? `gave up after ${plural(s.moves.length, 'film')} (par ${s.par})`
    : `${plural(s.moves.length, 'film')} (par ${s.par})`;
  return [title, `${s.start} → Justin Timberlake`, `${emojiRow(s.moves)} ${result}`.trim(), s.url].join('\n');
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Lowercase and strip accents, so "pele" finds "Pelé". */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

/**
 * Build a ranked name search over the autocomplete index (already sorted best known first).
 * Rank: exact name, then name prefix, then every query word starting a name word, then substring.
 */
export function makeSearch(index: SearchRow[]): (query: string, limit?: number) => SearchRow[] {
  const folded = index.map((r) => {
    const name = fold(r[1]);
    return { row: r, name, words: name.split(/[\s\-.'’]+/).filter(Boolean) };
  });
  return (query, limit = 8) => {
    const q = fold(query).trim().replace(/\s+/g, ' ');
    if (!q) return [];
    const qWords = q.split(' ');
    const buckets: SearchRow[][] = [[], [], [], []];
    for (const { row, name, words } of folded) {
      if (name === q) buckets[0].push(row);
      else if (name.startsWith(q)) buckets[1].push(row);
      else if (qWords.every((w) => words.some((nw) => nw.startsWith(w)))) buckets[2].push(row);
      else if (name.includes(q)) buckets[3].push(row);
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

export function dayNumber(key: string): number {
  const ms = Date.parse(`${key}T00:00:00Z`) - Date.parse(`${EPOCH}T00:00:00Z`);
  return Math.round(ms / 86_400_000) + 1;
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
