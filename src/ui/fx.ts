import { h } from './dom';

/**
 * Motion effects. Everything here does nothing under prefers-reduced-motion. Particles
 * live in a fixed, click-through overlay on <body>: cards clip their contents
 * (overflow: hidden), and a fixed layer can't add scrollbars or shift the layout.
 */

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// The Y2K accents; each reads against both the light and the dark background.
const STAR_COLOURS = ['var(--lime)', 'var(--pink)', 'var(--same)'];
const STARS = 28;
/** Stop waiting for a card nobody scrolls to. */
const GIVE_UP_MS = 60_000;

/**
 * Celebrate reaching JT with a burst of stars around `target` (the #1 card on the result
 * screen). On a phone that card is often below the fold, so the burst waits until it's seen.
 */
export function celebrate(target: HTMLElement): void {
  if (reducedMotion() || typeof target.animate !== 'function') return;
  whenSeen(target, () => burst(target));
}

function whenSeen(el: HTMLElement, run: () => void): void {
  if (typeof IntersectionObserver === 'undefined') return run();
  // A tall fallback target (the whole screen) may never be 60% visible; any of it will do.
  const tall = el.getBoundingClientRect().height > window.innerHeight / 2;
  let timer = 0;
  const io = new IntersectionObserver(
    (entries) => {
      if (!el.isConnected) return stop();
      if (entries.some((e) => e.isIntersecting)) {
        stop();
        run();
      }
    },
    { threshold: tall ? 0 : 0.6 },
  );
  function stop(): void {
    io.disconnect();
    clearTimeout(timer);
  }
  io.observe(el);
  timer = window.setTimeout(stop, GIVE_UP_MS);
}

/** A point `t` (0–1) of the way round a rectangle's edge, clockwise from the top left. */
function edgePoint(r: DOMRect, t: number): [number, number] {
  const perimeter = 2 * (r.width + r.height);
  let d = t * perimeter;
  if (d < r.width) return [r.left + d, r.top];
  d -= r.width;
  if (d < r.height) return [r.right, r.top + d];
  d -= r.height;
  if (d < r.width) return [r.right - d, r.bottom];
  return [r.left, r.bottom - (d - r.width)];
}

function burst(target: HTMLElement): void {
  // Only the part of the target that's on screen: the fallback target can be the whole page.
  const box = target.getBoundingClientRect();
  const top = Math.max(box.top, 0);
  const bottom = Math.min(box.bottom, window.innerHeight);
  if (bottom <= top) return;
  const r = new DOMRect(box.left, top, box.width, bottom - top);
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;

  const layer = h('div', { class: 'fx-layer', 'aria-hidden': 'true' });
  document.body.append(layer);
  const animations: Animation[] = [];
  for (let i = 0; i < STARS; i++) {
    const [x, y] = edgePoint(r, (i + Math.random() * 0.5) / STARS);
    // Fly outwards from the card's middle, a little further for the small stars.
    const dx = x - cx;
    const dy = y - cy;
    const len = Math.hypot(dx, dy) || 1;
    const dist = 40 + Math.random() * 70;
    const tx = (dx / len) * dist;
    const ty = (dy / len) * dist;
    const spin = (Math.random() < 0.5 ? -1 : 1) * (90 + Math.random() * 180);
    const star = h('span', { class: 'fx-star', style: `left:${x}px;top:${y}px;color:${STAR_COLOURS[i % STAR_COLOURS.length]};font-size:${14 + Math.round(Math.random() * 16)}px` }, '★');
    layer.append(star);
    animations.push(
      star.animate(
        [
          { transform: 'translate(-50%, -50%) scale(0.2)', opacity: 1 },
          { transform: `translate(-50%, -50%) translate(${tx * 0.8}px, ${ty * 0.8}px) rotate(${spin * 0.7}deg) scale(1)`, opacity: 1, offset: 0.55 },
          // A touch of gravity on the way out.
          { transform: `translate(-50%, -50%) translate(${tx}px, ${ty + 24}px) rotate(${spin}deg) scale(0.5)`, opacity: 0 },
        ],
        { duration: 900 + Math.random() * 400, delay: Math.random() * 150, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)', fill: 'both' },
      ),
    );
  }
  if (target.matches('.track')) {
    target.animate([{ transform: 'none' }, { transform: 'scale(1.035) rotate(-0.6deg)' }, { transform: 'none' }], { duration: 450, easing: 'ease-out' });
  }
  const cleanUp = () => layer.remove();
  void Promise.allSettled(animations.map((a) => a.finished)).then(cleanUp);
  // Hidden tabs can hold animations back; don't leave the layer lying around regardless.
  window.setTimeout(cleanUp, 4000);
}
