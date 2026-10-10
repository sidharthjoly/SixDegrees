/*
 * Teardown for whatever the current screen attached outside #app (listeners, overlays), run on
 * the next navigation (shell.ts). On its own, without the page, so any module can use it.
 */

let leaving: (() => void)[] = [];

/** Run `cleanup` when the player navigates away from the current screen. */
export function onLeave(cleanup: () => void): void {
  leaving.push(cleanup);
}

/** Run every cleanup registered for the screen being left. */
export function leaveScreen(): void {
  const done = leaving;
  leaving = [];
  for (const fn of done) fn();
}
