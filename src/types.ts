export type Qid = number;

/** Wire formats written by scripts/build_graph.py. */
export type PersonRow = [name: string, fame: number, dist: number, parentFilm: Qid, parentPerson: Qid, films: [Qid, string, number | null][]];
export type FilmRow = [title: string, year: number | null, fame: number, cast: [Qid, string][]];
/** Autocomplete entry: qid, name, sitelinks, Timberlake number, best-known film. */
export type SearchRow = [Qid, string, number, number, string];

export interface Meta {
  built: string;
  people: number;
  films: number;
  histogram: Record<string, number>;
  daily: Qid[];
  jt: Qid;
  shards: number;
}

export interface FilmRef {
  id: Qid;
  title: string;
  year: number | null;
}

export interface PersonRef {
  id: Qid;
  name: string;
}

export interface Person extends PersonRef {
  /** Wikipedia sitelinks, used as a fame score. */
  fame: number;
  /** Films between this person and Justin Timberlake (their Timberlake number). */
  dist: number;
  /** First step of a shortest path to JT; 0 for JT himself. */
  parentFilm: Qid;
  parentPerson: Qid;
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
