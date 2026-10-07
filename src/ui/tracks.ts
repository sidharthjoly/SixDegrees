import { JT, type Grade } from '../logic';
import type { FilmRef, PersonRef } from '../types';
import { h, yearOf } from './dom';

export interface ChainStep {
  film: FilmRef;
  person: PersonRef;
  grade?: Grade;
  hinted?: boolean;
  revealed?: boolean;
}

// Chart-movement symbols, so a grade never relies on colour alone.
export const GRADE_LABEL: Record<Grade, string> = { closer: '▲ closer', same: '● no closer', further: '▼ further' };

/**
 * A path as a stack of chart entries. In play they're numbered in order (01, 02…) with a
 * dashed slot for the next film; on the result they count down to #1, the film with JT.
 */
export function tracks(start: PersonRef, steps: ChainStep[], opts: { pending?: boolean; countdown?: boolean } = {}): HTMLElement {
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

export const isJT = (p: PersonRef) => p.id === JT;
