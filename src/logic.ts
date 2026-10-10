import type { BollywoodFile, FilmRef, Loader, Meta, Mode, Person, Qid, Reach, SearchRow, Target } from './types';

export const JT: Qid = 43432;
export const JT_NAME = 'Justin Timberlake';

/** Daily #1. */
export const EPOCH = '2026-10-08';

export interface Step {
  film: FilmRef;
  person: Person;
}

/**
 * Who a game heads for: JT, in either mode, or one of the other stars in meta.json's targets
 * (normal mode only, since hard mode is about JT's own films, except for Shah Rukh Khan in
 * Bollywood hard mode).
 */
export interface Goal {
  id: Qid;
  name: string;
  mode: Mode;
}

export const jtGoal = (mode: Mode = 'normal'): Goal => ({ id: JT, name: JT_NAME, mode });

/** The dailies that head for one of the other stars rather than JT: the star daily and Bollywood mode's two. */
export const starDaily = (mode: Mode): mode is 'star' | 'bollywood' | 'bollywood-hard' => mode === 'star' || bollywoodDaily(mode);

/** Bollywood mode's dailies, heading for Shah Rukh Khan: normal rules or hard. */
export const bollywoodDaily = (mode: Mode): mode is 'bollywood' | 'bollywood-hard' => mode === 'bollywood' || mode === 'bollywood-hard';

/** The modes with hard rules: banned films and no hints. */
export const hardRules = (mode: Mode) => mode === 'hard' || mode === 'bollywood-hard';

/**
 * The goal a game heads for: JT when it names no one (or JT), otherwise one of the build's
 * other stars, in normal mode (free play), the star daily or a Bollywood daily. Null for
 * anyone else, for another star in JT's hard mode, and for a star or Bollywood daily without one.
 */
export function goalFor(meta: Pick<Meta, 'targets'>, target: Qid | undefined, mode: Mode): Goal | null {
  if (target === undefined || target === JT) return starDaily(mode) ? null : jtGoal(mode);
  const star = meta.targets.find((t) => t.id === target);
  return star && mode !== 'hard' ? { id: star.id, name: star.name, mode } : null;
}

/** The star daily's star, and its par from the day's start. */
export interface DayStar {
  id: Qid;
  par: number;
}

/**
 * How many stars the star daily looks at, in the day's order. Each costs the Worker a file
 * read when it checks a result (src/route-check.ts), and it can make 50: with a route as long
 * as it checks (40 people), the day's start, its own files and the database, that leaves five.
 */
export const STAR_CANDIDATES = 5;

/** The stars the star daily can pick on `day`: free play's (not Bollywood's), from their first day. */
export const starsOn = (stars: Pick<Target, 'id' | 'from' | 'world'>[], day: string): Qid[] =>
  stars.filter((s) => !s.world && (!s.from || s.from <= day)).map((s) => s.id);

/**
 * The star daily: the day's start (dailyPick) heading for one of the other stars instead of
 * JT. Everyone gets the same star, by rendezvous hashing like dailyPick, so a rebuild that adds
 * or drops other stars leaves the day's alone. A star within one film of the start (or the
 * start themself) is passed over, since that would be a one-move game. `distance` is the
 * start's distance to a star, Infinity for none. Null when none of the first few will do.
 *
 * The game and the Worker both pick with this, so they always agree on the day's star.
 */
export async function starOfDay(
  stars: Pick<Target, 'id' | 'from' | 'world'>[],
  day: string,
  start: Qid,
  distance: (star: Qid) => Promise<number>,
): Promise<DayStar | null> {
  // A star added later only joins from their first day, so days already played never change.
  const ranked = starsOn(stars, day)
    .filter((id) => id !== start)
    .map((id) => ({ id, score: hash(`six-degrees-star:${day}:${id}`) }))
    .sort((a, b) => b.score - a.score || a.id - b.id)
    .slice(0, STAR_CANDIDATES);
  for (const { id } of ranked) {
    const par = await distance(id);
    if (par >= 2 && par !== Infinity) return { id, par };
  }
  return null;
}

/**
 * The Bollywood daily, in either mode: the day's start from the Bollywood stars the build
 * listed (bollywood.json), heading for Shah Rukh Khan. Picked like the JT daily but under its
 * own key: someone in both pools who wins one pick would otherwise very likely win the other,
 * and both dailies would start from them that day. The game and the Worker both pick with
 * this. Par is the start's distance to him.
 */
export function bollywoodOfDay(file: Pick<BollywoodFile, 'goal' | 'starts'>, day: string): { start: Qid; goal: Qid } | null {
  return file.starts.length > 0 ? { start: dailyPick(file.starts, `bollywood:${day}`), goal: file.goal } : null;
}

/** The goal as a route's `target`: left out for JT. */
export const targetOf = (goal: Goal): Qid | undefined => (goal.id === JT ? undefined : goal.id);

/** Distance and first step towards JT in the given mode. */
export function reachIn(p: Person, mode: Mode): Reach {
  return mode === 'hard' ? p.hard : p.normal;
}

/** Distance and first step towards the goal: JT's are in the person's own row, another star's in their files. */
export function reachTo(p: Person, goal: Goal, load: Loader): Promise<Reach> {
  return goal.id === JT ? Promise.resolve(reachIn(p, goal.mode)) : load.reach(goal.id, p.id, hardRules(goal.mode));
}

/** Follow parent pointers from `from` to the goal. Uses no film shards: the film title is in the person's own credits. */
export async function optimalPath(from: Person, load: Loader, goal: Goal = jtGoal()): Promise<Step[]> {
  const steps: Step[] = [];
  let cur = from;
  while (cur.id !== goal.id) {
    const { parentFilm, parentPerson } = await reachTo(cur, goal, load);
    if (steps.length > 20 || !parentPerson) throw new Error(`Path from Q${from.id} doesn't reach Q${goal.id}`);
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
  /** Who the game headed for; JT when left out. */
  goal?: Goal;
  moves: MoveSummary[];
  par: number;
  gaveUp: boolean;
  url: string;
  /** How the player did against everyone that day, e.g. "Beat 72% of players". */
  standing?: string | null;
}

export function shareText(s: ShareInput): string {
  const other = s.goal && s.goal.id !== JT ? s.goal.name : null;
  const title = `Six Degrees of ${other ?? 'JT'}` + (s.daily === null ? '' : ` #${s.daily}`) + (hardRules(s.mode) ? ' (hard)' : '');
  const result = s.gaveUp
    ? `gave up after ${plural(s.moves.length, 'film')} (par ${s.par})`
    : `${plural(s.moves.length, 'film')} (par ${s.par})`;
  return [title, `${s.start} → ${other ?? JT_NAME}`, `${emojiRow(s.moves)} ${result}`.trim(), s.standing, s.url].filter(Boolean).join('\n');
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
