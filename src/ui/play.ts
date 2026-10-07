import { getFilm, getPerson, loadMeta, loader } from '../data';
import { JT, dayNumber, filterByText, grade, optimalPath, plural, reachIn, type Grade } from '../logic';
import type { Film, FilmRef, Mode, Person, PersonRef, Qid } from '../types';
import { h, yearOf, type Child } from './dom';
import { finish } from './result';
import { app, currentGeneration, isCurrent, renderError, renderLoading, renderMessage, topBar } from './shell';
import { tracks } from './tracks';

export interface Move {
  film: FilmRef;
  person: Person;
  grade: Grade;
  hinted: boolean;
}

export interface Game {
  /** The daily's date, or null for free play. */
  day: string | null;
  mode: Mode;
  /** Films that can't be used this game (hard mode's bans). */
  banned: Set<Qid>;
  /** A friend's result to beat, as the raw ?vs= code (decoded by the challenge feature). */
  vs: string | null;
  start: Person;
  moves: Move[];
  /** Film whose cast list is open, or null when choosing a film. */
  film: Film | null;
  filter: string;
  /** Hint shown for the move in progress. Always false in hard mode. */
  hint: boolean;
  busy: boolean;
}

let game: Game | null = null;

export const current = (g: Game): Person => g.moves.at(-1)?.person ?? g.start;
/** The current person's distance to JT in this game's mode (Infinity if unreachable). */
export const distOf = (g: Game, p: Person) => reachIn(p, g.mode).dist;
export const par = (g: Game) => distOf(g, g.start);

export interface StartOptions {
  qid: Qid;
  day: string | null;
  mode: Mode;
  vs: string | null;
}

export async function startGame(opts: StartOptions, gen: number): Promise<void> {
  renderLoading();
  game = null;
  const [start, meta] = await Promise.all([getPerson(opts.qid), loadMeta()]);
  if (!isCurrent(gen)) return;
  if (start.id === JT) {
    renderMessage('That’s Justin himself', 'He is zero films away from himself. Pick someone else.');
    return;
  }
  if (opts.mode === 'hard' && start.hard.dist === Infinity) {
    renderMessage('Not possible in hard mode', `${start.name} only links to Justin through films hard mode bans. Try normal mode.`);
    return;
  }
  game = {
    day: opts.day,
    mode: opts.mode,
    banned: new Set(opts.mode === 'hard' ? meta.hardBanned.map((f) => f.id) : []),
    vs: opts.vs,
    start,
    moves: [],
    film: null,
    filter: '',
    hint: false,
    busy: false,
  };
  document.title = `${start.name} → Justin Timberlake · Six Degrees`;
  renderPlay();
  window.scrollTo({ top: 0 });
}

function label(g: Game): string {
  return (g.day ? `Daily #${dayNumber(g.day)}` : 'Free play') + (g.mode === 'hard' ? ' · Hard' : '');
}

function renderPlay(scroll = false): void {
  const g = game!;
  const cur = current(g);
  const panel = playPanel(g, cur);
  app.replaceChildren(
    topBar(),
    h(
      'section',
      { class: 'status' },
      h('span', { class: 'pill' + (g.mode === 'hard' ? ' hard' : '') }, label(g)),
      h('h1', { class: 'task' }, g.start.name, h('span', { class: 'to' }, ' → '), 'Justin Timberlake'),
      h('dl', { class: 'meters' }, h('div', null, h('dt', null, 'Films'), h('dd', null, g.moves.length)), h('div', null, h('dt', null, 'Par'), h('dd', null, par(g)))),
    ),
    h(
      'div',
      { class: 'play' },
      h('div', { class: 'play-list' }, h('h2', { class: 'section-label' }, 'Your setlist'), tracks(g.start, g.moves, { pending: true })),
      h(
        'div',
        { class: 'play-main' },
        panel,
        h(
          'div',
          { class: 'actions' },
          h('button', { class: 'btn', type: 'button', disabled: g.busy || (g.moves.length === 0 && !g.film), onclick: undo }, '↶ Undo'),
          g.mode === 'normal' && h('button', { class: 'btn', type: 'button', disabled: g.busy || g.hint, onclick: showHint }, '💡 Hint'),
          h('button', { class: 'btn', type: 'button', disabled: g.busy, onclick: () => void giveUp() }, 'Show me the way'),
        ),
      ),
    ),
  );
  if (scroll && panel.getBoundingClientRect().top > window.innerHeight * 0.6) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function playPanel(g: Game, cur: Person): HTMLElement {
  const list = h('ul', { class: 'options' });
  const filter = h('input', {
    type: 'search',
    class: 'filter',
    value: g.filter,
    placeholder: g.film ? 'Filter cast' : 'Filter films',
    'aria-label': g.film ? 'Filter cast' : 'Filter films',
    autocomplete: 'off',
    oninput: () => {
      g.filter = filter.value;
      fill();
    },
  });
  const hintFilm = reachIn(cur, g.mode).parentFilm;
  const hintPerson = reachIn(cur, g.mode).parentPerson;
  let note: Child = null;
  let fill: () => void;

  if (!g.film) {
    const films = cur.films;
    const bannedHere = films.filter((f) => g.banned.has(f.id)).length;
    fill = () =>
      list.replaceChildren(
        ...filterByText(films, g.filter, (f) => f.title).map((f) => {
          const hinted = g.hint && f.id === hintFilm;
          const banned = g.banned.has(f.id);
          return h(
            'li',
            null,
            h(
              'button',
              { class: 'option' + (hinted ? ' hinted' : '') + (banned ? ' banned' : ''), type: 'button', disabled: g.busy || banned, onclick: () => void openFilm(f) },
              h('span', { class: 'opt-main' }, hinted ? '💡 ' : '', f.title),
              h('span', { class: 'opt-meta' }, banned ? 'banned' : (f.year ?? '')),
            ),
          );
        }),
      );
    fill();
    return h(
      'section',
      { class: 'card panel', 'aria-busy': g.busy ? 'true' : 'false' },
      h('h2', null, 'Pick a film with ', h('span', { class: 'name' }, cur.name)),
      h('p', { class: 'muted' }, plural(films.length, 'film'), bannedHere ? ` · ${bannedHere} banned in hard mode` : ''),
      films.length > 8 && filter,
      list,
    );
  }

  const film = g.film;
  // JT first so a winning cast list is impossible to miss.
  const cast = film.cast.filter((p) => p.id !== cur.id).sort((a, b) => Number(b.id === JT) - Number(a.id === JT));
  if (g.hint && film.id !== hintFilm) {
    const better = cur.films.find((f) => f.id === hintFilm);
    note = h('p', { class: 'note' }, '💡 This film won’t get you closer. Go back and try ', h('em', null, better?.title ?? 'another film'), '.');
  }
  fill = () =>
    list.replaceChildren(
      ...filterByText(cast, g.filter, (p) => p.name).map((p) => {
        const hinted = g.hint && film.id === hintFilm && p.id === hintPerson;
        return h(
          'li',
          null,
          h(
            'button',
            { class: 'option' + (p.id === JT ? ' is-jt' : '') + (hinted ? ' hinted' : ''), type: 'button', disabled: g.busy, onclick: () => void choosePerson(p) },
            h('span', { class: 'opt-main' }, hinted ? '💡 ' : '', p.name),
            h('span', { class: 'opt-meta' }, p.id === JT ? '★ #1' : ''),
          ),
        );
      }),
    );
  fill();
  return h(
    'section',
    { class: 'card panel', 'aria-busy': g.busy ? 'true' : 'false' },
    h('button', { class: 'link-btn', type: 'button', disabled: g.busy, onclick: undo }, '← Other films'),
    h('h2', null, 'Who else is in ', h('span', { class: 'name' }, film.title, yearOf(film)), '?'),
    note,
    cast.length === 0 ? h('p', { class: 'empty' }, 'Nobody else is credited in this film. Try another one.') : h('p', { class: 'muted' }, cast.length === 1 ? '1 other person' : `${cast.length} other people`),
    cast.length > 8 && filter,
    list,
  );
}

async function guarded(work: (g: Game) => Promise<void>): Promise<void> {
  const g = game;
  if (!g || g.busy) return;
  const gen = currentGeneration();
  g.busy = true;
  renderPlay();
  try {
    await work(g);
  } catch (err) {
    if (isCurrent(gen)) renderError(err);
    return;
  } finally {
    g.busy = false;
  }
  if (isCurrent(gen) && game === g) renderPlay(true);
}

export function openFilm(ref: FilmRef): Promise<void> {
  if (game?.banned.has(ref.id)) return Promise.resolve();
  return guarded(async (g) => {
    g.film = await getFilm(ref.id);
    g.filter = '';
  });
}

/** Moves to `ref` through the open film, or through `via` when given (e.g. a typed co-star). */
export function choosePerson(ref: PersonRef, via?: FilmRef): Promise<void> {
  const g = game;
  const through = via ?? g?.film;
  if (!g || !through || g.banned.has(through.id)) return Promise.resolve();
  const film: FilmRef = { id: through.id, title: through.title, year: through.year };
  return guarded(async (g) => {
    const from = current(g);
    const person = await getPerson(ref.id);
    g.moves.push({ film, person, grade: grade(distOf(g, from), distOf(g, person)), hinted: g.hint });
    g.film = null;
    g.filter = '';
    g.hint = false;
    if (person.id === JT) {
      g.busy = false;
      await finish(g, false);
      game = null;
    }
  });
}

export function undo(): void {
  const g = game;
  if (!g || g.busy) return;
  if (g.film) g.film = null;
  else g.moves.pop();
  g.filter = '';
  g.hint = false;
  renderPlay();
}

export function showHint(): void {
  if (!game || game.busy || game.mode === 'hard') return;
  game.hint = true;
  renderPlay();
}

export function giveUp(): Promise<void> {
  return guarded(async (g) => {
    const rest = await optimalPath(current(g), loader, g.mode);
    g.busy = false;
    await finish(g, true, rest);
    game = null;
  });
}
