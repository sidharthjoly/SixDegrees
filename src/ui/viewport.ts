import { onLeave } from './shell';

/** A phone: touch on a narrow screen. Must match the dock's media query in play.css. */
export const PHONE_QUERY = '(pointer: coarse) and (max-width: 640px)';
export const isPhone = () => matchMedia(PHONE_QUERY).matches;

/** Below this, a shrunken visual viewport is browser chrome moving, not a keyboard. */
const KEYBOARD_MIN_PX = 150;

/**
 * Keeps two CSS variables current while the screen is up, so the play screen's dock can
 * ride on top of the on-screen keyboard:
 *   --kb   how much of the layout viewport's bottom is out of sight below the visible area;
 *   --vvh  the height that's actually visible.
 * Neither iOS Safari nor Chrome shrinks the layout viewport for the keyboard. Safari usually
 * pans the visible area to the layout viewport's foot, where a sticky dock already is (--kb
 * is 0), but scrolling with the keyboard up moves it off; then --kb lifts the dock back into
 * view. Also sets html.kb-open while the keyboard is up.
 */
export function trackKeyboard(): void {
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement;
  const update = () => {
    // Pinch zoom also shrinks the visual viewport; leave the dock alone then.
    const zoomed = Math.abs(vv.scale - 1) > 0.01;
    // clientHeight is the layout viewport; iOS's innerHeight shrinks with the keyboard.
    const layout = root.clientHeight;
    const open = !zoomed && layout - vv.height >= KEYBOARD_MIN_PX;
    const below = open ? Math.max(0, Math.round(layout - vv.offsetTop - vv.height)) : 0;
    root.style.setProperty('--kb', `${below}px`);
    root.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
    root.classList.toggle('kb-open', open);
  };
  update();
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  onLeave(() => {
    vv.removeEventListener('resize', update);
    vv.removeEventListener('scroll', update);
    root.style.removeProperty('--kb');
    root.style.removeProperty('--vvh');
    root.classList.remove('kb-open');
  });
}

/**
 * Run `fn` once the on-screen keyboard has gone, or straight away if it isn't up. Scrolling
 * while iOS is still animating the keyboard away gets undone when it restores the page.
 */
export function afterKeyboard(fn: () => void): void {
  const vv = window.visualViewport;
  if (!vv || !document.documentElement.classList.contains('kb-open')) {
    fn();
    return;
  }
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    vv.removeEventListener('resize', check);
    clearTimeout(timer);
    // Let the last resize settle before measuring.
    requestAnimationFrame(fn);
  };
  const check = () => {
    if (!document.documentElement.classList.contains('kb-open')) run();
  };
  // The keyboard can stay up (a hardware keyboard, or focus kept in a field): don't wait forever.
  const timer = setTimeout(run, 700);
  vv.addEventListener('resize', check);
}
