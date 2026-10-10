import { dailyBollywood, dailyStar, getPerson, loadMeta } from '../data';
import { archiveDays, formatDay } from '../days';
import { bollywoodDaily, dailyPick, dayKey, dayNumber, plural } from '../logic';
import { href } from '../router';
import { isUsable } from '../scores';
import { loadDaily, type DailyRecord } from '../storage';
import type { Mode, Qid } from '../types';
import { h, type Child } from './dom';
import { app, isCurrent, renderLoading, renderMessage, topBar } from './shell';
import { describeMoves, gradeSquares } from './squares';

/**
 * Past dailies, newest first, each linking to its normal, hard, star and Bollywood game. Who
 * each day starts from costs a person-shard fetch (and its stars more), so names load only for
 * rows near the viewport, a few fetches at a time.
 */

/** Person fetches in flight at once: enough to fill a screen quickly without a request storm. */
const CONCURRENCY = 3;
/** Rows loaded up front when IntersectionObserver is missing (very old browsers). */
const NO_OBSERVER_ROWS = 20;

export async function renderArchive(gen: number): Promise<void> {
  renderLoading();
  const meta = await loadMeta();
  if (!isCurrent(gen)) return;
  const today = dayKey(new Date());
  const days = archiveDays(today);
  if (days.length === 0) {
    renderMessage('No dailies yet', 'Dailies start on 8 October 2026. Check your device’s date if that has passed.');
    return;
  }
  document.title = 'Past dailies · Six Degrees';
  const pick = (day: string) => dailyPick(meta.daily, day);
  const rows = days.map((day) => row(day, today, pick));

  app.replaceChildren(
    topBar(),
    h(
      'header',
      { class: 'page-head' },
      h('h1', { class: 'page-title' }, 'Past dailies'),
      h('p', { class: 'page-lede' }, 'Every daily so far, newest first. Play any you missed: late finishes are marked, and don’t count toward your streak.'),
      h('div', { class: 'row page-links' }, h('a', { href: href({ name: 'stats' }), class: 'btn' }, 'Your charts')),
    ),
    h('ol', { class: 'archive', 'aria-label': 'Dailies, newest first' }, ...rows.map((r) => r.el)),
  );
  lazyLoad(rows, gen, pick);
}

interface Row {
  day: string;
  el: HTMLElement;
  /** Filled with the start person and par once loaded. */
  who: HTMLElement;
  hard: HTMLElement;
  star: HTMLElement;
  bollywood: HTMLElement;
  bollywoodHard: HTMLElement;
}

function row(day: string, today: string, pick: (day: string) => Qid): Row {
  const n = dayNumber(day);
  const isToday = day === today;
  const who = h('p', { class: 'arc-who muted' }, 'Loading…');
  const hard = modeLink(day, 'hard', played(day, 'hard', today, pick), n);
  // Whether a star or Bollywood daily's record is for the day's puzzle is only known once
  // that loads (see lazyLoad).
  const star = modeLink(day, 'star', played(day, 'star', today, pick), n);
  const bollywood = modeLink(day, 'bollywood', played(day, 'bollywood', today, pick), n);
  const bollywoodHard = modeLink(day, 'bollywood-hard', played(day, 'bollywood-hard', today, pick), n);
  const el = h(
    'li',
    { class: 'card arc-row' + (isToday ? ' today' : '') },
    h(
      'div',
      { class: 'arc-head' },
      h('h2', { class: 'arc-num' }, `Daily #${n}`),
      h('span', { class: 'arc-date' }, formatDay(day, today)),
      isToday && h('span', { class: 'arc-today' }, 'Today'),
    ),
    who,
    h('div', { class: 'arc-modes' }, modeLink(day, 'normal', played(day, 'normal', today, pick), n), hard, star, bollywood, bollywoodHard),
  );
  return { day, el, who, hard, star, bollywood, bollywoodHard };
}

/** The saved finish for that day and mode, if it was for the start that day has now. */
function played(day: string, mode: Mode, today: string, pick: (day: string) => Qid): DailyRecord | null {
  const rec = loadDaily(day, mode);
  if (!rec || !isUsable(rec, today)) return null;
  // The Bollywood daily has its own start, checked once it loads.
  if (bollywoodDaily(mode)) return rec;
  // Picking is a hash over the whole pool, so only pay for it when there's a record to check.
  return rec.start === pick(day) ? rec : null;
}

const MODE_NAME: Record<Mode, string> = { normal: 'Normal', hard: 'Hard', star: 'Star', bollywood: 'Bollywood', 'bollywood-hard': 'Bollywood hard' };

function modeLink(day: string, mode: Mode, rec: DailyRecord | null, n: number): HTMLElement {
  const modeName = MODE_NAME[mode];
  let status: string;
  let detail: Child[];
  if (!rec) {
    status = 'not played';
    detail = [h('span', { class: 'arc-status' }, 'Not played'), h('span', { class: 'arc-go', 'aria-hidden': 'true' }, 'Play ›')];
  } else {
    const score = rec.gaveUp ? `gave up after ${plural(rec.moves.length, 'film')}` : plural(rec.moves.length, 'film');
    status = score + (rec.moves.length ? `: ${describeMoves(rec.moves)}` : '') + (rec.late ? ', played late' : '');
    detail = [
      rec.moves.length > 0 && gradeSquares(rec.moves, { small: true, hidden: true }),
      h('span', { class: 'arc-status' }, rec.gaveUp ? 'Gave up' : plural(rec.moves.length, 'film')),
      rec.late && h('span', { class: 'arc-late' }, 'Late'),
    ];
  }
  return h(
    'a',
    {
      class: 'arc-mode' + (mode === 'normal' ? '' : ` ${mode}`) + (rec ? ' done' : ''),
      href: href({ name: 'daily', day, mode, vs: null }),
      // The squares are hidden from screen readers, so the label says what they show.
      'aria-label': `${modeName}, Daily #${n}: ${status}`,
    },
    h('span', { class: 'arc-mode-name' }, modeName),
    h('span', { class: 'arc-detail' }, ...detail),
  );
}

const nameOf = async (id: Qid) => (await getPerson(id)).name;

/** Fill in each row's start person when it comes near the viewport. */
function lazyLoad(rows: Row[], gen: number, pick: (day: string) => Qid): void {
  const queue: Row[] = [];
  let active = 0;

  const off = (name: string, why: string) => h('span', { class: 'arc-mode off' }, h('span', { class: 'arc-mode-name' }, name), h('span', { class: 'arc-detail' }, why));
  const load = async (r: Row) => {
    try {
      // The Bollywood daily is extra here: a day without its file still shows the rest.
      const [person, star, bolly, bollyHard] = await Promise.all([
        getPerson(pick(r.day)),
        dailyStar(r.day),
        dailyBollywood(r.day).catch(() => null),
        dailyBollywood(r.day, true).catch(() => null),
      ]);
      const bollyStart = bolly && (await nameOf(bolly.start));
      if (!isCurrent(gen)) return;
      r.who.classList.remove('muted');
      const hardPar = person.hard.dist;
      r.who.replaceChildren(
        h('span', { class: 'arc-name' }, person.name),
        h('span', { class: 'arc-par' }, ` · par ${person.normal.dist}`, hardPar === Infinity ? '' : `, hard ${hardPar}`),
        ...(star ? [h('span', { class: 'arc-par' }, ` · star: ${star.star.name}, par ${star.par}`)] : []),
        ...(bolly ? [h('span', { class: 'arc-par' }, ` · Bollywood: ${bollyStart}, par ${bolly.par}`, bollyHard ? `, hard ${bollyHard.par}` : '')] : []),
      );
      // Some starts only reach Justin through films hard mode bans.
      if (hardPar === Infinity) r.hard.replaceWith(off('Hard', 'No hard-mode path'));
      if (!star) r.star.replaceWith(off('Star', 'Every star is too close'));
      else if (r.star.classList.contains('done') && loadDaily(r.day, 'star')?.target !== star.star.id) {
        // Finished for a star the day no longer has (the data was rebuilt): it's unplayed now.
        r.star.replaceWith(modeLink(r.day, 'star', null, dayNumber(r.day)));
      }
      // Finished for a start the day no longer has (the data was rebuilt): unplayed now, as above.
      for (const [mode, el, daily] of [['bollywood', r.bollywood, bolly], ['bollywood-hard', r.bollywoodHard, bollyHard]] as const) {
        const rec = loadDaily(r.day, mode);
        if (!daily) el.replaceWith(off(MODE_NAME[mode], 'No Bollywood daily'));
        else if (el.classList.contains('done') && (rec?.start !== daily.start || rec.target !== daily.star.id)) el.replaceWith(modeLink(r.day, mode, null, dayNumber(r.day)));
      }
    } catch {
      if (isCurrent(gen)) r.who.textContent = 'Couldn’t load who this day starts from.';
    }
  };

  const pump = () => {
    while (active < CONCURRENCY && queue.length > 0 && isCurrent(gen)) {
      const r = queue.shift()!;
      active++;
      void load(r).finally(() => {
        active--;
        pump();
      });
    }
  };

  if (typeof IntersectionObserver === 'undefined') {
    queue.push(...rows.slice(0, NO_OBSERVER_ROWS));
    pump();
    return;
  }

  const byEl = new Map(rows.map((r) => [r.el as Element, r]));
  const io = new IntersectionObserver(
    (entries) => {
      if (!isCurrent(gen)) {
        io.disconnect();
        return;
      }
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        const r = byEl.get(e.target);
        if (r) queue.push(r);
      }
      pump();
    },
    // Start a little before rows scroll into view, so names are usually there on arrival.
    { rootMargin: '300px 0px' },
  );
  for (const r of rows) io.observe(r.el);
}
