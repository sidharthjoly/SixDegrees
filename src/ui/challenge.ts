import type { Game } from './play';
import type { ResultContext } from './result';

/**
 * "Beat my score" links (?vs=<code>). Placeholders until the challenge feature lands.
 */

/** Shown on the play screen above the setlist when the game came from a friend's link. */
export function challengeBanner(_game: Game): HTMLElement | null {
  return null;
}

/** Shown on the result screen: the side-by-side comparison, and a way to challenge a friend. */
export function challengePanel(_ctx: ResultContext): HTMLElement | null {
  return null;
}
