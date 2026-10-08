import type { Grade } from '../logic';

/**
 * Small haptic taps on phones, for the moments that matter in a game: picking someone, how
 * the move graded, and landing on JT.
 *
 * - Android browsers have navigator.vibrate, which plays patterns once the page has had a
 *   tap. They get a pattern per grade and none for the pick itself, which would double up.
 * - iPhone Safari has no vibrate. Flipping a native switch control (<input type=checkbox
 *   switch>, iOS 18+) plays the system's selection tick, but it's only reliable while
 *   handling a tap. So iPhones get a tick when you pick, and a try at one on landing on JT;
 *   that and the grades come after the next person loads, outside the tap. Grades stay
 *   silent there rather than ticking at random.
 * Desktops get nothing.
 */
export type Haptic = 'pick' | Grade | 'win';

const PATTERNS: Partial<Record<Haptic, number | number[]>> = {
  closer: [12, 70, 12],
  same: 16,
  further: 45,
  win: [20, 60, 20, 60, 70],
};

const IOS_TICKS = new Set<Haptic>(['pick', 'win']);

const touch = () => matchMedia('(pointer: coarse)').matches;
/** iPadOS reports itself as a Mac, so check for touch points too. */
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

export function feel(kind: Haptic): void {
  if (!touch()) return;
  try {
    if (typeof navigator.vibrate === 'function' && !isIOS()) {
      const pattern = PATTERNS[kind];
      if (pattern !== undefined) navigator.vibrate(pattern);
    } else if (isIOS() && IOS_TICKS.has(kind)) {
      iosTick();
    }
  } catch {
    // Haptics are a nicety; never let them break a move.
  }
}

function iosTick(): void {
  const label = document.createElement('label');
  label.setAttribute('aria-hidden', 'true');
  label.style.display = 'none';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('switch', '');
  input.tabIndex = -1;
  label.append(input);
  document.body.append(label);
  label.click();
  label.remove();
}
