import { getFilm } from '../data';
import { dayNumber, plural } from '../logic';
import { dayStats, everyoneLead, online, type DayStats } from '../online';
import { percent, type ModeStats } from '../scores';
import type { Mode } from '../types';
import { h } from './dom';
import { scoreChart, tiles, type Tile } from './stats';

/**
 * "Everyone today" on a daily's result screen: where the player stands among everyone who
 * played that daily on its day, with the day's par rate, the most popular opening film and
 * how many took the same route. Hidden when the game isn't connected to a server, and
 * removed if the server can't be reached.
 */

export interface EveryoneInput {
  day: string;
  mode: Mode;
  par: number;
  films: number;
  gaveUp: boolean;
  /** Played after the daily's own day: it isn't counted, so there's no standing to show. */
  late: boolean;
}

/** `uploaded` settles once the player's own result has been sent, so it's in the counts. */
export function everyonePanel(input: EveryoneInput, uploaded: Promise<void>, onStats: (s: DayStats) => void): HTMLElement | null {
  if (!online) return null;
  const status = h('p', { class: 'muted everyone-status', role: 'status' }, 'Counting today’s players…');
  const panel = h('section', { class: 'card everyone', 'aria-busy': 'true' }, h('h2', null, input.late ? `Everyone on daily #${dayNumber(input.day)}` : 'Everyone today'), status);
  void (async () => {
    try {
      await uploaded;
      const stats = await dayStats(input.day, input.mode);
      onStats(stats);
      if (stats.players === 0) {
        panel.remove();
        return;
      }
      const opener = stats.opener ? await getFilm(stats.opener.film).then((f) => f.title, () => null) : null;
      status.replaceWith(...body(input, stats, opener));
      panel.setAttribute('aria-busy', 'false');
    } catch {
      panel.remove();
    }
  })();
  return panel;
}

function body(input: EveryoneInput, s: DayStats, opener: string | null): Node[] {
  const pct = (n: number) => `${percent(n, s.players) ?? 0}%`;
  const players = plural(s.players, 'player');
  const [before, highlight, after] = everyoneLead(s, input.gaveUp, input.late);
  const lead = h('p', { class: 'everyone-lead' }, before, highlight && h('strong', null, highlight), after);

  const list: Tile[] = [
    { label: 'Made par', value: pct(s.atPar), detail: `${s.atPar} of ${players}` },
    { label: 'Gave up', value: pct(s.gaveUp), detail: `${s.gaveUp} of ${players}` },
  ];
  if (s.opener && opener) list.push({ label: 'Top opening film', value: pct(s.opener.players), detail: opener });
  if (s.me && !input.gaveUp && !input.late) {
    const same = s.me.sameRoute;
    list.push(same === 0 ? { label: 'Your route', value: 'Only you', detail: 'Nobody else went your way', hot: true } : { label: 'Your route', value: pct(same + 1), detail: `${same} other ${same === 1 ? 'player' : 'players'} went your way` });
  }

  const caption = `Today’s results for everyone who played daily #${dayNumber(input.day)}${input.mode === 'hard' ? ' in hard mode' : ''}, by films over par`;
  return [lead, tiles(list, true), scoreChart(chartStats(s, input.par), 'Everyone’s scores', caption, true), h('p', { class: 'muted everyone-note' }, 'From everyone’s first go at the daily on its day. Results are counted without names.')];
}

/** The day's spread in the shape the "Your charts" chart takes. */
export function chartStats(s: DayStats, par: number): ModeStats {
  const distribution = { par: 0, plus1: 0, plus2: 0, plus3: 0, gaveUp: s.gaveUp };
  let completed = 0;
  for (const [films, n] of Object.entries(s.films)) {
    const over = Number(films) - par;
    completed += n;
    if (over <= 0) distribution.par += n;
    else if (over === 1) distribution.plus1 += n;
    else if (over === 2) distribution.plus2 += n;
    else distribution.plus3 += n;
  }
  return { played: s.players, completed, parOrBetter: distribution.par, distribution };
}
