import { MAX_NAME_LENGTH, cleanName, compareResults, decodeChallenge, encodeChallenge, sideOf, type Challenge, type Reason, type Side } from '../challenge-code';
import { getPerson } from '../data';
import { JT, dayNumber, plural, shareText, targetOf, type Goal, type MoveSummary } from '../logic';
import { loadPlayerName, savePlayerName } from '../storage';
import type { Mode, Person, Qid } from '../types';
import { h } from './dom';
import type { Game } from './play';
import type { ResultContext } from './result';
import { puzzleUrl } from './share';
import { gradeSquares } from './squares';
import { tracks, type ChainStep } from './tracks';

/**
 * "Beat my score" links. The result screen packs the game into a ?vs= code (see
 * challenge-code.ts); a friend opening the link plays the same puzzle with the challenger's
 * grades on screen, and sees their films only after finishing. No server involved.
 */

type Parsed = { kind: 'none' } | { kind: 'broken' } | { kind: 'elsewhere' } | { kind: 'ok'; challenge: Challenge };

/**
 * A code's rules: hard or normal. The star daily plays by normal rules, so its codes are the
 * same as free play's from that start to that star: the same puzzle, either way.
 */
const rules = (mode: Mode): Mode => (mode === 'hard' ? 'hard' : 'normal');

/** The code from the link, checked against the puzzle actually being played. */
function parse(vs: string | null, start: Qid, mode: Mode, goal: Goal): Parsed {
  if (!vs) return { kind: 'none' };
  const challenge = decodeChallenge(vs);
  if (!challenge) return { kind: 'broken' };
  // The route decides the puzzle; a code made for another one would compare apples to pears.
  if (challenge.start !== start || challenge.mode !== rules(mode) || (challenge.target ?? JT) !== goal.id) return { kind: 'elsewhere' };
  return { kind: 'ok', challenge };
}

const NOTES = {
  broken: 'That challenge link didn’t work',
  elsewhere: 'That challenge link is for a different puzzle',
};

/** The challenger as named in prose: their chosen name, or "your friend". */
function who(c: Challenge, capital = false): string {
  return c.name ?? (capital ? 'Your friend' : 'your friend');
}

/** Names are shown in the text face even inside display-font headings, as everywhere else. */
const nameSpan = (text: string) => h('span', { class: 'name' }, text);

const summaries = (moves: MoveSummary[]): MoveSummary[] => moves.map((m) => ({ grade: m.grade, hinted: m.hinted }));

/** "4 films, 1 hint" or "gave up after 2 films". */
function scoreLine(side: Side): string {
  const films = side.gaveUp ? `gave up after ${plural(side.films, 'film')}` : plural(side.films, 'film');
  return side.hints ? `${films}, ${plural(side.hints, 'hint')}` : films;
}

/* ------------------------------------------------------------ play screen */

/** Shown on the play screen under the status: the score to beat, without giving away the route. */
export function challengeBanner(game: Game): HTMLElement | null {
  const parsed = parse(game.vs, game.start.id, game.mode, game.goal);
  if (parsed.kind === 'none') return null;
  if (parsed.kind !== 'ok') return h('p', { class: 'note vs-note', role: 'status' }, `${NOTES[parsed.kind]}, so this is a regular game.`);
  const c = parsed.challenge;
  const par = game.reach.dist;
  return h(
    'section',
    { class: 'vs-banner', 'aria-label': 'Challenge' },
    h('span', { class: 'vs-tag', 'aria-hidden': 'true' }, 'VS'),
    h(
      'div',
      { class: 'vs-banner-body' },
      h('p', { class: 'vs-line' }, h('strong', null, `Beat ${who(c)}: `), `${scoreLine(sideOf(c.moves, c.gaveUp))} (par ${par})`),
      c.moves.length > 0 && gradeSquares(c.moves),
      h('p', { class: 'vs-hint' }, c.gaveUp ? `They didn’t make it, so reaching ${game.goal.id === JT ? 'Justin' : game.goal.name} wins.` : 'Their films stay hidden until you finish.'),
    ),
  );
}

/* ------------------------------------------------------------ result screen */

/** Shown on the result screen: who won and both countdowns, plus a way to send a challenge. */
export function challengePanel(ctx: ResultContext): HTMLElement | null {
  const parsed = parse(ctx.vs, ctx.start.id, ctx.mode, ctx.goal);
  const wrap = h('div', { class: 'challenge' });
  if (parsed.kind === 'ok') {
    wrap.append(verdict(ctx, parsed.challenge), comparison(ctx, parsed.challenge));
    return wrap;
  }
  if (parsed.kind !== 'none') wrap.append(h('p', { class: 'note vs-note' }, `${NOTES[parsed.kind]}, so there was no score to compare.`));
  wrap.append(
    h(
      'section',
      { class: 'card vs-send' },
      h('h2', null, 'Challenge a friend'),
      sendForm(ctx, 'Send this puzzle with your score attached. They see your grades while they play, and your films once they finish.'),
    ),
  );
  return wrap;
}

const REASONS: Record<Reason, (you: Side, them: Side, c: Challenge) => string> = {
  films: (you, them) => `${plural(you.films, 'film')} to their ${them.films}.`,
  hints: (you, them) => `Both ${plural(you.films, 'film')}, so hints decide it: ${you.hints} to their ${them.hints}.`,
  gaveUp: (you, them, c) => (you.gaveUp ? `You gave up; ${who(c)} made it in ${plural(them.films, 'film')}.` : `${who(c, true)} gave up; you made it in ${plural(you.films, 'film')}.`),
  bothGaveUp: () => 'You both gave up. Call it a draw.',
  tie: (you) => `Both ${plural(you.films, 'film')} with ${plural(you.hints, 'hint')}. A dead heat.`,
};

function verdict(ctx: ResultContext, c: Challenge): HTMLElement {
  const yourMoves = summaries(ctx.moves);
  const you = sideOf(yourMoves, ctx.gaveUp);
  const them = sideOf(c.moves, c.gaveUp);
  const { outcome, reason } = compareResults(you, them);
  const headline =
    outcome === 'win' ? ['You beat ', nameSpan(who(c)), '!'] : outcome === 'lose' ? [nameSpan(who(c, true)), ' wins this one'] : ['It’s a draw'];
  const row = (label: string, side: Side, moves: MoveSummary[], won: boolean) =>
    h(
      'div',
      { class: 'vs-side' },
      h('dt', null, label, won && h('span', { class: 'vs-won' }, '★ Winner')),
      h('dd', null, moves.length > 0 && gradeSquares(moves), h('span', { class: 'vs-score' }, scoreLine(side))),
    );
  return h(
    'section',
    { class: 'card vs-verdict' },
    h('span', { class: 'pill' }, 'Challenge'),
    h('h2', null, ...headline),
    h('p', { class: 'vs-reason' }, REASONS[reason](you, them, c)),
    h('dl', { class: 'vs-board' }, row('You', you, yourMoves, outcome === 'win'), row(c.name ?? 'Your friend', them, c.moves, outcome === 'lose')),
    h('h3', { class: 'label vs-again' }, 'Challenge someone else'),
    sendForm(ctx, null),
  );
}

/** Your countdown and theirs, side by side. Theirs loads person shards, so it fills in when ready. */
function comparison(ctx: ResultContext, c: Challenge): HTMLElement {
  const heading = h('h2', { class: 'section-label' }, ...(c.name ? [nameSpan(`${c.name}’s`), ' countdown'] : ['Their countdown']));
  const theirs = h('section', { class: 'vs-col' }, heading, h('p', { class: 'muted vs-loading', role: 'status' }, 'Loading their films…'));
  const cols = h(
    'div',
    { class: 'vs-cols' },
    h('section', { class: 'vs-col' }, h('h2', { class: 'section-label' }, 'Your countdown'), tracks(ctx.start, ctx.moves, { countdown: !ctx.gaveUp })),
    theirs,
  );
  const fallback = (why: string) => theirs.replaceChildren(heading, h('p', { class: 'muted vs-loading', role: 'status' }, why), c.moves.length > 0 ? gradeSquares(c.moves) : '');
  if (!c.path) {
    fallback('Their link only carried their grades, not their films.');
  } else {
    friendSteps(ctx.start, c, c.path)
      .then((steps) => {
        if (!theirs.isConnected) return;
        if (steps) theirs.replaceChildren(heading, tracks(ctx.start, steps, { countdown: !c.gaveUp }));
        else fallback('Their films don’t match this puzzle, so here are just their grades.');
      })
      .catch(() => theirs.isConnected && fallback('Couldn’t load their films, so here are just their grades.'));
  }
  return cols;
}

/**
 * The friend's moves as countdown entries, from person shards alone: a film's title is in
 * the credits of both people it links. Null when the path doesn't hold together (a forged
 * link, or a data rebuild that dropped a credit), so the caller can fall back to grades.
 */
async function friendSteps(start: Person, c: Challenge, path: [Qid, Qid][]): Promise<ChainStep[] | null> {
  const people = await Promise.all(path.map(([, id]) => getPerson(id)));
  const steps: ChainStep[] = [];
  for (let i = 0; i < path.length; i++) {
    const filmId = path[i][0];
    const prev = i === 0 ? start : people[i - 1];
    const person = people[i];
    const film = prev.films.find((f) => f.id === filmId);
    if (!film || !person.films.some((f) => f.id === filmId)) return null;
    steps.push({ film: { id: film.id, title: film.title, year: film.year }, person: { id: person.id, name: person.name }, grade: c.moves[i].grade, hinted: c.moves[i].hinted });
  }
  return steps;
}

/* ------------------------------------------------------------ sending a challenge */

/** The link to this puzzle with your result attached, or null if the game is too long to pack. */
function challengeUrl(ctx: ResultContext, name: string): string | null {
  const vs = encodeChallenge({
    start: ctx.start.id,
    target: targetOf(ctx.goal),
    mode: rules(ctx.mode),
    moves: summaries(ctx.moves),
    gaveUp: ctx.gaveUp,
    path: ctx.moves.map((m) => [m.film.id, m.person.id]),
    name: name || null,
  });
  if (!vs) return null;
  // puzzleUrl is the day's preview page in production (so the link unfurls in chats; it
  // forwards ?vs= into the game) and a hash route otherwise; either way ?vs= goes last.
  return `${puzzleUrl({ day: ctx.day, start: ctx.start.id, mode: ctx.mode, target: targetOf(ctx.goal) })}?vs=${encodeURIComponent(vs)}`;
}

let formCount = 0;

function sendForm(ctx: ResultContext, intro: string | null): HTMLElement {
  const id = `vs-name-${++formCount}`;
  const status = h('p', { class: 'vs-status', role: 'status' });
  const input = h('input', {
    id,
    type: 'text',
    class: 'vs-name',
    maxlength: String(MAX_NAME_LENGTH),
    autocomplete: 'nickname',
    spellcheck: 'false',
    placeholder: 'So they know who to beat',
    value: cleanName(loadPlayerName()),
    onchange: () => savePlayerName(cleanName(input.value)),
  });
  const label = 'Challenge a friend';
  const btn = h('button', { class: 'btn primary', type: 'button' }, label);
  const fallback = h('div', { class: 'vs-fallback' });

  btn.addEventListener('click', async () => {
    const name = cleanName(input.value);
    input.value = name;
    savePlayerName(name);
    const url = challengeUrl(ctx, name);
    fallback.replaceChildren();
    if (!url) {
      status.textContent = 'That game is too long to fit in a link. Try a shorter one!';
      return;
    }
    const text = `Can you beat me?\n${shareText({ daily: ctx.day ? dayNumber(ctx.day) : null, mode: ctx.mode, start: ctx.start.name, goal: ctx.goal, moves: summaries(ctx.moves), par: ctx.par, gaveUp: ctx.gaveUp, url })}`;
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ text });
        status.textContent = '';
        return;
      }
      await navigator.clipboard.writeText(text);
      btn.textContent = 'Copied!';
      status.textContent = 'Challenge copied. Paste it to a friend.';
      setTimeout(() => (btn.textContent = label), 2000);
    } catch (err) {
      // Closing the share sheet isn't a failure.
      if (err instanceof DOMException && err.name === 'AbortError') return;
      status.textContent = 'Couldn’t copy automatically. Copy this link instead:';
      const field = h('input', { type: 'text', class: 'vs-name', readonly: true, value: url, 'aria-label': 'Challenge link', onfocus: () => field.select() });
      fallback.replaceChildren(field);
      field.focus();
    }
  });

  return h(
    'div',
    { class: 'vs-form' },
    intro && h('p', { class: 'muted' }, intro),
    h('label', { class: 'label', for: id }, 'Your name ', h('span', { class: 'vs-optional' }, '(optional)')),
    h('div', { class: 'vs-form-row' }, input, btn),
    status,
    fallback,
  );
}
