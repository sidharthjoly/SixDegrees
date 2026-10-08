import { CostarSearch, type CostarHit } from '../costars';
import { StaleDataError, getFilm, getPerson, loadMeta, loader } from '../data';
import { keyCommand, keysWhileMounted } from '../keys';
import { foldList } from '../lists';
import { JT, dayNumber, filterByText, fold, grade, optimalPath, plural, reachIn, type Grade } from '../logic';
import type { Film, FilmRef, Mode, Person, PersonRef, Qid } from '../types';
import { challengeBanner } from './challenge';
import { h, yearOf, type Child } from './dom';
import { Picker, type PickGroup, type PickOption } from './picker';
import { finish } from './result';
import { app, currentGeneration, isCurrent, renderError, renderLoading, renderMessage, topBar } from './shell';
import { tracks } from './tracks';
import { afterKeyboard, isPhone, trackKeyboard } from './viewport';

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

/** Screen state that isn't part of the game itself. */
const view = {
  /** The game and move count last drawn, so only a newly added setlist card animates. */
  game: null as Game | null,
  moves: 0,
  /** The list whose "+N more" was opened ("f:<person>" or "c:<film>"); stays open while that list shows. */
  expanded: '',
  /** Pulse the hinted option once, on the first draw after asking for a hint. */
  pulseHint: false,
  /** Stops the play screen's key listener. */
  stopKeys: () => {},
  /** The co-star search the panel on screen is feeding from. */
  search: null as CostarSearch | null,
};

/** A mouse or trackpad: safe to focus the filter box, since no on-screen keyboard pops up. */
const finePointer = () => matchMedia('(pointer: fine)').matches;
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

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
  trackKeyboard();
  renderPlay();
  window.scrollTo({ top: 0 });
}

function label(g: Game): string {
  return (g.day ? `Daily #${dayNumber(g.day)}` : 'Free play') + (g.mode === 'hard' ? ' · Hard' : '');
}

function renderPlay(scroll = false): void {
  const g = game!;
  const cur = current(g);
  // Every state change redraws the whole screen, so remember where the caret was.
  const old = app.querySelector<HTMLInputElement>('.panel .filter');
  const caret = old && document.activeElement === old ? { value: old.value, start: old.selectionStart, end: old.selectionEnd } : null;
  view.stopKeys();
  view.search?.unwatch();
  view.search = null;
  // Only a move made since the last draw animates; busy redraws and undos don't.
  const fresh = view.game === g && g.moves.length > view.moves && !reducedMotion();
  view.game = g;
  view.moves = g.moves.length;

  const { panel, picker, onKey } = playPanel(g, cur);
  app.replaceChildren(
    topBar(),
    h(
      'section',
      { class: 'status' },
      h('span', { class: 'pill' + (g.mode === 'hard' ? ' hard' : '') }, label(g)),
      h('h1', { class: 'task' }, g.start.name, h('span', { class: 'to' }, ' → '), 'Justin Timberlake'),
      h(
        'dl',
        { class: 'meters' },
        h('div', null, h('dt', null, 'Films'), h('dd', { class: fresh ? 'bump' : null }, g.moves.length)),
        h('div', null, h('dt', null, 'Par'), h('dd', null, par(g))),
      ),
    ),
    challengeBanner(g) ?? '',
    h(
      'div',
      { class: 'play' },
      h('div', { class: 'play-list' }, h('h2', { class: 'section-label' }, 'Your setlist'), tracks(g.start, g.moves, { pending: true, fresh: fresh ? g.moves.length - 1 : undefined })),
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
  view.stopKeys = keysWhileMounted(panel, app, onKey);
  // Desktop players can just start typing. On touch, focusing would pop the keyboard up,
  // so only keep focus there if the player was already typing.
  if (picker.input.isConnected && (finePointer() || caret)) {
    picker.input.focus({ preventScroll: true });
    const end = picker.input.value.length;
    if (caret && caret.value === picker.input.value) picker.input.setSelectionRange(caret.start ?? end, caret.end ?? end);
    else picker.input.setSelectionRange(end, end);
  }
  if (!scroll) return;
  const behavior = reducedMotion() ? 'auto' : 'smooth';
  // On a phone the panel is docked to the bottom (play.css), so bring the newest setlist
  // card down to sit just above it. Elsewhere, bring the panel up if it's fallen low.
  if (isPhone()) afterKeyboard(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior }));
  else if (panel.getBoundingClientRect().top > window.innerHeight * 0.6) panel.scrollIntoView({ behavior, block: 'start' });
}

/**
 * The co-star search counts a failed film and carries on, but a redeploy mid-game means
 * every film will fail: show the reload prompt instead of a quietly shrinking search.
 */
async function loadFilmForSearch(id: Qid): Promise<Film> {
  try {
    return await getFilm(id);
  } catch (err) {
    if (err instanceof StaleDataError) renderError(err);
    throw err;
  }
}

/** Co-star searches by person and mode, kept so returning to someone doesn't refetch. */
const searches = new Map<string, CostarSearch>();
const MAX_SEARCHES = 12;

function costarSearch(g: Game, p: Person): CostarSearch {
  const key = `${p.id}:${g.mode}`;
  let s = searches.get(key);
  if (s) searches.delete(key);
  else s = new CostarSearch(p, g.banned, loadFilmForSearch);
  // Re-insert so the map stays in least-recently-used order.
  searches.set(key, s);
  if (searches.size > MAX_SEARCHES) {
    const [oldest, stale] = searches.entries().next().value!;
    stale.unwatch();
    searches.delete(oldest);
  }
  return s;
}

/** How many co-star matches to draw; the rest are a "keep typing" away. */
const COSTAR_LIMIT = 30;

function progress(s: CostarSearch): string {
  if (!s.done) return `Searching ${s.loaded + s.failed} of ${plural(s.total, 'film')}…`;
  return s.failed ? `Searched ${s.loaded} of ${plural(s.total, 'film')}` : `Searched ${s.total === 1 ? 'the film' : `all ${s.total} films`}`;
}

const cls = (...names: (string | false)[]) => names.filter(Boolean).join(' ');
const isMac = () => /Mac|iPhone|iPad/.test(navigator.userAgent);

function keysLegend(g: Game, id: string): HTMLElement {
  // Each key stays on one line with its label when the legend wraps.
  const entry = (keys: string[], what: string) => h('span', null, ...keys.map((k) => h('kbd', null, k)), ` ${what}`);
  const entries = [entry(['↑', '↓'], 'pick'), entry(['Enter'], 'choose'), entry(['Esc'], g.film ? 'back' : g.moves.length > 0 ? 'undo' : 'clear')];
  if (g.mode === 'normal' && !g.hint) entries.push(entry([isMac() ? '⌥H' : 'Alt+H'], 'hint'));
  return h('p', { class: 'keys-legend', id }, ...entries.flatMap((e, i) => (i ? [' · ', e] : [e])));
}

interface Panel {
  panel: HTMLElement;
  picker: Picker;
  onKey: (e: KeyboardEvent) => void;
}

function playPanel(g: Game, cur: Person): Panel {
  const reach = reachIn(cur, g.mode);
  const hintFilm = g.hint ? reach.parentFilm : 0;
  const hintPerson = g.hint ? reach.parentPerson : 0;
  // The pulse plays on the first fill only; later refills (typing) rebuild the options.
  let pulse = view.pulseHint;
  view.pulseHint = false;
  const legendId = 'play-keys';
  const legend = finePointer() ? keysLegend(g, legendId) : null;
  const picker = new Picker('pick', {
    label: g.film ? 'Filter cast' : 'Search films and co-stars',
    placeholder: g.film ? 'Filter cast' : 'Type a film or a co-star',
    value: g.filter,
    describedBy: legend ? legendId : undefined,
    onInput: (value) => {
      g.filter = value;
      fill();
    },
  });
  const note = h('p', { class: 'pick-note', hidden: true });
  const announce = h('p', { class: 'sr-only', role: 'status' });
  const setNote = (text: string) => {
    note.textContent = text;
    note.hidden = !text;
  };
  // On desktop, keep the keyboard in the box after a click redraws the list under it.
  const refocus = () => {
    if (finePointer() && picker.input.isConnected) picker.input.focus({ preventScroll: true });
  };

  /**
   * Long unfiltered lists fold their obscure tail behind a "+N more" option. Expanding
   * keeps the keyboard where it was by highlighting the first entry that was hidden.
   */
  function folded<T>(items: T[], key: string, fame: (it: T) => number, pinned: (it: T) => boolean, idOf: (it: T) => string, toOption: (it: T) => PickOption, noun: string): PickOption[] {
    if (view.expanded === key) return items.map(toOption);
    const { shown, hidden } = foldList(items, fame, pinned);
    const options = shown.map(toOption);
    if (hidden > 0) {
      const firstHidden = items.find((it) => !shown.includes(it));
      options.push({
        id: 'opt-more',
        className: 'more',
        disabled: g.busy,
        label: `Show ${hidden} more ${noun}`,
        content: [h('span', { class: 'opt-main' }, `+${hidden} more`), h('span', { class: 'opt-meta' }, `show all ${items.length}`)],
        choose: () => {
          view.expanded = key;
          fill();
          if (firstHidden !== undefined) picker.highlight(idOf(firstHidden));
          refocus();
        },
      });
    }
    return options;
  }

  let fill: () => void;
  let body: Child[];

  if (!g.film) {
    const films = cur.films;
    const bannedHere = films.filter((f) => g.banned.has(f.id)).length;
    const filmId = (f: FilmRef) => `opt-f-${f.id}`;
    const filmOption = (f: FilmRef): PickOption => {
      const hinted = f.id === hintFilm;
      const banned = g.banned.has(f.id);
      return {
        id: filmId(f),
        className: cls(hinted && 'hinted', hinted && pulse && 'pulse', banned && 'banned'),
        disabled: g.busy || banned,
        choose: () => void openFilm(f),
        content: [h('span', { class: 'opt-main' }, hinted ? '💡 ' : '', f.title), h('span', { class: 'opt-meta' }, banned ? 'banned' : (f.year ?? ''))],
      };
    };
    const costarOption = (hit: CostarHit): PickOption => {
      const { person: p, via, more } = hit;
      const hinted = p.id === hintPerson;
      return {
        id: `opt-c-${p.id}`,
        className: cls(p.id === JT && 'is-jt', hinted && 'hinted'),
        disabled: g.busy,
        choose: () => void choosePerson(p, via),
        content: [
          h('span', { class: 'opt-main' }, hinted ? '💡 ' : '', p.name, h('span', { class: 'opt-sub' }, 'via ', via.title, yearOf(via), more > 0 ? ` · +${plural(more, 'more film')}` : '')),
          h('span', { class: 'opt-meta' }, p.id === JT ? '★ #1' : ''),
        ],
      };
    };

    let frame = 0;
    let wasDone = false;
    let watched: CostarSearch | null = null;
    // Films land a few at a time; redraw at most once a frame, and stop fetching once this
    // panel has gone (the cache keeps what loaded). A newer panel watching the same search
    // replaces this listener, so it only runs while it's the search's current watcher.
    const onProgress = () => {
      if (!picker.input.isConnected) {
        watched?.unwatch();
        return;
      }
      frame ||= requestAnimationFrame(() => {
        frame = 0;
        if (picker.input.isConnected) fill();
      });
    };

    fill = () => {
      const q = g.filter.trim();
      const filmOptions = q
        ? filterByText(films, q, (f) => f.title).map(filmOption)
        : folded(films, `f:${cur.id}`, (f) => f.fame ?? 0, (f) => f.id === hintFilm, filmId, filmOption, 'films');
      pulse = false;
      // Two letters before searching casts: one letter matches nearly everybody.
      const search = fold(q).length >= 2 ? costarSearch(g, cur) : null;
      if (!search || search.total === 0) {
        view.search?.unwatch();
        picker.setGroups([{ options: filmOptions }]);
        setNote(q && filmOptions.length === 0 ? `No films match “${q}”.` : '');
        return;
      }
      if (view.search !== search || !search.watching) {
        view.search?.unwatch();
        view.search = watched = search;
        wasDone = search.done;
        search.watch(onProgress);
      }
      const { hits, total } = search.index.search(q, COSTAR_LIMIT);
      const groups: PickGroup[] = [];
      if (filmOptions.length > 0) groups.push({ label: 'Films', options: filmOptions });
      groups.push({ label: 'Co-stars', aside: progress(search), options: hits.map(costarOption) });
      picker.setGroups(groups);
      if (total > hits.length) setNote(`Showing the top ${hits.length} of ${total} co-stars. Keep typing to narrow it down.`);
      else if (search.done && total === 0 && filmOptions.length === 0) setNote(`No films or co-stars match “${q}”.`);
      else setNote('');
      if (search.done && !wasDone) {
        wasDone = true;
        announce.textContent = `Co-star search finished: ${total} ${total === 1 ? 'match' : 'matches'}.`;
      }
    };
    body = [
      h('h2', null, 'Pick a film with ', h('span', { class: 'name' }, cur.name)),
      h('p', { class: 'muted' }, plural(films.length, 'film'), bannedHere ? ` · ${bannedHere} banned in hard mode` : '', ' · or type a co-star’s name'),
      picker.input,
      legend,
      picker.list,
    ];
  } else {
    const film = g.film;
    // JT first so a winning cast list is impossible to miss.
    const cast = film.cast.filter((p) => p.id !== cur.id).sort((a, b) => Number(b.id === JT) - Number(a.id === JT));
    const hintHere = film.id === hintFilm;
    const personId = (p: PersonRef) => `opt-p-${p.id}`;
    const castOption = (p: PersonRef): PickOption => {
      const hinted = hintHere && p.id === hintPerson;
      return {
        id: personId(p),
        className: cls(p.id === JT && 'is-jt', hinted && 'hinted', hinted && pulse && 'pulse'),
        disabled: g.busy,
        choose: () => void choosePerson(p),
        content: [h('span', { class: 'opt-main' }, hinted ? '💡 ' : '', p.name), h('span', { class: 'opt-meta' }, p.id === JT ? '★ #1' : '')],
      };
    };
    fill = () => {
      const q = g.filter.trim();
      const options = q
        ? filterByText(cast, q, (p) => p.name).map(castOption)
        : folded(cast, `c:${film.id}`, (p) => p.fame ?? 0, (p) => p.id === JT || (hintHere && p.id === hintPerson), personId, castOption, 'people');
      pulse = false;
      picker.setGroups([{ options }]);
      setNote(q && options.length === 0 ? `Nobody in the cast matches “${q}”.` : '');
    };
    let hintNote: Child = null;
    if (g.hint && !hintHere) {
      const better = cur.films.find((f) => f.id === hintFilm);
      hintNote = h('p', { class: 'note' }, '💡 This film won’t get you closer. Go back and try ', h('em', null, better?.title ?? 'another film'), '.');
    }
    body = [
      h('button', { class: 'link-btn', type: 'button', disabled: g.busy, onclick: undo }, '← Other films'),
      h('h2', null, 'Who else is in ', h('span', { class: 'name' }, film.title, yearOf(film)), '?'),
      hintNote,
      cast.length === 0 ? h('p', { class: 'empty' }, 'Nobody else is credited in this film. Try another one.') : h('p', { class: 'muted' }, cast.length === 1 ? '1 other person' : `${cast.length} other people`),
      cast.length > 0 && picker.input,
      cast.length > 0 && legend,
      cast.length > 0 && picker.list,
    ];
  }
  fill();

  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented) return;
    const t = e.target;
    const inFilter = t === picker.input;
    const inOtherField = !inFilter && t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    const cmd = keyCommand(e, { inFilter, inOtherField, filterHasText: picker.value !== '' });
    if (!cmd) return;
    if (cmd === 'type') {
      // Focus moves before the key lands, so the character goes into the box.
      if (picker.input.isConnected) {
        picker.input.focus({ preventScroll: true });
        const end = picker.input.value.length;
        picker.input.setSelectionRange(end, end);
      }
      return;
    }
    if (cmd === 'back' && !g.film && g.moves.length === 0) return;
    e.preventDefault();
    if (g.busy) return;
    switch (cmd) {
      case 'up':
      case 'down':
        picker.move(cmd === 'up' ? -1 : 1);
        return;
      case 'pick':
        picker.choose();
        return;
      case 'clear':
        picker.value = '';
        g.filter = '';
        fill();
        return;
      case 'back':
        undo();
        return;
      case 'hint':
        showHint();
        return;
    }
  };

  const panel = h('section', { class: 'card panel', 'aria-busy': g.busy ? 'true' : 'false' }, ...body, note, announce);
  return { panel, picker, onKey };
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
  if (!game || game.busy || game.mode === 'hard' || game.hint) return;
  game.hint = true;
  view.pulseHint = !reducedMotion();
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
