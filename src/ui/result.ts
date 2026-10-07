import { loader } from '../data';
import { dayKey, dayNumber, emojiRow, optimalPath, plural, shareText, type MoveSummary, type Step } from '../logic';
import { saveDaily } from '../storage';
import { h } from './dom';
import { distOf, type Game } from './play';
import { puzzleUrl, shareButton } from './share';
import { app, randomStart, topBar } from './shell';
import { tracks, type ChainStep } from './tracks';

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

  const yours: ChainStep[] = [...g.moves, ...revealed.map((s) => ({ ...s, revealed: true }))];
  app.replaceChildren(
    topBar(),
    h(
      'section',
      { class: 'card result' },
      h('span', { class: 'pill' + (g.mode === 'hard' ? ' hard' : '') }, label),
      h('h1', null, headline),
      h('p', { class: 'score' }, h('span', { class: 'emoji' }, emojiRow(moves)), ' ', gaveUp ? `${plural(n, 'film')} played, par ${par}` : `${plural(n, 'film')} · par ${par}`),
      h('div', { class: 'row' }, shareButton(text), h('button', { class: 'btn', type: 'button', onclick: () => void randomStart(g.mode) }, 'Random star'), h('a', { href: '#/', class: 'btn' }, 'Home')),
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
