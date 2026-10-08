import { onLeave } from './shell';

/**
 * The home page reacting to the player, kept deliberately small:
 * - the how-to countdown and the chart appear as they scroll into view;
 * - with a mouse, the hard shadows lean away from the cursor (it's the light), the dot
 *   grid swells slightly under it, and the daily sticker (a link) tilts towards it.
 * Nothing runs under prefers-reduced-motion, and everything is torn down on leaving.
 */
export function startHomeFx(home: HTMLElement): void {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  home.classList.add('fx');
  revealOnScroll(home);
  if (matchMedia('(pointer: fine)').matches) followPointer(home);
}

function revealOnScroll(home: HTMLElement): void {
  const targets = home.querySelectorAll<HTMLElement>('.howto, .chart');
  if (!('IntersectionObserver' in window)) {
    targets.forEach((t) => t.classList.add('in-view'));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('in-view');
        io.unobserve(e.target);
      }
    },
    { threshold: 0.3 },
  );
  targets.forEach((t) => io.observe(t));
  onLeave(() => io.disconnect());
}

/** How far the sticker tilts towards the cursor, and from how far away it notices. */
const MAX_TILT_DEG = 7;
const TILT_RANGE_PX = 360;

function followPointer(home: HTMLElement): void {
  home.classList.add('fx-light');
  const glow = document.createElement('div');
  glow.className = 'dot-glow';
  glow.setAttribute('aria-hidden', 'true');
  document.body.prepend(glow);
  const sticker = home.querySelector<HTMLElement>('.sticker-link');

  // The light position eases towards the cursor rather than snapping, so shadows glide.
  let target = { x: 0, y: 0 };
  let light = { x: 0, y: 0 };
  let frame = 0;

  const step = () => {
    frame = 0;
    light = { x: light.x + (target.x - light.x) * 0.18, y: light.y + (target.y - light.y) * 0.18 };
    home.style.setProperty('--lx', light.x.toFixed(3));
    home.style.setProperty('--ly', light.y.toFixed(3));
    if (Math.abs(target.x - light.x) > 0.002 || Math.abs(target.y - light.y) > 0.002) frame = requestAnimationFrame(step);
  };

  const tilt = (cx: number, cy: number) => {
    if (!sticker) return;
    const r = sticker.getBoundingClientRect();
    const dx = cx - (r.left + r.width / 2);
    const dy = cy - (r.top + r.height / 2);
    const near = Math.hypot(dx, dy) < TILT_RANGE_PX;
    const clamp = (v: number) => Math.max(-MAX_TILT_DEG, Math.min(MAX_TILT_DEG, v));
    sticker.style.setProperty('--ry', `${near ? clamp((dx / r.width) * MAX_TILT_DEG) : 0}deg`);
    sticker.style.setProperty('--rx', `${near ? clamp((-dy / r.height) * MAX_TILT_DEG) : 0}deg`);
  };

  const onMove = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    target = { x: (e.clientX / innerWidth) * 2 - 1, y: (e.clientY / innerHeight) * 2 - 1 };
    glow.style.setProperty('--mx', `${e.clientX}px`);
    glow.style.setProperty('--my', `${e.clientY}px`);
    glow.classList.add('on');
    tilt(e.clientX, e.clientY);
    if (!frame) frame = requestAnimationFrame(step);
  };
  const onOut = (e: MouseEvent) => {
    if (e.relatedTarget) return;
    glow.classList.remove('on');
    sticker?.style.setProperty('--rx', '0deg');
    sticker?.style.setProperty('--ry', '0deg');
  };
  // The overlay is fixed while the page's dots scroll, so shift its tile to keep them aligned.
  const onScroll = () => glow.style.setProperty('--sy', `${-scrollY}px`);
  onScroll();

  window.addEventListener('pointermove', onMove, { passive: true });
  document.addEventListener('mouseout', onOut);
  window.addEventListener('scroll', onScroll, { passive: true });
  onLeave(() => {
    window.removeEventListener('pointermove', onMove);
    document.removeEventListener('mouseout', onOut);
    window.removeEventListener('scroll', onScroll);
    cancelAnimationFrame(frame);
    glow.remove();
  });
}
