import { onLeave } from './shell';

/**
 * The home page reacting to the player, kept deliberately small:
 * - the how-to countdown and the chart appear as they scroll into view;
 * - with a mouse, the hard shadows lean away from the cursor (it's the light), the dot
 *   grid bulges under it as if something were pressing up behind the page, and the daily
 *   sticker (a link) tilts towards it. In Bollywood mode the dots under it switch on too,
 *   like fairy lights. The card leading to the other world does the same inside it, as
 *   that world's page would: lights on JT's page, a plain bulge on Bollywood's.
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
  const card = home.querySelector<HTMLElement>('.world-card');
  const cardField = card && dotField(card);

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
    if (card && cardField) {
      // Only while the cursor is over the card, in its own coordinates (inside its border).
      const r = card.getBoundingClientRect();
      const x = e.clientX - r.left - card.clientLeft;
      const y = e.clientY - r.top - card.clientTop;
      if (x >= 0 && y >= 0 && x <= card.clientWidth && y <= card.clientHeight) cardField.press(x, y);
      else cardField.release();
    }
    tilt(e.clientX, e.clientY);
    if (!frame) frame = requestAnimationFrame(step);
  };
  const onOut = (e: MouseEvent) => {
    if (e.relatedTarget) return;
    field.release();
    cardField?.release();
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
    cardField?.destroy();
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
 * The lights: how much of the way a dot switches on in a frame, and off. On is nearly at
 * once; off takes about half a second, like a filament cooling.
 */
const ON_STEP = 0.34;
const OFF_STEP = 0.03;
/** Room for a row's columns in a dot's key: far wider than any screen. */
const ROW_KEY = 4096;

type Rgb = [number, number, number];

function parseHex(color: string): Rgb | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color.trim());
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
}

/** Each dot's own reach, a little in or out of the bulge's, so the lit patch isn't a perfect circle. */
function reachOf(key: number): number {
  let h = Math.imul(key ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return BULGE_RADIUS * (0.9 + (((h ^ (h >>> 16)) >>> 0) / 4294967296) * 0.12);
}

/**
 * The page's dot grid redrawn on a canvas, so it can bend: dots near the cursor are pushed
 * outward and grow, like a lens or something pressing up from behind. The push is zero at
 * the centre, strongest a little way out and fades to nothing at the edge, so the grid
 * stays continuous. The bulge trails the cursor slightly and eases flat when it leaves.
 *
 * Where the theme gives the dots a lit colour (Bollywood mode's --dot-on-1 to 3, warm
 * yellows), the cursor also switches on the dots within the bulge's reach: each is off or on,
 * nothing glows past it, and once the cursor moves on it switches off again, slowly.
 * It only redraws while something is moving or the page scrolls.
 *
 * Given a `card`, it draws that card's own dot grid instead, in the card's colours, behind
 * its content; positions are then the card's, inside its border.
 */
function dotField(card?: HTMLElement) {
  const canvas = document.createElement('canvas');
  canvas.className = card ? 'dot-field-card' : 'dot-field';
  canvas.setAttribute('aria-hidden', 'true');
  const ctx = canvas.getContext('2d');
  if (!ctx) return { press() {}, release() {}, destroy() {} };
  if (card) card.prepend(canvas);
  else document.body.prepend(canvas);
  // The canvas takes over from the CSS dots while it's here.
  const owner = card ?? document.documentElement;
  owner.classList.add('dot-canvas');
  // A card's dots move with it, so only the page's scroll.
  const scrolled = () => (card ? 0 : scrollY);

  let width = 0;
  let height = 0;
  let color = '';
  /** The dots' colour off, and their lit colours, or null without lights. */
  let lights: { off: Rgb; on: Rgb[] } | null = null;
  /** How far each lit dot is switched on (0 to 1), by its place in the page's grid (see keyAt). */
  const lit = new Map<number, number>();
  const bulge = { x: -1e4, y: -1e4, strength: 0 };
  const goal = { x: -1e4, y: -1e4, strength: 0 };
  let frame = 0;

  const readColor = () => {
    const css = getComputedStyle(owner);
    color = css.getPropertyValue('--bg-dot').trim() || '#a29cf7';
    const off = parseHex(color);
    const on = ['--dot-on-1', '--dot-on-2', '--dot-on-3'].map((name) => parseHex(css.getPropertyValue(name)));
    lights = off && on.every((c) => c) ? { off, on: on as Rgb[] } : null;
    if (!lights) lit.clear();
  };

  /** A dot's place in the page's grid: rows count from the top of the page, so they scroll with it. */
  const keyAt = (row: number, col: number) => row * ROW_KEY + col;
  const litColor = (key: number, on: number) => {
    const { off, on: tones } = lights!;
    const tone = tones[key % tones.length];
    const mix = (i: number) => Math.round(off[i] + (tone[i] - off[i]) * on);
    return `rgb(${mix(0)},${mix(1)},${mix(2)})`;
  };

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = card ? card.clientWidth : innerWidth;
    height = card ? card.clientHeight : innerHeight;
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
    const scrollY = scrolled();
    const offsetY = -(scrollY % GRID);
    const active = bulge.strength > 0.001;
    const on: [number, number, number, string][] = [];
    for (let y = GRID / 2 + offsetY - GRID; y < height + GRID; y += GRID) {
      const row = Math.round((y + scrollY - GRID / 2) / GRID);
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
        const key = keyAt(row, Math.round((x - GRID / 2) / GRID));
        const energy = lit.get(key);
        if (energy) {
          on.push([px, py, r, litColor(key, energy)]);
          continue;
        }
        ctx.moveTo(px + r, py);
        ctx.arc(px, py, r, 0, Math.PI * 2);
      }
    }
    ctx.fill();
    for (const [px, py, r, fill] of on) {
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  /** Switch the dots within reach of the cursor on, and the rest off; true while any are still changing. */
  const switchLights = () => {
    if (!lights) return false;
    const near = new Set<number>();
    const scrollY = scrolled();
    if (goal.strength > 0) {
      const top = Math.max(0, Math.floor((goal.y + scrollY - BULGE_RADIUS * 1.05) / GRID));
      const bottom = Math.ceil((goal.y + scrollY + BULGE_RADIUS * 1.05) / GRID);
      const left = Math.max(0, Math.floor((goal.x - BULGE_RADIUS * 1.05) / GRID));
      const right = Math.ceil((goal.x + BULGE_RADIUS * 1.05) / GRID);
      for (let row = top; row <= bottom; row++) {
        for (let col = left; col <= right; col++) {
          const key = keyAt(row, col);
          const d = Math.hypot(col * GRID + GRID / 2 - goal.x, row * GRID + GRID / 2 - scrollY - goal.y);
          if (d < reachOf(key)) near.add(key);
        }
      }
    }
    let changing = false;
    for (const key of near) {
      const energy = lit.get(key) ?? 0;
      if (energy < 1) {
        lit.set(key, Math.min(1, energy + ON_STEP));
        changing = true;
      }
    }
    for (const [key, energy] of lit) {
      if (near.has(key)) continue;
      changing = true;
      if (energy <= OFF_STEP) lit.delete(key);
      else lit.set(key, energy - OFF_STEP);
    }
    return changing;
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
    const changing = switchLights();
    draw();
    const settled = Math.abs(goal.x - bulge.x) < 0.3 && Math.abs(goal.y - bulge.y) < 0.3 && Math.abs(goal.strength - bulge.strength) < 0.002;
    if (!settled || changing) frame = requestAnimationFrame(tick);
    else if (goal.strength === 0) bulge.strength = 0;
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(tick);
  };

  const onScroll = () => {
    // Scrolling moves other dots under the cursor, so the lights have to be switched again.
    if (lights && (goal.strength > 0 || lit.size > 0)) schedule();
    else if (!frame) draw();
  };
  const scheme = matchMedia('(prefers-color-scheme: dark)');
  const onScheme = () => {
    readColor();
    draw();
  };

  readColor();
  resize();
  const sized = card && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
  if (sized) sized.observe(card!);
  else window.addEventListener('resize', resize);
  if (!card) window.addEventListener('scroll', onScroll, { passive: true });
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
      sized?.disconnect();
      window.removeEventListener('resize', resize);
      window.removeEventListener('scroll', onScroll);
      scheme.removeEventListener('change', onScheme);
      owner.classList.remove('dot-canvas');
      canvas.remove();
    },
  };
}
