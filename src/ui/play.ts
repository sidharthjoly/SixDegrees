import { CostarSearch, type CostarHit } from '../costars';
import { StaleDataError, getFilm, getPerson, loadBollywood, loadMeta, loader } from '../data';
import { keyCommand, keysWhileMounted } from '../keys';
import { foldList } from '../lists';
import { JT, dayNumber, filterByText, fold, goalFor, grade, hardRules, optimalPath, plural, reachIn, reachTo, starDaily, type Goal, type Grade } from '../logic';
import { OnlineError, dailyHint, online } from '../online';
import type { Film, FilmRef, Mode, Person, PersonRef, Qid, Reach } from '../types';
import { challengeBanner } from './challenge';
import { feel } from './haptics';
import { h, yearOf, type Child } from './dom';
import { Picker, type PickGroup, type PickOption } from './picker';
import { finish } from './result';
import { app, currentGeneration, isCurrent, renderError, renderLoading, renderMessage, showWorld, topBar } from './shell';
import { tracks } from './tracks';
import { afterKeyboard, isPhone, trackKeyboard } from './viewport';

export interface Move {
  film: FilmRef;
  person: Person;
  /** How far the person is from the game's goal. */
  reach: Reach;
  grade: Grade;
  hinted: boolean;
}

export interface Game {
  /** The daily's date, or null for free play. */
  day: string | null;
  mode: Mode;
  /** Who the game heads for: JT, or in free play one of the other stars. */
  goal: Goal;
  /** Films that can't be used this game (hard mode's bans). */
  banned: Set<Qid>;
  /** A friend's result to beat, as the raw ?vs= code (decoded by the challenge feature). */
  vs: string | null;
  start: Person;
  /** How far the start is from the goal. */
  reach: Reach;
  moves: Move[];
  /** Film whose cast list is open, or null when choosing a film. */
  film: Film | null;
  filter: string;
  /** The step shown as a hint for the move in progress: the next of a shortest route. Always null in hard mode. */
  hint: { film: Qid; person: Qid } | null;
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
  /** Why the last hint asked for couldn't be had, until the next move. */
  hintTrouble: '',
  /** Stops the play screen's key listener. */
  stopKeys: () => {},
  /** The co-star search the panel on screen is feeding from. */
  search: null as CostarSearch | null,
};

/** A mouse or trackpad: safe to focus the filter box, since no on-screen keyboard pops up. */
const finePointer = () => matchMedia('(pointer: fine)').matches;
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export const current = (g: Game): Person => g.moves.at(-1)?.person ?? g.start;
/** How far the current person is from the goal. */
const reachHere = (g: Game): Reach => g.moves.at(-1)?.reach ?? g.reach;
export const par = (g: Game) => g.reach.dist;

export interface StartOptions {
  qid: Qid;
  day: string | null;
  mode: Mode;
  vs: string | null;
  /** One of the other stars, for free play or the star and Bollywood dailies; left out for JT. */
  target?: Qid;
}

export async function startGame(opts: StartOptions, gen: number): Promise<void> {
  renderLoading();
  game = null;
  const [start, meta] = await Promise.all([getPerson(opts.qid), loadMeta()]);
  if (!isCurrent(gen)) return;
  // A JT daily never names a star: only free play and the star and Bollywood dailies do.
  const goal = goalFor(meta, opts.day && !starDaily(opts.mode) ? undefined : opts.target, opts.mode);
  if (!goal) {
    renderMessage('Not one of the stars', 'Free play heads for Justin Timberlake or one of the stars listed on the home page, and that link names someone else.');
    return;
  }
  showWorld(meta.targets.find((t) => t.id === goal.id)?.world === 'bollywood' ? 'bollywood' : 'hollywood');
  if (start.id === goal.id) {
    if (goal.id === JT) renderMessage('That’s Justin himself', 'He is zero films away from himself. Pick someone else.');
    else renderMessage(`That’s ${goal.name}`, `${goal.name} is where this game ends. Pick someone else to start from.`);
    return;
  }
  const [reach, banned] = await Promise.all([
    reachTo(start, goal, loader),
    opts.mode === 'hard' ? meta.hardBanned : opts.mode === 'bollywood-hard' ? loadBollywood().then((b) => b.hardBanned) : [],
  ]);
  if (!isCurrent(gen)) return;
  if (hardRules(opts.mode) && reach.dist === Infinity) {
    renderMessage('Not possible in hard mode', `${start.name} only links to ${goal.id === JT ? 'Justin' : goal.name} through films hard mode bans. Try normal mode.`);
    return;
  }
  game = {
    day: opts.day,
    mode: opts.mode,
    goal,
    banned: new Set(banned.map((f) => f.id)),
    vs: opts.vs,
    start,
    reach,
    moves: [],
    film: null,
    filter: '',
    hint: null,
    busy: false,
  };
  document.title = `${start.name} → ${goal.name} · Six Degrees`;
  trackKeyboard();
  renderPlay();
  window.scrollTo({ top: 0 });
}

const MODE_TAG: Record<Mode, string> = { normal: '', hard: ' · Hard', star: ' · Star', bollywood: ' · Bollywood', 'bollywood-hard': ' · Bollywood hard' };

export function label(g: Pick<Game, 'day' | 'mode'>): string {
  return (g.day ? `Daily #${dayNumber(g.day)}` : 'Free play') + MODE_TAG[g.mode];
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
      h('span', { class: 'pill' + (g.mode === 'normal' ? '' : ` ${g.mode}`) }, label(g)),
      h('h1', { class: 'task' }, g.start.name, h('span', { class: 'to' }, ' → '), g.goal.name),
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
      h('div', { class: 'play-list' }, h('h2', { class: 'section-label' }, 'Your setlist'), tracks(g.start, g.moves, { pending: true, fresh: fresh ? g.moves.length - 1 : undefined, goal: g.goal.name })),
      h(
        'div',
        { class: 'play-main' },
        panel,
        h(
          'div',
          { class: 'actions' },
          h('button', { class: 'btn', type: 'button', disabled: g.busy || (g.moves.length === 0 && !g.film), onclick: undo }, '↶ Undo'),
          !hardRules(g.mode) && h('button', { class: 'btn', type: 'button', disabled: g.busy || g.hint !== null, onclick: showHint }, '💡 Hint'),
          h('button', { class: 'btn', type: 'button', disabled: g.busy, onclick: () => void giveUp() }, 'Show me the way'),
        ),
        view.hintTrouble ? h('p', { class: 'note', role: 'status' }, view.hintTrouble) : null,
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
  if (!hardRules(g.mode) && !g.hint) entries.push(entry([isMac() ? '⌥H' : 'Alt+H'], 'hint'));
  return h('p', { class: 'keys-legend', id }, ...entries.flatMap((e, i) => (i ? [' · ', e] : [e])));
}

interface Panel {
  panel: HTMLElement;
  picker: Picker;
  onKey: (e: KeyboardEvent) => void;
}

function playPanel(g: Game, cur: Person): Panel {
  const isGoal = (p: PersonRef) => p.id === g.goal.id;
  const hintFilm = g.hint?.film ?? 0;
  const hintPerson = g.hint?.person ?? 0;
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
        className: cls(isGoal(p) && 'is-jt', hinted && 'hinted'),
        disabled: g.busy,
        choose: () => void choosePerson(p, via),
        content: [
          h('span', { class: 'opt-main' }, hinted ? '💡 ' : '', p.name, h('span', { class: 'opt-sub' }, 'via ', via.title, yearOf(via), more > 0 ? ` · +${plural(more, 'more film')}` : '')),
          h('span', { class: 'opt-meta' }, isGoal(p) ? '★ #1' : ''),
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
      const { hits, total } = search.index.search(q, COSTAR_LIMIT, g.goal.id);
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
    // The goal first so a winning cast list is impossible to miss.
    const cast = film.cast.filter((p) => p.id !== cur.id).sort((a, b) => Number(isGoal(b)) - Number(isGoal(a)));
    const hintHere = film.id === hintFilm;
    const personId = (p: PersonRef) => `opt-p-${p.id}`;
    const castOption = (p: PersonRef): PickOption => {
      const hinted = hintHere && p.id === hintPerson;
      return {
        id: personId(p),
        className: cls(isGoal(p) && 'is-jt', hinted && 'hinted', hinted && pulse && 'pulse'),
        disabled: g.busy,
        choose: () => void choosePerson(p),
        content: [h('span', { class: 'opt-main' }, hinted ? '💡 ' : '', p.name), h('span', { class: 'opt-meta' }, isGoal(p) ? '★ #1' : '')],
      };
    };
    fill = () => {
      const q = g.filter.trim();
      const options = q
        ? filterByText(cast, q, (p) => p.name).map(castOption)
        : folded(cast, `c:${film.id}`, (p) => p.fame ?? 0, (p) => isGoal(p) || (hintHere && p.id === hintPerson), personId, castOption, 'people');
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
  // Still inside the tap here, which the iPhone tick needs (haptics.ts).
  if (!g.busy) feel('pick');
  return guarded(async (g) => {
    const from = reachHere(g);
    // Another star's distances are in their own files: fetch that alongside the person.
    const [person, toward] = await Promise.all([getPerson(ref.id), g.goal.id === JT ? null : loader.reach(g.goal.id, ref.id, hardRules(g.mode))]);
    const reach = toward ?? reachIn(person, g.mode);
    const graded = grade(from.dist, reach.dist);
    g.moves.push({ film, person, reach, grade: graded, hinted: g.hint !== null });
    g.film = null;
    g.filter = '';
    g.hint = null;
    view.hintTrouble = '';
    const won = person.id === g.goal.id;
    feel(won ? 'win' : graded);
    if (won) {
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
  g.hint = null;
  view.hintTrouble = '';
  renderPlay();
}

/**
 * Shows the next step of a shortest route. A daily's comes from the server, which records the
 * asking so the result counts it however the game reports it (src/gate.ts); free play, and
 * copies of the game without a server, work it out here.
 */
export function showHint(): void {
  const g = game;
  if (!g || g.busy || hardRules(g.mode) || g.hint) return;
  const here = current(g);
  const show = (step: { film: Qid; person: Qid }) => {
    g.hint = step;
    view.pulseHint = !reducedMotion();
  };
  view.hintTrouble = '';
  if (!g.day || !online) {
    const { parentFilm, parentPerson } = reachHere(g);
    show({ film: parentFilm, person: parentPerson });
    return renderPlay();
  }
  const gen = currentGeneration();
  g.busy = true;
  renderPlay();
  dailyHint(g.day, g.mode, here.id)
    .then(
      (step) => {
        if (current(g) === here) show(step);
      },
      (err: unknown) => {
        view.hintTrouble = err instanceof OnlineError && err.code !== null ? err.message : 'Hints need a connection. Try again in a moment.';
      },
    )
    .finally(() => {
      g.busy = false;
      if (isCurrent(gen) && game === g) renderPlay();
    });
}

export function giveUp(): Promise<void> {
  return guarded(async (g) => {
    const rest = await optimalPath(current(g), loader, g.goal);
    g.busy = false;
    await finish(g, true, rest);
    game = null;
  });
}
