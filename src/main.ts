import '@fontsource/rubik-mono-one/400.css';
import '@fontsource/chakra-petch/500.css';
import '@fontsource/chakra-petch/600.css';
import '@fontsource/chakra-petch/700.css';
import './style.css';
import { getFilm, getPerson, loadMeta, loadSearch, loader } from './data';
import {
  JT,
  dailyPick,
  dayKey,
  dayNumber,
  emojiRow,
  filterByText,
  grade,
  makeSearch,
  optimalPath,
  plural,
  shareText,
  type Grade,
  type MoveSummary,
} from './logic';
import type { Film, FilmRef, Meta, Person, PersonRef, Qid, SearchRow } from './types';

const app = document.querySelector<HTMLElement>('#app')!;
/** Outside <main> so the home page's ticker runs the full window width. */
const tickerSlot = document.querySelector<HTMLElement>('#ticker')!;

// ---------------------------------------------------------------- DOM helper

type Child = Node | string | number | null | undefined | false;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c !== null && c !== undefined && c !== false) el.append(typeof c === 'number' ? String(c) : c);
  }
  return el;
}

const yearOf = (f: FilmRef) => (f.year ? ` (${f.year})` : '');
const shareBase = () => `${location.origin}${location.pathname}`;

// ---------------------------------------------------------------- storage

interface DailyResult {
  /** Who was played, so a data rebuild that changes the pick can't pair a new name with an old score. */
  start: Qid;
  moves: MoveSummary[];
  par: number;
  gaveUp: boolean;
}

const dailyKey = (day: string) => `sixdeg:daily:${day}`;

function loadDaily(day: string): DailyResult | null {
  try {
    const s = localStorage.getItem(dailyKey(day));
    return s ? (JSON.parse(s) as DailyResult) : null;
  } catch {
    return null;
  }
}

function saveDaily(day: string, result: DailyResult): void {
  try {
    localStorage.setItem(dailyKey(day), JSON.stringify(result));
  } catch {
    // Private mode or storage blocked: the result just isn't remembered.
  }
}

// ---------------------------------------------------------------- game state

interface Move {
  film: FilmRef;
  person: Person;
  grade: Grade;
  hinted: boolean;
}

interface Game {
  /** Set for the daily challenge. */
  day: string | null;
  start: Person;
  moves: Move[];
  /** Film whose cast list is open, or null when choosing a film. */
  film: Film | null;
  filter: string;
  /** Hint shown for the move in progress. */
  hint: boolean;
  busy: boolean;
}

let game: Game | null = null;
/** Bumped on every navigation so late fetches don't render over a newer view. */
let generation = 0;

const current = (g: Game): Person => g.moves.at(-1)?.person ?? g.start;
const summary = (moves: Move[]): MoveSummary[] => moves.map((m) => ({ grade: m.grade, hinted: m.hinted }));

// ---------------------------------------------------------------- routing

async function route(): Promise<void> {
  const gen = ++generation;
  tickerSlot.replaceChildren();
  const m = /^#\/p\/(\d+)$/.exec(location.hash);
  try {
    if (location.hash === '#/daily') {
      const meta = await loadMeta();
      const day = dayKey(new Date());
      await startGame(dailyPick(meta.daily, day), day, gen);
    } else if (m) {
      await startGame(Number(m[1]), null, gen);
    } else {
      await renderHome(gen);
    }
  } catch (err) {
    if (gen === generation) renderError(err);
  }
}

window.addEventListener('hashchange', () => void route());
void route();

function go(hash: string): void {
  if (location.hash === hash) void route();
  else location.hash = hash;
}

async function randomStart(): Promise<void> {
  const { daily } = await loadMeta();
  go(`#/p/${daily[Math.floor(Math.random() * daily.length)]}`);
}

// ---------------------------------------------------------------- shared views

function topBar(): HTMLElement {
  return h('header', { class: 'bar' }, h('a', { href: '#', class: 'home-link' }, 'Six Degrees of JT'));
}

function renderLoading(text = 'Loading…'): void {
  app.replaceChildren(topBar(), h('p', { class: 'loading', role: 'status' }, text));
}

function renderError(err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  app.replaceChildren(
    topBar(),
    h(
      'section',
      { class: 'card error', role: 'alert' },
      h('h2', null, 'Something went wrong'),
      h('p', null, msg),
      import.meta.env.DEV && h('p', { class: 'muted' }, 'If the data files are missing, run ', h('code', null, 'npm run data'), '.'),
      h('a', { href: '#', class: 'btn' }, 'Back home'),
    ),
  );
}

/** Median Timberlake number, from the build's distance histogram. */
function medianDistance(meta: Meta): number {
  const rows = Object.entries(meta.histogram)
    .map(([d, n]) => [Number(d), n] as const)
    .filter(([d]) => d > 0);
  const total = rows.reduce((sum, [, n]) => sum + n, 0);
  let acc = 0;
  return rows.find(([, n]) => (acc += n) >= total / 2)?.[0] ?? 0;
}

function ticker(meta: Meta): HTMLElement {
  const text = [
    `${meta.people.toLocaleString()} people`,
    `${meta.films.toLocaleString()} films`,
    `most are ${plural(medianDistance(meta), 'film')} from JT`,
    'a new daily every midnight',
    'hints show up in your share',
  ]
    .map((t) => `★ ${t.toUpperCase()}`)
    .join(' ');
  // Two identical copies scroll by half their width, so the loop is seamless.
  return h(
    'div',
    { class: 'ticker' },
    h('div', { class: 'ticker-track' }, h('span', null, text), h('span', { 'aria-hidden': 'true' }, text)),
  );
}

interface ChainStep {
  film: FilmRef;
  person: PersonRef;
  grade?: Grade;
  hinted?: boolean;
  revealed?: boolean;
}

// Chart-movement symbols, so a grade never relies on colour alone.
const GRADE_LABEL: Record<Grade, string> = { closer: '▲ closer', same: '● no closer', further: '▼ further' };

/**
 * A path as a stack of chart entries. In play they're numbered in order (01, 02…) with a
 * dashed slot for the next film; on the result they count down to #1, the film with JT.
 */
function tracks(start: PersonRef, steps: ChainStep[], opts: { pending?: boolean; countdown?: boolean } = {}): HTMLElement {
  const items: HTMLElement[] = [
    h(
      'li',
      { class: 'track start' + (opts.pending && steps.length === 0 ? ' current' : '') },
      h('span', { class: 'track-num' }, 'START'),
      h('div', { class: 'track-body' }, h('span', { class: 'track-title' }, start.name)),
    ),
  ];
  steps.forEach((s, i) => {
    const last = i === steps.length - 1;
    items.push(
      h(
        'li',
        {
          class:
            'track' +
            (s.revealed ? ' revealed' : '') +
            (opts.countdown && last ? ' number-one' : '') +
            (opts.pending && last ? ' current' : ''),
        },
        h('span', { class: 'track-num' }, opts.countdown ? `#${steps.length - i}` : String(i + 1).padStart(2, '0')),
        h(
          'div',
          { class: 'track-body' },
          h('span', { class: 'track-title' }, s.film.title, h('span', { class: 'year' }, yearOf(s.film))),
          h('span', { class: 'track-sub' }, 'feat. ', h('b', null, s.person.name)),
          s.grade && h('span', { class: `grade ${s.grade}` }, s.hinted ? '💡 ' : '', GRADE_LABEL[s.grade]),
          s.revealed && h('span', { class: 'grade answer' }, 'answer'),
        ),
      ),
    );
  });
  if (opts.pending) {
    items.push(
      h(
        'li',
        { class: 'track pending' },
        h('span', { class: 'track-num' }, '?'),
        h('div', { class: 'track-body' }, h('span', { class: 'track-title' }, 'Your next film'), h('span', { class: 'track-sub' }, '…until one features ', h('b', null, 'Justin Timberlake'))),
      ),
    );
  }
  return h('ol', { class: 'countdown' }, ...items);
}

// ---------------------------------------------------------------- home

async function renderHome(gen: number): Promise<void> {
  game = null;
  renderLoading();
  const meta = await loadMeta();
  const day = dayKey(new Date());
  const daily = await getPerson(dailyPick(meta.daily, day));
  if (gen !== generation) return;
  document.title = 'Six Degrees of Justin Timberlake';
  const played = loadDaily(day);
  tickerSlot.replaceChildren(ticker(meta));
  app.replaceChildren(
    h(
      'div',
      { class: 'home' },
      h(
        'div',
        { class: 'home-main' },
        h('h1', { class: 'title' }, 'Six Degrees of Justin Timberlake'),
        h(
          'p',
          { class: 'lede' },
          `${meta.people.toLocaleString()} actors, athletes and filmmakers, all linked to JT through ${meta.films.toLocaleString()} films. `,
          'Pick a film, pick a co-star, and keep going until you land on Justin.',
        ),
        dailyCard(day, daily, played?.start === daily.id ? played : null),
        startCard(),
      ),
      h('div', { class: 'home-side' }, h('h2', { class: 'section-label' }, 'How to play · Top 3'), howTo(), histogram(meta)),
    ),
    h(
      'footer',
      { class: 'footer' },
      h('p', null, 'Film and cast data from ', h('a', { href: 'https://www.wikidata.org/', rel: 'noopener' }, 'Wikidata'), ` (CC0), built ${meta.built}. Paths and par come from a breadth-first search over every credit.`),
      h('p', null, 'A fan project. Not affiliated with Justin Timberlake.'),
    ),
  );
}

function dailyCard(day: string, person: Person, played: DailyResult | null): HTMLElement {
  const n = dayNumber(day);
  const knownFor = person.films[0];
  // Names run from "Pelé" to "Edward Grey, 1st Viscount Grey of Fallodon"; the starburst's
  // points clip anything near its edge, so long names step down a size.
  const size = person.name.length > 26 ? ' longer' : person.name.length > 15 ? ' long' : '';
  const side: Child[] = [knownFor && h('p', { class: 'known' }, 'Known for ', h('em', null, knownFor.title), yearOf(knownFor))];
  if (played) {
    const text = shareText({ daily: n, start: person.name, moves: played.moves, par: played.par, gaveUp: played.gaveUp, url: `${shareBase()}#/daily` });
    side.push(
      h('p', { class: 'played' }, played.gaveUp ? 'You gave up today. ' : `You did it in ${plural(played.moves.length, 'film')}. `, h('span', { class: 'emoji' }, emojiRow(played.moves))),
      h('div', { class: 'row' }, shareButton(text), h('a', { href: '#/daily', class: 'btn' }, 'Play again')),
    );
  } else {
    side.push(h('a', { href: '#/daily', class: 'btn primary' }, 'Play the daily'));
  }
  return h(
    'section',
    { class: 'daily', 'aria-label': `Daily challenge number ${n}` },
    h(
      'div',
      { class: 'sticker' },
      h('span', { class: 'sticker-tag' }, `Daily #${n}`),
      h('span', { class: 'sticker-name' + size }, person.name),
      h('span', { class: 'sticker-tag' }, `Par ${person.dist}`),
    ),
    h('div', { class: 'daily-side' }, ...side),
  );
}

function howTo(): HTMLElement {
  const step = (num: string, title: string, sub: Child, extra = '') =>
    h(
      'li',
      { class: 'track' + extra },
      h('span', { class: 'track-num' }, num),
      h('div', { class: 'track-body' }, h('span', { class: 'track-title' }, title), h('span', { class: 'track-sub' }, sub)),
    );
  return h(
    'ol',
    { class: 'countdown howto' },
    step('#3', 'Pick a film', 'Any film your star was credited in.'),
    step('#2', 'Pick a co-star', 'Anyone else in that film’s cast.'),
    step('#1', 'Land on Justin', 'Each move charts ▲ closer, ● no closer or ▼ further. Match par to hit #1.', ' number-one'),
  );
}

const QUICK_PICKS: [Qid, string][] = [
  [11571, 'Cristiano Ronaldo'],
  [615, 'Lionel Messi'],
  [3454165, 'Kevin Bacon'],
  [37876, 'Natalie Portman'],
  [9535, 'Shah Rukh Khan'],
];

function startCard(): HTMLElement {
  const results = h('ul', { class: 'results', id: 'search-results' });
  let search: ((q: string, limit?: number) => SearchRow[]) | null = null;
  let top: SearchRow | undefined;

  const show = (q: string) => {
    if (!search) return;
    const rows = search(q);
    top = rows[0];
    results.replaceChildren(
      ...rows.map((r) =>
        h(
          'li',
          null,
          h(
            'button',
            { class: 'option', type: 'button', onclick: () => go(`#/p/${r[0]}`) },
            h('span', { class: 'opt-main' }, r[1], h('span', { class: 'opt-sub' }, r[4])),
            h('span', { class: 'opt-meta' }, r[0] === JT ? '★' : `par ${r[3]}`),
          ),
        ),
      ),
    );
    if (q.trim() && rows.length === 0) results.append(h('li', { class: 'empty' }, 'No one by that name. Only people with a Wikipedia article in several languages are listed here.'));
  };

  const input = h('input', {
    type: 'search',
    id: 'start-search',
    placeholder: 'Any name, e.g. Meryl Streep',
    autocomplete: 'off',
    spellcheck: 'false',
    'aria-controls': 'search-results',
    oninput: () => show(input.value),
    onfocus: () => {
      if (search) return;
      results.replaceChildren(h('li', { class: 'empty' }, 'Loading names…'));
      loadSearch()
        .then((index) => {
          search = makeSearch(index);
          show(input.value);
        })
        .catch((err: unknown) => results.replaceChildren(h('li', { class: 'empty' }, String(err))));
    },
    onkeydown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' && top) go(`#/p/${top[0]}`);
    },
  });

  return h(
    'section',
    { class: 'card' },
    h('label', { class: 'label', for: 'start-search' }, 'Call the request line'),
    input,
    results,
    h(
      'div',
      { class: 'chips' },
      ...QUICK_PICKS.map(([id, name]) => h('a', { class: 'chip', href: `#/p/${id}` }, name)),
      h('button', { class: 'chip shuffle', type: 'button', onclick: () => void randomStart() }, 'Shuffle'),
    ),
  );
}

function histogram(meta: Meta): HTMLElement {
  const rows = Object.entries(meta.histogram)
    .map(([d, n]) => [Number(d), n] as const)
    .filter(([d]) => d > 0);
  const total = rows.reduce((s, [, n]) => s + n, 0);
  const max = Math.max(...rows.map(([, n]) => n));
  const median = medianDistance(meta);
  const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
  const tip = h('div', { class: 'tip', role: 'status' });

  const cols = rows.map(([d, n]) => {
    const label = `${plural(d, 'film')} from JT: ${n.toLocaleString()} people (${((100 * n) / total).toFixed(n / total < 0.001 ? 2 : 1)}%)`;
    const showTip = () => (tip.textContent = label);
    return h(
      'div',
      { class: 'col', tabindex: '0', 'aria-label': label, onmouseenter: showTip, onfocus: showTip, onmouseleave: () => (tip.textContent = ''), onblur: () => (tip.textContent = '') },
      h('span', { class: 'cap' }, compact.format(n)),
      h('span', { class: 'bar-fill', style: `height:${Math.max((100 * n) / max, 0.8)}%` }),
      h('span', { class: 'tick' }, d),
    );
  });

  return h(
    'section',
    { class: 'card chart' },
    h('h2', null, 'The charts: how far is everyone?'),
    h('p', { class: 'muted' }, `Most people are ${plural(median, 'film')} away. The farthest are ${plural(rows.at(-1)![0], 'film')} out.`),
    h('div', { class: 'plot', style: `grid-template-columns:repeat(${rows.length},1fr)`, role: 'img', 'aria-label': 'Column chart of people by number of films from Justin Timberlake' }, ...cols),
    h('p', { class: 'axis-label' }, 'Films from Justin Timberlake'),
    tip,
    h(
      'table',
      { class: 'sr-only' },
      h('caption', null, 'People by number of films from Justin Timberlake'),
      h('thead', null, h('tr', null, h('th', null, 'Films'), h('th', null, 'People'))),
      h('tbody', null, ...rows.map(([d, n]) => h('tr', null, h('td', null, d), h('td', null, n.toLocaleString())))),
    ),
  );
}

// ---------------------------------------------------------------- play

async function startGame(id: Qid, day: string | null, gen: number): Promise<void> {
  renderLoading();
  const start = await getPerson(id);
  if (gen !== generation) return;
  if (start.id === JT) {
    app.replaceChildren(
      topBar(),
      h('section', { class: 'card' }, h('h2', null, 'That’s Justin himself'), h('p', null, 'He is zero films away from himself. Pick someone else.'), h('a', { href: '#', class: 'btn' }, 'Back home')),
    );
    return;
  }
  game = { day, start, moves: [], film: null, filter: '', hint: false, busy: false };
  document.title = `${start.name} → Justin Timberlake · Six Degrees`;
  renderPlay();
  window.scrollTo({ top: 0 });
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
      h('span', { class: 'pill' }, g.day ? `Daily #${dayNumber(g.day)}` : 'Free play'),
      h('h1', { class: 'task' }, g.start.name, h('span', { class: 'to' }, ' → '), 'Justin Timberlake'),
      h('dl', { class: 'meters' }, h('div', null, h('dt', null, 'Films'), h('dd', null, g.moves.length)), h('div', null, h('dt', null, 'Par'), h('dd', null, g.start.dist))),
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
          h('button', { class: 'btn', type: 'button', disabled: g.busy || g.hint, onclick: showHint }, '💡 Hint'),
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
  let note: Child = null;
  let fill: () => void;

  if (!g.film) {
    const films = cur.films;
    fill = () =>
      list.replaceChildren(
        ...filterByText(films, g.filter, (f) => f.title).map((f) => {
          const hinted = g.hint && f.id === cur.parentFilm;
          return h(
            'li',
            null,
            h(
              'button',
              { class: 'option' + (hinted ? ' hinted' : ''), type: 'button', disabled: g.busy, onclick: () => void openFilm(f) },
              h('span', { class: 'opt-main' }, hinted ? '💡 ' : '', f.title),
              h('span', { class: 'opt-meta' }, f.year ?? ''),
            ),
          );
        }),
      );
    fill();
    return h(
      'section',
      { class: 'card panel', 'aria-busy': g.busy ? 'true' : 'false' },
      h('h2', null, 'Pick a film with ', h('span', { class: 'name' }, cur.name)),
      h('p', { class: 'muted' }, plural(films.length, 'film')),
      films.length > 8 && filter,
      list,
    );
  }

  const film = g.film;
  // JT first so a winning cast list is impossible to miss.
  const cast = film.cast.filter((p) => p.id !== cur.id).sort((a, b) => Number(b.id === JT) - Number(a.id === JT));
  if (g.hint && film.id !== cur.parentFilm) {
    const better = cur.films.find((f) => f.id === cur.parentFilm);
    note = h('p', { class: 'note' }, '💡 This film won’t get you closer. Go back and try ', h('em', null, better?.title ?? 'another film'), '.');
  }
  fill = () =>
    list.replaceChildren(
      ...filterByText(cast, g.filter, (p) => p.name).map((p) => {
        const hinted = g.hint && film.id === cur.parentFilm && p.id === cur.parentPerson;
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
  const gen = generation;
  g.busy = true;
  renderPlay();
  try {
    await work(g);
  } catch (err) {
    if (gen === generation) renderError(err);
    return;
  } finally {
    g.busy = false;
  }
  if (gen === generation && game === g) renderPlay(true);
}

function openFilm(ref: FilmRef): Promise<void> {
  return guarded(async (g) => {
    g.film = await getFilm(ref.id);
    g.filter = '';
  });
}

function choosePerson(ref: PersonRef): Promise<void> {
  const g = game;
  if (!g?.film) return Promise.resolve();
  const film: FilmRef = { id: g.film.id, title: g.film.title, year: g.film.year };
  return guarded(async (g) => {
    const from = current(g);
    const person = await getPerson(ref.id);
    g.moves.push({ film, person, grade: grade(from.dist, person.dist), hinted: g.hint });
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

function undo(): void {
  const g = game;
  if (!g || g.busy) return;
  if (g.film) g.film = null;
  else g.moves.pop();
  g.filter = '';
  g.hint = false;
  renderPlay();
}

function showHint(): void {
  if (!game || game.busy) return;
  game.hint = true;
  renderPlay();
}

function giveUp(): Promise<void> {
  return guarded(async (g) => {
    const rest = await optimalPath(current(g), loader);
    g.busy = false;
    await finish(g, true, rest);
    game = null;
  });
}

// ---------------------------------------------------------------- result

async function finish(g: Game, gaveUp: boolean, revealed: { film: FilmRef; person: Person }[] = []): Promise<void> {
  const best = await optimalPath(g.start, loader);
  const moves = summary(g.moves);
  if (g.day && loadDaily(g.day)?.start !== g.start.id) saveDaily(g.day, { start: g.start.id, moves, par: g.start.dist, gaveUp });

  const n = g.moves.length;
  const par = g.start.dist;
  const helped = g.moves.some((m) => m.hinted);
  const headline = gaveUp
    ? 'Here’s how it charts'
    : n === par
      ? helped
        ? '#1, with a little help'
        : 'Perfect! Straight to #1'
      : 'You made the countdown!';
  const text = shareText({
    daily: g.day ? dayNumber(g.day) : null,
    start: g.start.name,
    moves,
    par,
    gaveUp,
    url: g.day ? `${shareBase()}#/daily` : `${shareBase()}#/p/${g.start.id}`,
  });

  const yours: ChainStep[] = [...g.moves, ...revealed.map((s) => ({ ...s, revealed: true }))];
  app.replaceChildren(
    topBar(),
    h(
      'section',
      { class: 'card result' },
      h('span', { class: 'pill' }, g.day ? `Daily #${dayNumber(g.day)}` : 'Free play'),
      h('h1', null, headline),
      h('p', { class: 'score' }, h('span', { class: 'emoji' }, emojiRow(moves)), ' ', gaveUp ? `${plural(n, 'film')} played, par ${par}` : `${plural(n, 'film')} · par ${par}`),
      h('div', { class: 'row' }, shareButton(text), h('button', { class: 'btn', type: 'button', onclick: () => void randomStart() }, 'Random star'), h('a', { href: '#', class: 'btn' }, 'Home')),
    ),
    h(
      'div',
      { class: 'result-cols' },
      h('section', null, h('h2', { class: 'section-label' }, gaveUp ? 'Your countdown, finished for you' : 'Your countdown'), tracks(g.start, yours, { countdown: true })),
      gaveUp || n > par ? h('section', null, h('h2', { class: 'section-label' }, `Shortest path · ${plural(par, 'film')}`), tracks(g.start, best, { countdown: true })) : null,
    ),
  );
  window.scrollTo({ top: 0 });
}

function shareButton(text: string): HTMLButtonElement {
  const btn = h('button', { class: 'btn primary', type: 'button' }, 'Share result');
  btn.addEventListener('click', async () => {
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ text });
        return;
      }
      await navigator.clipboard.writeText(text);
      btn.textContent = 'Copied!';
    } catch {
      btn.textContent = 'Couldn’t copy';
    }
    setTimeout(() => (btn.textContent = 'Share result'), 2000);
  });
  return btn;
}
