export type Qid = number;

/**
 * Normal play; hard mode, where JT's best-known films are banned and there are no hints; the
 * star daily, the day's start heading for one of the other stars instead of JT; or Bollywood
 * mode's daily, from a Bollywood star to Shah Rukh Khan, and its hard mode, where his
 * best-known films are banned. The star daily and the Bollywood daily play by normal rules.
 * Free play towards another star is normal mode with a target.
 */
export type Mode = 'normal' | 'hard' | 'star' | 'bollywood' | 'bollywood-hard';

/** Wire formats written by scripts/build_graph.py. */
export type PersonRow = [
  name: string,
  fame: number,
  dist: number,
  parentFilm: Qid,
  parentPerson: Qid,
  films: [Qid, string, number | null, number][],
  hardDist: number,
  hardParentFilm: Qid,
  hardParentPerson: Qid,
];
export type FilmRow = [title: string, year: number | null, fame: number, cast: [Qid, string, number][]];
/** One person's first step towards one of the other stars (t/<star>/NN.json, or t/<star>-hard/ for Bollywood hard mode). */
export type TargetRow = [dist: number, parentFilm: Qid, parentPerson: Qid];
/** Autocomplete entry: qid, name, sitelinks, Timberlake number, best-known film, hard-mode number, nicknames. */
export type SearchRow = [Qid, string, number, number, string, number, string[]?];

export interface Meta {
  built: string;
  people: number;
  films: number;
  histogram: Record<string, number>;
  hardHistogram: Record<string, number>;
  /** Films excluded in hard mode. */
  hardBanned: FilmRef[];
  daily: Qid[];
  jt: Qid;
  /** JT's Bacon number: films between him and Kevin Bacon (null if they're not connected). */
  bacon: number | null;
  shards: number;
  /** The other stars free play can head for, in the order the home page lists them. */
  targets: Target[];
  targetShards: number;
}

export interface Target {
  id: Qid;
  name: string;
  /** Their best-known film. */
  film: string;
  /** The first day the star daily may pick them (YYYY-MM-DD); always, when left out. */
  from?: string;
  /** Bollywood mode's stars; the others are free play's and the star daily's. */
  world?: 'bollywood';
}

/** bollywood.json: Bollywood mode's daily and suggestions (see scripts/build_graph.py). */
export interface BollywoodFile {
  /** Who Bollywood mode heads for: Shah Rukh Khan. */
  goal: Qid;
  /** The Bollywood daily's starts: Bollywood stars at least two films from the goal. */
  starts: Qid[];
  /** Films excluded in Bollywood hard mode: the goal's best known. */
  hardBanned: FilmRef[];
  /** The best-known Bollywood names, for suggestions. */
  picks: [Qid, string][];
  /** How many Bollywood stars and Hindi films there are. */
  stars: number;
  films: number;
}

export interface FilmRef {
  id: Qid;
  title: string;
  year: number | null;
  /** Wikipedia sitelinks; 0 when unknown. */
  fame?: number;
}

export interface PersonRef {
  id: Qid;
  name: string;
  /** Wikipedia sitelinks; 0 when unknown. */
  fame?: number;
}

/** Distance to JT (or another star) and the first step of a shortest path, for one mode. */
export interface Reach {
  /** Films between this person and the star; Infinity when this mode can't reach them. */
  dist: number;
  /** 0 for the star themself and for anyone unreachable. */
  parentFilm: Qid;
  parentPerson: Qid;
}

export interface Person extends PersonRef {
  fame: number;
  normal: Reach;
  hard: Reach;
  /** Best known first. */
  films: FilmRef[];
}

export interface Film extends FilmRef {
  fame: number;
  /** Best known first. */
  cast: PersonRef[];
}

export interface Loader {
  person(id: Qid): Promise<Person>;
  film(id: Qid): Promise<Film>;
  /** How far `id` is from one of meta.json's other stars; with `hard`, without the films Bollywood hard mode bans. */
  reach(target: Qid, id: Qid, hard?: boolean): Promise<Reach>;
}
