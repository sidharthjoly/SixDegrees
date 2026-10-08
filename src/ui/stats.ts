import { dayKey, plural } from '../logic';
import { href } from '../router';
import { BUCKETS, computeStats, isUsable, percent, streakDays, type Bucket, type ModeStats } from '../scores';
import { listDailies } from '../storage';
import { h } from './dom';
import { app, isCurrent, topBar } from './shell';

/**
 * "Your charts": streaks, par rate and a score chart, from the dailies saved in this browser.
 * The chart reuses the home page histogram's classes (home.css) so the two always match.
 */

/** Small streak badge for the home page's daily card, or null when there's nothing to show. */
export function statsBadge(): HTMLElement | null {
  // Runs inside the home page render, so a corrupt record must never throw out of here.
  try {
    const { current } = computeStats(listDailies(), dayKey(new Date())).streak;
    if (current < 2) return null;
    return h(
      'a',
      { class: 'streak-badge', href: href({ name: 'stats' }) },
      h('span', { 'aria-hidden': 'true' }, '★'),
      `${current}-day streak`,
      h('span', { class: 'sr-only' }, ' · see your charts'),
    );
  } catch {
    return null;
  }
}

export async function renderStats(gen: number): Promise<void> {
  const today = dayKey(new Date());
  const records = listDailies();
  const stats = computeStats(records, today);
  if (!isCurrent(gen)) return;
  document.title = 'Your charts · Six Degrees';
  const todayHref = href({ name: 'daily', day: today, mode: 'normal', vs: null });
  const links = h(
    'div',
    { class: 'row page-links' },
    h('a', { href: href({ name: 'archive' }), class: 'btn' }, 'Past dailies'),
    h('a', { href: todayHref, class: 'btn primary' }, 'Today’s daily'),
  );
  const head = h(
    'header',
    { class: 'page-head' },
    h('h1', { class: 'page-title' }, 'Your charts'),
    h('p', { class: 'page-lede' }, 'Saved in this browser, so there’s nothing to sign up for. Clearing your browser data clears these too.'),
    links,
  );

  if (stats.normal.played + stats.hard.played === 0) {
    app.replaceChildren(
      topBar(),
      head,
      h(
        'section',
        { class: 'card stats-empty' },
        h('h2', null, 'Nothing charting yet'),
        h('p', null, 'Finish a daily and your streak, par rate and scores show up here.'),
        h('a', { href: todayHref, class: 'btn primary' }, 'Play today’s daily'),
      ),
    );
    return;
  }

  const { normal, hard, streak } = stats;
  const playedToday = streakDays(records.filter((r) => isUsable(r, today))).has(today);
  app.replaceChildren(
    topBar(),
    head,
    h(
      'section',
      { class: 'card stats-card', 'aria-labelledby': 'stats-daily' },
      h('h2', { id: 'stats-daily' }, 'The daily'),
      tiles([
        { value: String(normal.played), label: 'Played', detail: normal.played === 1 ? 'daily' : 'dailies' },
        rateTile('Finished', normal.completed, normal.played),
        rateTile('Par or better', normal.parOrBetter, normal.played),
        {
          value: String(streak.current),
          label: 'Streak',
          detail: streak.current > 0 && !playedToday ? 'play today to keep it' : streak.current === 1 ? 'day' : 'days in a row',
          hot: streak.current >= 2,
        },
        { value: String(streak.best), label: 'Best streak', detail: streak.best === 1 ? 'day' : 'days' },
      ]),
      h('p', { class: 'muted stats-note' }, 'A streak is consecutive days with that day’s daily finished on the day, in normal mode, without giving up. Past dailies played late don’t count.'),
    ),
    normal.played > 0
      ? scoreChart(normal, 'Your scores', 'How your dailies charted against par')
      : h('section', { class: 'card' }, h('h2', null, 'Your scores'), h('p', null, 'No normal-mode dailies yet.')),
    hardSection(hard, today),
  );
}

interface Tile {
  value: string;
  label: string;
  detail: string;
  hot?: boolean;
}

function rateTile(label: string, part: number, whole: number): Tile {
  const pct = percent(part, whole);
  return { value: pct === null ? '–' : `${pct}%`, label, detail: whole ? `${part} of ${plural(whole, 'game')}` : 'no games yet' };
}

function tiles(list: Tile[], small = false): HTMLElement {
  return h(
    'dl',
    { class: 'stat-tiles' + (small ? ' small' : '') },
    ...list.map((t) =>
      h(
        'div',
        { class: 'stat-tile' + (t.hot ? ' hot' : '') },
        h('dt', null, t.label),
        h('dd', null, h('span', { class: 'stat-value' }, t.value), h('span', { class: 'stat-detail' }, t.detail)),
      ),
    ),
  );
}

const BUCKET_TICK: Record<Bucket, string> = { par: 'Par', plus1: '+1', plus2: '+2', plus3: '+3 or more', gaveUp: 'Gave up' };
const BUCKET_LABEL: Record<Bucket, string> = { par: 'Par or better', plus1: 'One over par', plus2: 'Two over par', plus3: 'Three or more over par', gaveUp: 'Gave up' };

/** Column chart of results by films over par, styled and made accessible like the home page's. */
function scoreChart(s: ModeStats, title: string, caption: string, small = false): HTMLElement {
  const max = Math.max(...BUCKETS.map((b) => s.distribution[b]));
  const tip = h('div', { class: 'tip', role: 'status' });
  const cols = BUCKETS.map((b) => {
    const n = s.distribution[b];
    const label = `${BUCKET_LABEL[b]}: ${plural(n, 'game')} (${percent(n, s.played)}%)`;
    const showTip = () => (tip.textContent = label);
    const hideTip = () => (tip.textContent = '');
    return h(
      'div',
      { class: 'col', tabindex: '0', 'aria-label': label, onmouseenter: showTip, onfocus: showTip, onmouseleave: hideTip, onblur: hideTip },
      h('span', { class: 'cap' }, n),
      h('span', { class: 'bar-fill' + (b === 'gaveUp' ? ' gave-up' : ''), style: `height:${Math.max((100 * n) / max, 0.8)}%` }),
    );
  });
  return h(
    'section',
    // The small (hard-mode) chart sits inside its own card, so it doesn't get another frame.
    { class: 'chart score-chart' + (small ? ' small' : ' card') },
    h(small ? 'h3' : 'h2', null, title),
    h('div', { class: 'plot', style: `grid-template-columns:repeat(${BUCKETS.length},1fr)`, role: 'img', 'aria-label': `Column chart: ${caption}` }, ...cols),
    h('div', { class: 'ticks', 'aria-hidden': 'true' }, ...BUCKETS.map((b) => h('span', null, BUCKET_TICK[b]))),
    h('p', { class: 'axis-label' }, 'Films over par'),
    tip,
    // The wrapper is what's visually hidden: a table won't shrink to 1px and would widen the page.
    h(
      'div',
      { class: 'sr-only' },
      h(
        'table',
        null,
        h('caption', null, caption),
        h('thead', null, h('tr', null, h('th', null, 'Result'), h('th', null, 'Games'))),
        h('tbody', null, ...BUCKETS.map((b) => h('tr', null, h('td', null, BUCKET_LABEL[b]), h('td', null, s.distribution[b])))),
      ),
    ),
  );
}

function hardSection(hard: ModeStats, today: string): HTMLElement {
  const body =
    hard.played === 0
      ? [h('p', null, 'No hard-mode dailies yet. ', h('a', { href: href({ name: 'daily', day: today, mode: 'hard', vs: null }) }, 'Try today’s in hard mode'), '.')]
      : [
          tiles(
            [
              { value: String(hard.played), label: 'Played', detail: hard.played === 1 ? 'game' : 'games' },
              rateTile('Finished', hard.completed, hard.played),
              rateTile('Par or better', hard.parOrBetter, hard.played),
            ],
            true,
          ),
          scoreChart(hard, 'Hard-mode scores', 'How your hard-mode dailies charted against par', true),
        ];
  return h(
    'section',
    { class: 'card stats-hard', 'aria-labelledby': 'stats-hard' },
    h('h2', { id: 'stats-hard' }, 'Hard mode'),
    h('p', { class: 'muted' }, 'No hints, and JT’s five best-known films are banned. Kept apart from your daily stats.'),
    ...body,
  );
}
