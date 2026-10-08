import { JT, fold } from './logic';
import type { Film, FilmRef, PersonRef, Qid } from './types';

/**
 * "Type a co-star": find people who share a film with the current person, without the
 * player picking the film first. Pure apart from the injected film loader, so it tests
 * without data or a DOM.
 */

export interface CostarHit {
  person: PersonRef;
  /** The best-known shared film the move can go through. */
  via: FilmRef;
  /** Other usable films they share, for a "+2 more films" note. */
  more: number;
}

interface Entry {
  person: PersonRef;
  name: string;
  words: string[];
  films: FilmRef[];
}

const splitWords = (s: string) => s.split(/[\s\-.'’]+/).filter(Boolean);

/**
 * How well a folded name matches a folded, space-normalised query, mirroring the start
 * search: 0 exact, 1 prefix, 2 every query word starts a name word, 3 substring, -1 none.
 */
export function nameRank(name: string, words: string[], q: string, qWords: string[]): number {
  if (name === q) return 0;
  if (name.startsWith(q)) return 1;
  if (qWords.every((w) => words.some((nw) => nw.startsWith(w)))) return 2;
  return name.includes(q) ? 3 : -1;
}

const normalise = (query: string) => fold(query).trim().replace(/\s+/g, ' ');

/** The best-known usable film, ties going to the earlier credit. */
export function bestFilm(films: FilmRef[], banned: ReadonlySet<Qid> = new Set()): FilmRef | undefined {
  let best: FilmRef | undefined;
  for (const f of films) {
    if (banned.has(f.id)) continue;
    if (!best || (f.fame ?? 0) > (best.fame ?? 0)) best = f;
  }
  return best;
}

/** Everyone who shares a loaded film with one person. */
export class CostarIndex {
  private readonly entries = new Map<Qid, Entry>();

  /** `self` is the person whose co-stars these are; they never match themselves. */
  constructor(
    private readonly self: Qid,
    private readonly banned: ReadonlySet<Qid> = new Set(),
  ) {}

  get size(): number {
    return this.entries.size;
  }

  add(film: Film): void {
    if (this.banned.has(film.id)) return;
    const ref: FilmRef = { id: film.id, title: film.title, year: film.year, fame: film.fame };
    for (const p of film.cast) {
      if (p.id === this.self) continue;
      let e = this.entries.get(p.id);
      if (!e) {
        const name = fold(p.name);
        e = { person: p, name, words: splitWords(name), films: [] };
        this.entries.set(p.id, e);
      }
      if (!e.films.some((f) => f.id === film.id)) e.films.push(ref);
    }
  }

  /**
   * Co-stars matching `query`, ranked like the name search (exact, prefix, word prefix,
   * substring), better-known people first within a rank, and JT above everyone.
   * `total` counts every match, so the caller can say how many were left out.
   */
  search(query: string, limit = Infinity): { hits: CostarHit[]; total: number } {
    const q = normalise(query);
    if (!q) return { hits: [], total: 0 };
    const qWords = q.split(' ');
    const matches: { e: Entry; rank: number }[] = [];
    for (const e of this.entries.values()) {
      const rank = nameRank(e.name, e.words, q, qWords);
      if (rank >= 0) matches.push({ e, rank: e.person.id === JT ? -1 : rank });
    }
    matches.sort(
      (a, b) =>
        a.rank - b.rank ||
        (b.e.person.fame ?? 0) - (a.e.person.fame ?? 0) ||
        b.e.films.length - a.e.films.length ||
        a.e.person.name.localeCompare(b.e.person.name),
    );
    const hits: CostarHit[] = [];
    for (const { e } of matches) {
      if (hits.length >= limit) break;
      const via = bestFilm(e.films, this.banned);
      if (via) hits.push({ person: e.person, via, more: e.films.filter((f) => !this.banned.has(f.id)).length - 1 });
    }
    return { hits, total: matches.length };
  }
}

export type FilmLoader = (id: Qid) => Promise<Film>;

/**
 * Loads one person's films a few at a time, best known first, feeding a CostarIndex.
 * Fetching only runs while someone is watching, so leaving the person stops the
 * downloads; what has loaded stays, and watching again resumes where it left off.
 */
export class CostarSearch {
  readonly index: CostarIndex;
  /** Films that will be searched (banned ones are skipped entirely). */
  readonly total: number;
  loaded = 0;
  failed = 0;
  private readonly queue: FilmRef[];
  private running = 0;
  private listener: (() => void) | null = null;

  constructor(
    person: { id: Qid; films: FilmRef[] },
    banned: ReadonlySet<Qid>,
    private readonly load: FilmLoader,
    // Shards are small, so this is about latency, not bandwidth: HTTP/2 runs these side by side.
    private readonly concurrency = 8,
  ) {
    this.index = new CostarIndex(person.id, banned);
    // Dedupe: a credit list can name the same film twice (e.g. two roles).
    const seen = new Set<Qid>();
    this.queue = person.films.filter((f) => !banned.has(f.id) && !seen.has(f.id) && seen.add(f.id));
    this.total = this.queue.length;
  }

  get done(): boolean {
    return this.loaded + this.failed >= this.total;
  }

  get watching(): boolean {
    return this.listener !== null;
  }

  /** Start or resume loading, calling `onChange` after each film lands. Replaces any earlier watcher. */
  watch(onChange: () => void): void {
    this.listener = onChange;
    this.pump();
  }

  /** Stop starting new fetches. Films already in flight still land in the index. */
  unwatch(): void {
    this.listener = null;
  }

  private pump(): void {
    while (this.listener && this.running < this.concurrency && this.queue.length > 0) {
      void this.fetch(this.queue.shift()!);
    }
  }

  private async fetch(ref: FilmRef): Promise<void> {
    this.running++;
    try {
      this.index.add(await this.load(ref.id));
      this.loaded++;
    } catch {
      // One missing film shouldn't sink the search; the status line counts failures.
      this.failed++;
    } finally {
      this.running--;
    }
    this.listener?.();
    this.pump();
  }
}
