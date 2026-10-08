import { onLeave } from './shell';

/**
 * The home page reacting to the player, kept deliberately small:
 * - the how-to countdown and the chart appear as they scroll into view;
 * - with a mouse, the hard shadows lean away from the cursor (it's the light), the dot
 *   grid bulges under it as if something were pressing up behind the page, and the daily
 *   sticker (a link) tilts towards it.
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
  const sticker = home.querySelector<HTMLElement>('.sticker-link');
  const field = dotField();

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
    field.press(e.clientX, e.clientY);
    tilt(e.clientX, e.clientY);
    if (!frame) frame = requestAnimationFrame(step);
  };
  const onOut = (e: MouseEvent) => {
    if (e.relatedTarget) return;
    field.release();
    sticker?.style.setProperty('--rx', '0deg');
    sticker?.style.setProperty('--ry', '0deg');
  };

  window.addEventListener('pointermove', onMove, { passive: true });
  document.addEventListener('mouseout', onOut);
  onLeave(() => {
    window.removeEventListener('pointermove', onMove);
    document.removeEventListener('mouseout', onOut);
    cancelAnimationFrame(frame);
    field.destroy();
  });
}

/** Must match the CSS dot grid in base.css: 28px tiles, 2px dots at each tile's centre. */
const GRID = 28;
const DOT_RADIUS = 2;
/** The bulge: how wide it reaches, how far it pushes dots, and how much it enlarges them. */
const BULGE_RADIUS = 150;
const MAX_PUSH_PX = 10;
const MAX_GROW = 0.6;
/** t·(1−t²)² peaks at t = 1/√5 with this value; dividing by it makes the peak push MAX_PUSH_PX. */
const PUSH_PEAK = (1 / Math.sqrt(5)) * (1 - 1 / 5) ** 2;

/**
 * The page's dot grid redrawn on a canvas, so it can bend: dots near the cursor are pushed
 * outward and grow, like a lens or something pressing up from behind. The push is zero at
 * the centre, strongest a little way out and fades to nothing at the edge, so the grid
 * stays continuous. The bulge trails the cursor slightly and eases flat when it leaves.
 * It only redraws while something is moving or the page scrolls.
 */
function dotField() {
  const canvas = document.createElement('canvas');
  canvas.className = 'dot-field';
  canvas.setAttribute('aria-hidden', 'true');
  const ctx = canvas.getContext('2d');
  if (!ctx) return { press() {}, release() {}, destroy() {} };
  document.body.prepend(canvas);
  // The canvas takes over from the CSS dots while it's here.
  document.documentElement.classList.add('dot-canvas');

  let width = 0;
  let height = 0;
  let color = '';
  const bulge = { x: -1e4, y: -1e4, strength: 0 };
  const goal = { x: -1e4, y: -1e4, strength: 0 };
  let frame = 0;

  const readColor = () => {
    color = getComputedStyle(document.documentElement).getPropertyValue('--bg-dot').trim() || '#a29cf7';
  };

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = innerWidth;
    height = innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  };

  const draw = () => {
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = color;
    ctx.beginPath();
    // Dots sit at document positions (scroll with the page), so offset by the scroll.
    const offsetY = -(scrollY % GRID);
    const active = bulge.strength > 0.001;
    for (let y = GRID / 2 + offsetY - GRID; y < height + GRID; y += GRID) {
      for (let x = GRID / 2; x < width + GRID; x += GRID) {
        let px = x;
        let py = y;
        let r = DOT_RADIUS;
        if (active) {
          const dx = x - bulge.x;
          const dy = y - bulge.y;
          const d = Math.hypot(dx, dy);
          if (d < BULGE_RADIUS && d > 0.01) {
            const t = d / BULGE_RADIUS;
            const push = ((t * (1 - t * t) ** 2) / PUSH_PEAK) * MAX_PUSH_PX * bulge.strength;
            px += (dx / d) * push;
            py += (dy / d) * push;
            r *= 1 + MAX_GROW * (1 - t) ** 2 * bulge.strength;
          }
        }
        ctx.moveTo(px + r, py);
        ctx.arc(px, py, r, 0, Math.PI * 2);
      }
    }
    ctx.fill();
  };

  const tick = () => {
    frame = 0;
    // A first press starts the bulge where the cursor is, rather than sliding in from afar.
    if (bulge.strength < 0.001) {
      bulge.x = goal.x;
      bulge.y = goal.y;
    }
    bulge.x += (goal.x - bulge.x) * 0.2;
    bulge.y += (goal.y - bulge.y) * 0.2;
    bulge.strength += (goal.strength - bulge.strength) * 0.12;
    draw();
    const settled = Math.abs(goal.x - bulge.x) < 0.3 && Math.abs(goal.y - bulge.y) < 0.3 && Math.abs(goal.strength - bulge.strength) < 0.002;
    if (!settled) frame = requestAnimationFrame(tick);
    else if (goal.strength === 0) bulge.strength = 0;
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(tick);
  };

  const onScroll = () => {
    if (!frame) draw();
  };
  const scheme = matchMedia('(prefers-color-scheme: dark)');
  const onScheme = () => {
    readColor();
    draw();
  };

  readColor();
  resize();
  window.addEventListener('resize', resize);
  window.addEventListener('scroll', onScroll, { passive: true });
  scheme.addEventListener('change', onScheme);

  return {
    press(x: number, y: number) {
      goal.x = x;
      goal.y = y;
      goal.strength = 1;
      schedule();
    },
    release() {
      goal.strength = 0;
      schedule();
    },
    destroy() {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
      window.removeEventListener('scroll', onScroll);
      scheme.removeEventListener('change', onScheme);
      document.documentElement.classList.remove('dot-canvas');
      canvas.remove();
    },
  };
}
