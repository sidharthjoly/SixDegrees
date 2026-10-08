import type { Grade, MoveSummary } from '../logic';
import { h } from './dom';

const SYMBOL: Record<Grade, string> = { closer: '▲', same: '●', further: '▼' };
const WORD: Record<Grade, string> = { closer: 'closer', same: 'no closer', further: 'further' };

/** "closer, no closer (hint), closer": the row read out, for screen readers and link labels. */
export function describeMoves(moves: MoveSummary[]): string {
  return moves.map((m) => WORD[m.grade] + (m.hinted ? ' (hint)' : '')).join(', ');
}

/**
 * A game's grades as a row of coloured squares, like the share's emoji row, but each square
 * carries its chart symbol (▲ ● ▼) so the grade never depends on colour. Hinted moves get a
 * 💡 badge. `hidden` leaves the row out of the accessibility tree, for use inside a link
 * that already says what it shows.
 */
export function gradeSquares(moves: MoveSummary[], opts: { small?: boolean; hidden?: boolean } = {}): HTMLElement {
  const squares = moves.map((m) => h('span', { class: `sq ${m.grade}` + (m.hinted ? ' hinted' : '') }, SYMBOL[m.grade]));
  const label = moves.length ? `${moves.length === 1 ? 'Move' : 'Moves'}: ${describeMoves(moves)}` : 'No moves';
  return h(
    'span',
    { class: 'squares' + (opts.small ? ' small' : ''), ...(opts.hidden ? { 'aria-hidden': 'true' } : { role: 'img', 'aria-label': label }) },
    ...squares,
  );
}
