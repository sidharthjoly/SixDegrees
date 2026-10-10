import { decodeChallenge } from './challenge-code';
import { plural } from './logic';
import type { Mode } from './types';

/*
 * The link-preview title for a "beat my score" link, e.g. "Sid got to JT in 3 films. Can you
 * beat that?". The Cloudflare Worker in worker/ writes it into a daily's preview page when the
 * link carries ?vs=, so the chat unfurl shows the sender's score rather than just the day.
 * Pure, so it runs in the Worker and tests alike.
 */

/** A daily's preview page, d/<date>/, d/<date>/hard/ or d/<date>/star/ (see preview-pages.ts); group 1 is "hard" or "star". */
export const DAILY_PAGE_RE = /^\/d\/\d{4}-\d{2}-\d{2}\/(?:(hard|star)\/)?$/;

/**
 * The title for a challenge code on a page in `pageMode`, or null if the code isn't usable
 * there. A star daily's page names its `star`, and only takes codes heading for them.
 */
export function challengeTitle(code: string, pageMode: Mode, star?: { id: number; name: string }): string | null {
  const c = decodeChallenge(code);
  if (!c) return null;
  // A code for another mode, or another star (free play's, or another day's), would describe
  // a different puzzle; the game says so too.
  const fits = pageMode === 'star' ? !!star && c.target === star.id && c.mode === 'normal' : c.mode === pageMode && c.target === undefined;
  if (!fits) return null;
  const who = c.name ?? 'Your friend';
  const goal = pageMode === 'star' ? star!.name : 'JT';
  const hard = c.mode === 'hard' ? ' in hard mode' : '';
  if (c.gaveUp) {
    const after = c.moves.length === 0 ? ' straight away' : ` after ${plural(c.moves.length, 'film')}`;
    return `${who} gave up${after}${hard}. Can you get to ${goal}?`;
  }
  const hints = c.moves.filter((m) => m.hinted).length;
  return `${who} got to ${goal} in ${plural(c.moves.length, 'film')}${hints ? ` with ${plural(hints, 'hint')}` : ''}${hard}. Can you beat that?`;
}
