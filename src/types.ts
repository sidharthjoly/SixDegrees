export type Qid = number;

/** Normal play, or hard mode: JT's best-known films are banned and there are no hints. */
export type Mode = 'normal' | 'hard';

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
  shards: number;
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

/** Distance to JT and the first step of a shortest path, for one mode. */
export interface Reach {
  /** Films between this person and JT; Infinity when this mode can't reach him. */
  dist: number;
  /** 0 for JT himself and for anyone unreachable. */
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
}
