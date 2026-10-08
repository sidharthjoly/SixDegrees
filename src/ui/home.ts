import { getPerson, loadMeta, loadSearch, loadSearchTop } from '../data';
import { JT, dailyPick, dayKey, dayNumber, emojiRow, makeSearch, plural, shareText, type SearchHit } from '../logic';
import { online } from '../online';
import { href } from '../router';
import { loadDaily, type DailyRecord } from '../storage';
import type { Meta, Person, Qid } from '../types';
import { h, yearOf, type Child } from './dom';
import { groupsCard } from './groups';
import { puzzleUrl, shareButton } from './share';
import { startHomeFx } from './homefx';
import { app, go, isCurrent, randomStart, renderLoading, tickerSlot } from './shell';
import { statsBadge } from './stats';

/** Median Timberlake number, from the build's distance histogram. */
export function medianDistance(meta: Meta): number {
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
    meta.bacon != null && `JT’s Bacon number is ${meta.bacon}`,
    'a new daily every midnight',
    'hints show up in your share',
  ]
    .filter((t): t is string => !!t)
    .map((t) => `★ ${t.toUpperCase()}`)
    .join(' ');
  // Two identical copies scroll by half their width, so the loop is seamless.
  return h('div', { class: 'ticker' }, h('div', { class: 'ticker-track' }, h('span', null, text), h('span', { 'aria-hidden': 'true' }, text)));
}

/** The sticker settles onto the page on the first home visit only, not after every game. */
let introDone = false;

export async function renderHome(gen: number): Promise<void> {
  renderLoading();
  const meta = await loadMeta();
  const day = dayKey(new Date());
  const daily = await getPerson(dailyPick(meta.daily, day));
  if (!isCurrent(gen)) return;
  document.title = 'Six Degrees of Justin Timberlake';
  const played = (mode: 'normal' | 'hard') => {
    const rec = loadDaily(day, mode);
    return rec?.start === daily.id ? rec : null;
  };
  tickerSlot.replaceChildren(ticker(meta));
  const home = h(
    'div',
    { class: 'home' + (introDone ? '' : ' intro') },
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
      dailyCard(day, daily, played('normal'), played('hard')),
      groupsCard() ?? '',
      startCard(),
    ),
    h('div', { class: 'home-side' }, h('h2', { class: 'section-label' }, 'How to play · Top 3'), howTo(meta), histogram(meta)),
  );
  app.replaceChildren(
    home,
    h(
      'footer',
      { class: 'footer' },
      h('p', { class: 'footer-links' }, h('a', { href: href({ name: 'archive' }) }, 'Past dailies'), ' · ', h('a', { href: href({ name: 'stats' }) }, 'Your charts')),
      h('p', null, 'Film and cast data from ', h('a', { href: 'https://www.wikidata.org/', rel: 'noopener' }, 'Wikidata'), ` (CC0), built ${meta.built}. Paths and par come from a breadth-first search over every credit.`),
      online && h('p', null, 'Daily results are counted, without names, for the day’s global stats.'),
      h('p', null, 'A fan project. Not affiliated with Justin Timberlake.'),
    ),
  );
  startHomeFx(home);
  introDone = true;
}

function dailyCard(day: string, person: Person, played: DailyRecord | null, playedHard: DailyRecord | null): HTMLElement {
  const n = dayNumber(day);
  const knownFor = person.films[0];
  // Names run from "Pelé" to "Edward Grey, 1st Viscount Grey of Fallodon"; the starburst's
  // points clip anything near its edge, so long names step down a size.
  const size = person.name.length > 26 ? ' longer' : person.name.length > 15 ? ' long' : '';
  const hardHref = href({ name: 'daily', day, mode: 'hard', vs: null });
  const side: Child[] = [statsBadge(), knownFor && h('p', { class: 'known' }, 'Known for ', h('em', null, knownFor.title), yearOf(knownFor))];
  if (played) {
    const text = shareText({ daily: n, mode: 'normal', start: person.name, moves: played.moves, par: played.par, gaveUp: played.gaveUp, url: puzzleUrl({ day, start: person.id, mode: 'normal' }) });
    side.push(
      h('p', { class: 'played' }, played.gaveUp ? 'You gave up today. ' : `You did it in ${plural(played.moves.length, 'film')}. `, h('span', { class: 'emoji' }, emojiRow(played.moves))),
      h('div', { class: 'row' }, shareButton(text), h('a', { href: href({ name: 'daily', day, mode: 'normal', vs: null }), class: 'btn' }, 'Play again')),
    );
  } else {
    side.push(h('a', { href: href({ name: 'daily', day, mode: 'normal', vs: null }), class: 'btn primary' }, 'Play the daily'));
  }
  side.push(
    h(
      'p',
      { class: 'hard-link' },
      playedHard
        ? `Hard mode: ${playedHard.gaveUp ? 'gave up' : plural(playedHard.moves.length, 'film')} ${emojiRow(playedHard.moves)}`
        : h('a', { href: hardHref }, 'Try it in hard mode'),
      ' · no hints, and JT’s five best-known films are banned',
    ),
  );
  return h(
    'section',
    { class: 'daily', 'aria-label': `Daily challenge number ${n}` },
    // The sticker is the biggest thing on the page, so it's also a way into the daily.
    h(
      'a',
      { class: 'sticker-link', href: href({ name: 'daily', day, mode: 'normal', vs: null }), 'aria-label': `Play daily #${n}: ${person.name}, par ${person.normal.dist}` },
      h(
        'div',
        { class: 'sticker' },
        h('span', { class: 'sticker-tag' }, `Daily #${n}`),
        h('span', { class: 'sticker-name' + size }, person.name),
        h('span', { class: 'sticker-tag' }, `Par ${person.normal.dist}`),
      ),
    ),
    h('div', { class: 'daily-side' }, ...side),
  );
}

function howTo(meta: Meta): HTMLElement {
  // --i staggers the cards as they appear: #3, then #2, then #1, like a countdown.
  const step = (i: number, num: string, title: string, sub: Child, extra = '') =>
    h(
      'li',
      { class: 'track' + extra, style: `--i:${i}` },
      h('span', { class: 'track-num' }, num),
      h('div', { class: 'track-body' }, h('span', { class: 'track-title' }, title), h('span', { class: 'track-sub' }, sub)),
    );
  return h(
    'ol',
    { class: 'countdown howto' },
    step(0, '#3', 'Pick a film', 'Any film your star was credited in.'),
    step(1, '#2', 'Pick a co-star', 'Anyone else in that film’s cast.'),
    step(2, '#1', 'Land on Justin', 'Each move charts ▲ closer, ● no closer or ▼ further. Match par to hit #1.', ' number-one'),
    meta.hardBanned.length > 0 && h('li', { class: 'howto-note' }, `Hard mode bans ${meta.hardBanned.map((f) => f.title).join(', ')}.`),
  );
}

/**
 * Stars to start from, five drawn at random on each visit: household names, all at least two
 * films from JT (his own co-stars would be one-move games).
 */
const STAR_PICKS: [Qid, string][] = [
  [38111, 'Leonardo DiCaprio'],
  [873, 'Meryl Streep'],
  [2263, 'Tom Hanks'],
  [35332, 'Brad Pitt'],
  [34436, 'Scarlett Johansson'],
  [1924847, 'Margot Robbie'],
  [193815, 'Ryan Gosling'],
  [189489, 'Zendaya'],
  [43416, 'Keanu Reeves'],
  [42101, 'Denzel Washington'],
  [37876, 'Natalie Portman'],
  [3454165, 'Kevin Bacon'],
  [37079, 'Tom Cruise'],
  [40096, 'Will Smith'],
  [189490, 'Jennifer Lawrence'],
  [19877770, 'Timothée Chalamet'],
  [22277803, 'Florence Pugh'],
  [14752155, 'Pedro Pascal'],
  [165219, 'Robert Downey Jr.'],
  [37175, 'Johnny Depp'],
  [37459, 'Nicole Kidman'],
  [36301, 'Anne Hathaway'],
  [13909, 'Angelina Jolie'],
  [49561909, 'Sydney Sweeney'],
  [192682, 'Ryan Reynolds'],
  [129591, 'Hugh Jackman'],
  [41163, 'Al Pacino'],
  [36949, 'Robert De Niro'],
  [81328, 'Harrison Ford'],
  [45772, 'Christian Bale'],
  [175535, 'Matt Damon'],
  [32522, 'Jennifer Aniston'],
  [40791, 'Sandra Bullock'],
  [39476, 'Emma Watson'],
  [42786, 'Audrey Hepburn'],
  [4616, 'Marilyn Monroe'],
  [40504, 'Jim Carrey'],
  [36970, 'Jackie Chan'],
  [16397, 'Bruce Lee'],
  [2685, 'Arnold Schwarzenegger'],
  [40026, 'Sylvester Stallone'],
  [2023710, 'Tom Holland'],
  [38119, 'Daniel Radcliffe'],
  [214289, 'Michelle Yeoh'],
  [40572, 'Heath Ledger'],
  [185654, 'Gal Gadot'],
  [20882479, 'Anya Taylor-Joy'],
  [21738166, 'Jenna Ortega'],
  [185140, 'Joaquin Phoenix'],
  [80046, 'Charlize Theron'],
  [42581, 'Keira Knightley'],
  [1033016, 'Halle Berry'],
  [126599, 'Kristen Stewart'],
  [36767, 'Robert Pattinson'],
  [54314, 'Chris Hemsworth'],
  [4547, 'Daniel Craig'],
];

/** `n` different stars from the list, in random order. */
function pickStars(n: number, random = Math.random): [Qid, string][] {
  const pool = [...STAR_PICKS];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
}

function startCard(): HTMLElement {
  const results = h('ul', { class: 'results', id: 'search-results' });
  let search: ((q: string, limit?: number) => SearchHit[]) | null = null;
  /** Searching the full list, not just the best-known names that answer first. */
  let complete = false;
  let loading: Promise<void> | null = null;
  let top: SearchHit | undefined;
  const playHref = (qid: Qid) => href({ name: 'play', qid, mode: 'normal', vs: null });

  const show = (q: string) => {
    if (!search) return;
    const hits = search(q);
    top = hits[0];
    results.replaceChildren(
      ...hits.map(({ row, alias }) =>
        h(
          'li',
          null,
          h(
            'button',
            { class: 'option', type: 'button', onclick: () => go(playHref(row[0])) },
            h('span', { class: 'opt-main' }, row[1], alias && h('span', { class: 'opt-alias' }, ` “${alias}”`), h('span', { class: 'opt-sub' }, row[4])),
            h('span', { class: 'opt-meta' }, row[0] === JT ? '★' : `par ${row[3]}`),
          ),
        ),
      ),
    );
    if (q.trim() && hits.length === 0)
      results.append(h('li', { class: 'empty' }, complete ? 'No one by that name. Only people with a Wikipedia article in several languages are listed here.' : 'Searching everyone…'));
  };

  const input = h('input', {
    type: 'search',
    id: 'start-search',
    placeholder: 'Any name, e.g. Tom Hanks',
    autocomplete: 'off',
    spellcheck: 'false',
    'aria-controls': 'search-results',
    oninput: () => show(input.value),
    onfocus: () => {
      if (loading) return;
      results.replaceChildren(h('li', { class: 'empty' }, 'Loading names…'));
      // The 2,000 best-known names (about 70 KB) answer straight away; the full list (about
      // 0.9 MB, seconds on a slow phone connection) follows, after them so it doesn't
      // compete for the connection, and takes over when it arrives.
      loading = loadSearchTop()
        .then((index) => {
          if (complete) return;
          search = makeSearch(index);
          show(input.value);
        })
        .catch(() => undefined)
        .then(loadSearch)
        .then((index) => {
          search = makeSearch(index);
          complete = true;
          show(input.value);
        })
        .catch((err: unknown) => {
          if (!search) results.replaceChildren(h('li', { class: 'empty' }, String(err)));
          else complete = true;
        });
    },
    onkeydown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' && top) go(playHref(top.row[0]));
    },
  });

  return h(
    'section',
    { class: 'card' },
    h('label', { class: 'label', for: 'start-search' }, 'Free play: pick any star'),
    input,
    results,
    h(
      'div',
      { class: 'chips' },
      ...pickStars(5).map(([id, name]) => h('a', { class: 'chip', href: playHref(id) }, name)),
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

  const cols = rows.map(([d, n], i) => {
    const label = `${plural(d, 'film')} from JT: ${n.toLocaleString()} people (${((100 * n) / total).toFixed(n / total < 0.001 ? 2 : 1)}%)`;
    const showTip = () => (tip.textContent = label);
    return h(
      'div',
      { class: 'col', style: `--i:${i}`, tabindex: '0', 'aria-label': label, onmouseenter: showTip, onfocus: showTip, onmouseleave: () => (tip.textContent = ''), onblur: () => (tip.textContent = '') },
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
    // A table won't shrink to the 1px sr-only box, so hide a wrapper instead; otherwise
    // the page scrolls sideways on phones.
    h(
      'div',
      { class: 'sr-only' },
      h(
        'table',
        null,
        h('caption', null, 'People by number of films from Justin Timberlake'),
        h('thead', null, h('tr', null, h('th', null, 'Films'), h('th', null, 'People'))),
        h('tbody', null, ...rows.map(([d, n]) => h('tr', null, h('td', null, d), h('td', null, n.toLocaleString())))),
      ),
    ),
  );
}
