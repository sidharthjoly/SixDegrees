export type Qid = number;

/**
 * Normal play; hard mode, where JT's best-known films are banned and there are no hints; or
 * the star daily, the day's start heading for one of the other stars instead of JT (normal
 * rules). Free play towards another star is normal mode with a target.
 */
export type Mode = 'normal' | 'hard' | 'star';

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
/** One person's first step towards one of the other stars (t/<star>/NN.json). */
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
  /** How far `id` is from one of meta.json's other stars. */
  reach(target: Qid, id: Qid): Promise<Reach>;
}
