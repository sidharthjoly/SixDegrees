import { loader } from '../data';
import { dayKey, dayNumber, emojiRow, optimalPath, plural, shareText, type MoveSummary, type Step } from '../logic';
import { saveDaily } from '../storage';
import type { Mode, Person } from '../types';
import { challengePanel } from './challenge';
import { h } from './dom';
import { celebrate } from './fx';
import { distOf, type Game, type Move } from './play';
import { puzzleUrl, shareActions } from './share';
import { app, randomStart, topBar } from './shell';
import { tracks, type ChainStep } from './tracks';

/** Everything the result screen knows, handed to the share and challenge features. */
export interface ResultContext {
  /** The daily's date, or null for free play. */
  day: string | null;
  mode: Mode;
  start: Person;
  par: number;
  /** The player's own moves. */
  moves: Move[];
  gaveUp: boolean;
  /** The rest of a shortest path from where the player gave up (empty otherwise). */
  revealed: Step[];
  /** A shortest path from the start. */
  best: Step[];
  /** The plain-text share: title, emoji row, link. */
  text: string;
  /** The friend's challenge code this game was started from, if any. */
  vs: string | null;
}

export async function finish(g: Game, gaveUp: boolean, revealed: Step[] = []): Promise<void> {
  const best = await optimalPath(g.start, loader, g.mode);
  const moves: MoveSummary[] = g.moves.map((m) => ({ grade: m.grade, hinted: m.hinted }));
  const n = g.moves.length;
  const par = distOf(g, g.start);
  if (g.day) {
    const today = dayKey(new Date());
    saveDaily({
      v: 2,
      day: g.day,
      mode: g.mode,
      start: g.start.id,
      par,
      moves,
      path: g.moves.map((m) => [m.film.id, m.person.id]),
      gaveUp,
      late: g.day !== today,
      at: new Date().toISOString(),
    });
  }

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
    mode: g.mode,
    start: g.start.name,
    moves,
    par,
    gaveUp,
    url: puzzleUrl({ day: g.day, start: g.start.id, mode: g.mode }),
  });
  const label = (g.day ? `Daily #${dayNumber(g.day)}` : 'Free play') + (g.mode === 'hard' ? ' · Hard' : '');
  const ctx: ResultContext = { day: g.day, mode: g.mode, start: g.start, par, moves: g.moves, gaveUp, revealed, best, text, vs: g.vs };

  const yours: ChainStep[] = [...g.moves, ...revealed.map((s) => ({ ...s, revealed: true }))];
  const panel = challengePanel(ctx);
  // A friend's challenge shows your countdown beside theirs, so don't repeat it below.
  const compared = !!panel?.querySelector('.vs-cols');
  app.replaceChildren(
    topBar(),
    h(
      'section',
      { class: 'card result' },
      h('span', { class: 'pill' + (g.mode === 'hard' ? ' hard' : '') }, label),
      h('h1', null, headline),
      h('p', { class: 'score' }, h('span', { class: 'emoji' }, emojiRow(moves)), ' ', gaveUp ? `${plural(n, 'film')} played, par ${par}` : `${plural(n, 'film')} · par ${par}`),
      h('div', { class: 'row' }, shareActions(ctx), h('button', { class: 'btn', type: 'button', onclick: () => void randomStart(g.mode) }, 'Random star'), h('a', { href: '#/', class: 'btn' }, 'Home')),
    ),
    panel ?? '',
    h(
      'div',
      { class: 'result-cols' },
      compared ? null : h('section', null, h('h2', { class: 'section-label' }, gaveUp ? 'Your countdown, finished for you' : 'Your countdown'), tracks(g.start, yours, { countdown: true })),
      gaveUp || n > par ? h('section', null, h('h2', { class: 'section-label' }, `Shortest path · ${plural(par, 'film')}`), tracks(g.start, best, { countdown: true })) : null,
    ),
  );
  window.scrollTo({ top: 0 });
  // The first #1 card on the page is always the player's own (theirs comes second).
  if (!gaveUp) celebrate(app.querySelector<HTMLElement>('.track.number-one') ?? app);
}
