/*
 * Share cards, drawn with the Canvas 2D API: the result images offered on the result screen
 * (square, and a 9:16 story that also animates into the share video), and the link-preview
 * image the build draws for each daily (scripts/previews.ts).
 *
 * The same code runs in the browser and in Node (@napi-rs/canvas), so this file keeps to two
 * rules. It has only type imports, because Node loads it by stripping types and can't resolve
 * extensionless imports. And it draws every symbol (▲ ● ▼, the hint bulb, stars, the arrow)
 * as a path: neither webfont has all of those glyphs, and a fallback font would differ
 * between a phone and the CI runner.
 */
import type { Grade } from './logic';

/** The parts of CanvasRenderingContext2D the cards use. The browser's context and @napi-rs/canvas's both fit. */
export interface Ctx {
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  lineJoin: unknown;
  font: string;
  textAlign: unknown;
  textBaseline: unknown;
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  scale(x: number, y: number): void;
  globalAlpha: number;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number): void;
  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void;
  fill(): void;
  stroke(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  strokeText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
  setLineDash(segments: number[]): void;
}

// Fixed colours, not the page's CSS variables: an image looks the same in light and dark mode.
const INK = '#111111';
const BG = '#b9b4ff';
const DOT = '#a29cf7';
const WHITE = '#ffffff';
const MUTED = '#55516e';
const LIME = '#c6ff3d';
const PINK = '#ff3d9a';
const SOFT = '#fff7a8';
export const GRADE_COLOR: Record<Grade, string> = { closer: '#21c55d', same: '#ffd84d', further: '#ff7a59' };
const GRADE_WORD: Record<Grade, string> = { closer: 'Closer', same: 'No closer', further: 'Further' };

/** Rubik Mono One is for headings, labels and numbers; Chakra Petch for names and titles. */
const display = (size: number) => `400 ${size}px "Rubik Mono One", ui-monospace, monospace`;
const text = (weight: 500 | 600 | 700, size: number) => `${weight} ${size}px "Chakra Petch", ui-sans-serif, system-ui, sans-serif`;

/** Every font the cards use, for document.fonts.load() before drawing in the browser. */
export const CARD_FONTS = [display(40), text(500, 40), text(600, 40), text(700, 40)];

// ------------------------------------------------------------------ text fitting (pure)

/** Width of `text` at font size `size`. Injected so the fitting logic can be tested without a canvas. */
export type Measure = (text: string, size: number) => number;

export interface Fit {
  size: number;
  lines: string[];
}

export interface FitOptions {
  maxWidth: number;
  maxLines: number;
  /** Largest and smallest font size to try. */
  max: number;
  min: number;
  /** Optional cap on lines × size × lineHeight. */
  maxHeight?: number;
  lineHeight?: number;
}

interface Token {
  word: string;
  /** Whether a space comes before it; false for the second half of a hyphenated name. */
  space: boolean;
}

/** Split on spaces, and after hyphens so "Esfandiari-Bakhtiari" can break across lines. */
function tokens(s: string): Token[] {
  return s
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((w, i) => w.split(/(?<=-)(?=.)/).map((part, j) => ({ word: part, space: i > 0 && j === 0 })));
}

/** Greedy word wrap. A single word wider than the line gets a line of its own (and overflows). */
export function wrap(s: string, size: number, maxWidth: number, measure: Measure): string[] {
  const lines: string[] = [];
  let line = '';
  for (const t of tokens(s)) {
    const next = line ? line + (t.space ? ' ' : '') + t.word : t.word;
    if (!line || measure(next, size) <= maxWidth) line = next;
    else {
      lines.push(line);
      line = t.word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Shorten `s` until it fits, ending in an ellipsis. */
export function ellipsize(s: string, size: number, maxWidth: number, measure: Measure): string {
  if (measure(s, size) <= maxWidth) return s;
  const chars = [...s];
  while (chars.length > 1 && measure(chars.join('').trimEnd() + '…', size) > maxWidth) chars.pop();
  return chars.join('').trimEnd() + '…';
}

/**
 * The largest size, stepping down 1px from `max`, at which `s` wraps into at most
 * `maxLines` lines that each fit. If nothing fits even at `min`, use `min` and cut the
 * last line short with an ellipsis rather than overflow the shape it sits in.
 */
export function fitText(s: string, measure: Measure, o: FitOptions): Fit {
  const lineHeight = o.lineHeight ?? 1.1;
  for (let size = Math.floor(o.max); size >= o.min; size--) {
    const lines = wrap(s, size, o.maxWidth, measure);
    const tallEnough = o.maxHeight === undefined || lines.length * size * lineHeight <= o.maxHeight;
    if (lines.length <= o.maxLines && tallEnough && lines.every((l) => measure(l, size) <= o.maxWidth)) return { size, lines };
  }
  const size = o.min;
  const all = wrap(s, size, o.maxWidth, measure);
  const kept = all.slice(0, o.maxLines);
  const lastIndex = kept.length - 1;
  const last = all.length > o.maxLines ? kept[lastIndex] + '…' : kept[lastIndex];
  kept[lastIndex] = last;
  return { size, lines: kept.map((l) => ellipsize(l, size, o.maxWidth, measure)) };
}

/** Square size and columns that fit `n` squares into a w × h box, as large as possible up to `max`. */
export function squareGrid(n: number, w: number, h: number, gap: number, max: number): { size: number; perRow: number; rows: number } {
  let best = { size: 0, perRow: Math.max(n, 1), rows: 1 };
  for (let perRow = 1; perRow <= Math.max(n, 1); perRow++) {
    const rows = Math.ceil(n / perRow);
    const size = Math.floor(Math.min(max, (w - (perRow - 1) * gap) / perRow, (h - (rows - 1) * gap) / rows));
    if (size > best.size) best = { size, perRow, rows };
  }
  return best;
}

// ------------------------------------------------------------------ inputs

export interface CardMove {
  grade: Grade;
  hinted: boolean;
}

/** One row of the countdown on the "Show my path" card. */
export interface CardStep {
  film: string;
  year: number | null;
  person: string;
  /** Missing for the revealed rest of the path after giving up. */
  grade?: Grade;
  hinted?: boolean;
  revealed?: boolean;
}

export interface ResultCard {
  /** "Daily #12" or "Free play". */
  label: string;
  hard: boolean;
  start: string;
  par: number;
  moves: CardMove[];
  gaveUp: boolean;
  /** Shown in the footer, e.g. "sixdegrees.sidharthjoly.com". */
  site: string;
  /** The countdown with film titles and co-stars. Leave it out for the spoiler-free card. */
  path?: CardStep[];
}

export interface PreviewCard {
  /** The three lines on the sticker, e.g. "Daily #12", the name, "8 Oct 2026". */
  tag: string;
  name: string;
  foot: string;
  /** Pills under the title, e.g. ["Daily #12", "Hard mode"]. The second is drawn dark. */
  pills: string[];
  blurb: string;
  site: string;
}

const films = (n: number) => `${n} ${n === 1 ? 'film' : 'films'}`;

/** "4 films · par 3", or "Gave up after 4 films · par 3". */
export function scoreLine(c: Pick<ResultCard, 'moves' | 'par' | 'gaveUp'>): string {
  return (c.gaveUp ? `Gave up after ${films(c.moves.length)}` : films(c.moves.length)) + ` · par ${c.par}`;
}

/** Long paths keep their first rows and their last (the film with JT), with a gap row between. */
export const MAX_PATH_ROWS = 16;

export type PathRow = CardStep | { more: number };

export function pathRows(steps: CardStep[], max = MAX_PATH_ROWS): PathRow[] {
  if (steps.length <= max) return steps;
  const head = steps.slice(0, max - 2);
  return [...head, { more: steps.length - head.length - 1 }, steps[steps.length - 1]];
}

// ------------------------------------------------------------------ drawing helpers

const measureWith =
  (ctx: Ctx, font: (size: number) => string): Measure =>
  (s, size) => {
    ctx.font = font(size);
    return ctx.measureText(s).width;
  };

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** A white (or coloured) panel with a black outline and a hard offset shadow, like .card. */
function panel(ctx: Ctx, x: number, y: number, w: number, h: number, o: { fill?: string; r?: number; shadow?: number; line?: number; dashed?: boolean } = {}): void {
  const r = o.r ?? 28;
  const shadow = o.shadow ?? 10;
  if (shadow && !o.dashed) {
    roundRect(ctx, x + shadow, y + shadow, w, h, r);
    ctx.fillStyle = INK;
    ctx.fill();
  }
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = o.fill ?? WHITE;
  ctx.fill();
  ctx.lineWidth = o.line ?? 5;
  ctx.strokeStyle = INK;
  ctx.setLineDash(o.dashed ? [16, 10] : []);
  ctx.stroke();
  ctx.setLineDash([]);
}

function background(ctx: Ctx, w: number, h: number, spacing = 36, r = 3.5): void {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = DOT;
  ctx.beginPath();
  for (let y = spacing / 2; y < h; y += spacing) {
    for (let x = spacing / 2; x < w; x += spacing) {
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
  }
  ctx.fill();
}

function polygon(ctx: Ctx, points: [number, number][]): void {
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
}

/** Five-pointed star, like the ticker's ★. */
function star(ctx: Ctx, cx: number, cy: number, r: number, fill: string): void {
  const pts: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 ? r * 0.45 : r;
    pts.push([cx + rad * Math.cos(a), cy + rad * Math.sin(a)]);
  }
  polygon(ctx, pts);
  ctx.fillStyle = fill;
  ctx.fill();
}

/** The chart-movement symbols: ▲ closer, ● no closer, ▼ further. `r` is the symbol's half-height. */
export function gradeSymbol(ctx: Ctx, grade: Grade, cx: number, cy: number, r: number, fill = INK): void {
  if (grade === 'same') {
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.78, 0, Math.PI * 2);
  } else {
    const up = grade === 'closer' ? 1 : -1;
    // Centred on the triangle's middle, not its bounding box, so it sits optically level.
    polygon(ctx, [
      [cx, cy - up * r * 1.05],
      [cx + r * 1.05, cy + up * r * 0.75],
      [cx - r * 1.05, cy + up * r * 0.75],
    ]);
  }
  ctx.fillStyle = fill;
  ctx.fill();
}

/** A light bulb, the hint marker (💡 in the text share). `s` is its height. */
function bulb(ctx: Ctx, cx: number, cy: number, s: number): void {
  const r = s * 0.3;
  const top = cy - s * 0.5 + r;
  ctx.lineWidth = Math.max(2, s * 0.07);
  ctx.strokeStyle = INK;
  ctx.beginPath();
  ctx.arc(cx, top + s * 0.02, r, Math.PI * 0.8, Math.PI * 2.2);
  ctx.lineTo(cx + r * 0.5, cy + s * 0.18);
  ctx.lineTo(cx - r * 0.5, cy + s * 0.18);
  ctx.closePath();
  ctx.fillStyle = SOFT;
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.fillRect(cx - r * 0.5, cy + s * 0.24, r, s * 0.09);
  ctx.fillRect(cx - r * 0.35, cy + s * 0.37, r * 0.7, s * 0.09);
}

/** A grade square: colour, symbol, and a bulb badge on hinted moves, so it reads without colour. */
function gradeSquare(ctx: Ctx, x: number, y: number, size: number, m: CardMove): void {
  roundRect(ctx, x, y, size, size, size * 0.18);
  ctx.fillStyle = GRADE_COLOR[m.grade];
  ctx.fill();
  ctx.lineWidth = Math.max(3, size * 0.05);
  ctx.strokeStyle = INK;
  ctx.stroke();
  gradeSymbol(ctx, m.grade, x + size / 2, y + size / 2 + (m.grade === 'closer' ? size * 0.04 : m.grade === 'further' ? -size * 0.04 : 0), size * 0.24);
  if (m.hinted) {
    const br = size * 0.24;
    const bx = x + size - br * 0.55;
    const by = y + br * 0.55;
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, Math.PI * 2);
    ctx.fillStyle = PINK;
    ctx.fill();
    ctx.lineWidth = Math.max(2.5, size * 0.04);
    ctx.stroke();
    bulb(ctx, bx, by, br * 1.45);
  }
}

/** Pill label, Rubik Mono One. Returns its width so pills can be laid out in a row. */
function pill(ctx: Ctx, x: number, y: number, label: string, size: number, fill: string, ink: string): number {
  ctx.font = display(size);
  const w = ctx.measureText(label.toUpperCase()).width + size * 1.6;
  const h = size * 2.2;
  panel(ctx, x, y, w, h, { fill, r: h / 2, shadow: Math.round(size * 0.25), line: Math.max(3, size * 0.16) });
  ctx.fillStyle = ink;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(label.toUpperCase(), x + size * 0.8, y + h / 2 + size * 0.04);
  return w;
}

/** White display type with a black outline and offset shadow, like the home page title. */
function outlinedText(ctx: Ctx, s: string, x: number, y: number, size: number): void {
  ctx.font = display(size);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  const shadow = size * 0.12;
  ctx.lineWidth = size * 0.16;
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.strokeText(s, x + shadow, y + shadow);
  ctx.fillText(s, x + shadow, y + shadow);
  ctx.strokeText(s, x, y);
  ctx.fillStyle = WHITE;
  ctx.fillText(s, x, y);
}

/** Lime arrow, pointing from the sticker to JT. */
function arrow(ctx: Ctx, x: number, y: number, len: number, thick: number): void {
  const head = thick * 1.6;
  const shape = (dx: number): [number, number][] => [
    [x + dx, y - thick / 2 + dx],
    [x + len - head + dx, y - thick / 2 + dx],
    [x + len - head + dx, y - head + dx],
    [x + len + dx, y + dx],
    [x + len - head + dx, y + head + dx],
    [x + len - head + dx, y + thick / 2 + dx],
    [x + dx, y + thick / 2 + dx],
  ];
  polygon(ctx, shape(thick * 0.3));
  ctx.fillStyle = INK;
  ctx.fill();
  polygon(ctx, shape(0));
  ctx.fillStyle = LIME;
  ctx.fill();
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(3, thick * 0.16);
  ctx.strokeStyle = INK;
  ctx.stroke();
}

// The home page's .sticker clip-path, in percent of the sticker's box.
const BURST: [number, number][] = [
  [50, 0], [61, 12], [77, 6], [79, 22], [95, 25], [89, 40], [100, 50], [89, 60], [95, 75], [79, 78], [77, 94], [61, 88],
  [50, 100], [39, 88], [23, 94], [21, 78], [5, 75], [11, 60], [0, 50], [11, 40], [5, 25], [21, 22], [23, 6], [39, 12],
];

/** The pink starburst sticker, tilted −8° like the home page's, with three centred lines. */
function sticker(ctx: Ctx, cx: number, cy: number, size: number, tag: string, name: string, foot: string): void {
  const burst = (dx: number) => polygon(ctx, BURST.map(([px, py]): [number, number] => [((px - 50) / 100) * size + dx, ((py - 50) / 100) * size + dx]));
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((-8 * Math.PI) / 180);
  burst(size * 0.025);
  ctx.fillStyle = INK;
  ctx.fill();
  burst(0);
  ctx.fillStyle = PINK;
  ctx.fill();
  ctx.lineJoin = 'round';
  ctx.lineWidth = size * 0.012;
  ctx.strokeStyle = INK;
  ctx.stroke();

  // The points of the burst start about 0.39 × size from the centre; the text block stays inside that circle.
  const tagSize = Math.round(size * 0.05);
  const gap = size * 0.035;
  const fit = fitText(name, measureWith(ctx, (s) => text(700, s)), { maxWidth: size * 0.6, maxLines: 4, max: size * 0.105, min: size * 0.05, maxHeight: size * 0.34, lineHeight: 1.08 });
  const lineH = fit.size * 1.08;
  const total = tagSize + gap + fit.lines.length * lineH + gap + tagSize;
  let y = -total / 2;
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = display(tagSize);
  ctx.fillText(tag.toUpperCase(), 0, y + tagSize / 2);
  y += tagSize + gap;
  ctx.font = text(700, fit.size);
  for (const line of fit.lines) {
    ctx.fillText(line, 0, y + lineH / 2);
    y += lineH;
  }
  y += gap;
  ctx.font = display(tagSize);
  ctx.fillText(foot.toUpperCase(), 0, y + tagSize / 2);
  ctx.restore();
}

/** Lime-on-black band with starred text, like the home page ticker. */
function band(ctx: Ctx, y: number, w: number, h: number, label: string, size: number, stars: boolean): void {
  ctx.fillStyle = INK;
  ctx.fillRect(0, y, w, h);
  ctx.font = display(size);
  const tw = ctx.measureText(label).width;
  ctx.fillStyle = LIME;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, w / 2, y + h / 2 + size * 0.04);
  if (stars) {
    star(ctx, w / 2 - tw / 2 - size * 1.2, y + h / 2, size * 0.6, LIME);
    star(ctx, w / 2 + tw / 2 + size * 1.2, y + h / 2, size * 0.6, LIME);
  }
}

/** ▲ Closer ● No closer ▼ Further (bulb) Hint, centred on cx. */
function legend(ctx: Ctx, cx: number, y: number, size: number, withHint: boolean): void {
  const items: (Grade | 'hint')[] = ['closer', 'same', 'further', ...(withHint ? (['hint'] as const) : [])];
  const chip = size * 1.7;
  const gap = size * 1.4;
  ctx.font = display(size);
  const label = (it: Grade | 'hint') => (it === 'hint' ? 'Hint' : GRADE_WORD[it]).toUpperCase();
  const widths = items.map((it) => chip + size * 0.5 + ctx.measureText(label(it)).width);
  let x = cx - (widths.reduce((a, b) => a + b, 0) + gap * (items.length - 1)) / 2;
  items.forEach((it, i) => {
    if (it === 'hint') {
      ctx.beginPath();
      ctx.arc(x + chip / 2, y, chip / 2, 0, Math.PI * 2);
      ctx.fillStyle = PINK;
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = INK;
      ctx.stroke();
      bulb(ctx, x + chip / 2, y, chip * 0.72);
    } else {
      roundRect(ctx, x, y - chip / 2, chip, chip, chip * 0.2);
      ctx.fillStyle = GRADE_COLOR[it];
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = INK;
      ctx.stroke();
      gradeSymbol(ctx, it, x + chip / 2, y + (it === 'closer' ? 1 : it === 'further' ? -1 : 0), chip * 0.25);
    }
    ctx.font = display(size);
    ctx.fillStyle = INK;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label(it), x + chip + size * 0.5, y + size * 0.05);
    x += widths[i] + gap;
  });
}

// ------------------------------------------------------------------ result card

export const RESULT_WIDTH = 1080;
const SUMMARY_HEIGHT = 1080;
const ROW_H = 112;
const ROW_GAP = 20;
const PATH_TOP = 70;
/** Where the countdown starts on the "Show my path" card: just under the score panel. */
const PATH_START = 990;
/** Space under the last row: a gap, then the footer band. */
const PATH_BOTTOM = 44 + 76;

/** Square without the path; taller with it, one row per film plus the start. */
export function resultCardSize(c: ResultCard): { width: number; height: number } {
  if (!c.path) return { width: RESULT_WIDTH, height: SUMMARY_HEIGHT };
  const rows = pathRows(c.path).length + 1;
  return { width: RESULT_WIDTH, height: PATH_START + PATH_TOP + rows * (ROW_H + ROW_GAP) - ROW_GAP + PATH_BOTTOM };
}

export function drawResultCard(ctx: Ctx, c: ResultCard): void {
  const { width: W, height: H } = resultCardSize(c);
  background(ctx, W, H);
  band(ctx, 0, W, 76, 'SIX DEGREES OF JUSTIN TIMBERLAKE', 26, true);

  sticker(ctx, 300, 352, 480, c.label, c.start, `Par ${c.par}`);
  if (c.hard) {
    ctx.save();
    ctx.translate(400, 548);
    ctx.rotate((6 * Math.PI) / 180);
    pill(ctx, 0, 0, 'Hard mode', 24, INK, LIME);
    ctx.restore();
  }

  // "→ Justin Timberlake", the goal, beside the sticker.
  arrow(ctx, 600, 250, 170, 40);
  outlinedText(ctx, 'JUSTIN', 600, 360, 50);
  outlinedText(ctx, 'TIMBERLAKE', 600, 428, 50);

  // The score panel: result line, grade squares, legend.
  const px = 60;
  const py = 632;
  const pw = W - 120;
  const ph = 320;
  panel(ctx, px, py, pw, ph, { fill: c.gaveUp ? WHITE : SOFT });
  const score = scoreLine(c).toUpperCase();
  const scoreFit = fitText(score, measureWith(ctx, display), { maxWidth: pw - 80, maxLines: 1, max: 40, min: 22 });
  ctx.font = display(scoreFit.size);
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(scoreFit.lines[0], W / 2, py + 52);

  const gap = 14;
  const grid = squareGrid(c.moves.length, pw - 80, 150, gap, 100);
  const gridTop = py + 92 + (150 - (grid.rows * grid.size + (grid.rows - 1) * gap)) / 2;
  c.moves.forEach((m, i) => {
    const row = Math.floor(i / grid.perRow);
    const inRow = Math.min(grid.perRow, c.moves.length - row * grid.perRow);
    const rowLeft = W / 2 - (inRow * grid.size + (inRow - 1) * gap) / 2;
    gradeSquare(ctx, rowLeft + (i % grid.perRow) * (grid.size + gap), gridTop + row * (grid.size + gap), grid.size, m);
  });
  legend(ctx, W / 2, py + ph - 44, 17, c.moves.some((m) => m.hinted));

  if (c.path) drawPath(ctx, c, PATH_START);
  band(ctx, H - 76, W, 76, c.site.toUpperCase(), 24, false);
}

/** The countdown: START, then the films counting down to #1, the one with JT. */
function drawPath(ctx: Ctx, c: ResultCard, top: number): void {
  const x = 60;
  const w = RESULT_WIDTH - 120;
  ctx.font = display(28);
  ctx.fillStyle = INK;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(c.gaveUp ? 'MY COUNTDOWN, FINISHED FOR ME' : 'MY COUNTDOWN', x, top + PATH_TOP / 2);
  countdownRows(c).forEach((r, i) => trackRow(ctx, x, top + PATH_TOP + i * (ROW_H + ROW_GAP), w, r));
}

/** The countdown's cards: START, then the films (at most `max` rows of them) down to #1. */
function countdownRows(c: ResultCard, max = MAX_PATH_ROWS): TrackRow[] {
  const steps = c.path ?? [];
  const rows = pathRows(steps, max);
  return [
    { num: 'START', title: c.start, start: true },
    ...rows.map((r, i): TrackRow => {
      if ('more' in r) return { num: '…', title: `${r.more} more ${r.more === 1 ? 'film' : 'films'}`, dashed: true };
      // Numbered by place in the full path, so #1 is always the film with JT.
      const place = i === rows.length - 1 ? 1 : steps.length - i;
      return { num: `#${place}`, title: r.film, year: r.year, sub: r.person, grade: r.grade, hinted: r.hinted, dashed: r.revealed, numberOne: place === 1 };
    }),
  ];
}

interface TrackRow {
  num: string;
  title: string;
  year?: number | null;
  sub?: string;
  grade?: Grade;
  hinted?: boolean;
  dashed?: boolean;
  start?: boolean;
  numberOne?: boolean;
}

/** One countdown card, like .track: number block on the left, title and co-star, grade chip on the right. */
function trackRow(ctx: Ctx, x: number, y: number, w: number, r: TrackRow): void {
  const block = 128;
  panel(ctx, x, y, w, ROW_H, { fill: r.numberOne ? SOFT : WHITE, r: 24, shadow: 8, dashed: r.dashed });
  // Number block, clipped to the panel's rounded left edge by drawing it as its own rounded shape.
  ctx.save();
  roundRect(ctx, x + 2.5, y + 2.5, block, ROW_H - 5, 21);
  ctx.fillStyle = r.start || r.numberOne ? PINK : r.dashed ? WHITE : INK;
  ctx.fill();
  ctx.fillRect(x + block - 20, y + 2.5, 22.5, ROW_H - 5);
  ctx.restore();
  ctx.lineWidth = 5;
  ctx.strokeStyle = INK;
  ctx.setLineDash(r.dashed ? [16, 10] : []);
  ctx.beginPath();
  ctx.moveTo(x + block + 2.5, y);
  ctx.lineTo(x + block + 2.5, y + ROW_H);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = display(r.start ? 22 : r.num.length > 3 ? 30 : 36);
  ctx.fillStyle = r.start || r.numberOne || r.dashed ? INK : LIME;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(r.num, x + block / 2 + 1, y + ROW_H / 2 + 1);

  // Grade chip on the right; the text column takes what's left.
  const chipW = 214;
  const chipX = x + w - chipW - 22;
  const answer = !r.grade && r.dashed && r.sub !== undefined;
  const tx = x + block + 28;
  const tw = (r.grade || answer ? chipX - 24 : x + w - 28) - tx;
  if (r.grade) gradeChip(ctx, chipX, y + ROW_H / 2 - 24, chipW, r.grade, !!r.hinted);
  else if (answer) answerChip(ctx, chipX, y + ROW_H / 2 - 24, chipW);

  const year = r.year ? ` (${r.year})` : '';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  if (r.sub === undefined) {
    const fit = fitText(r.title, measureWith(ctx, (s) => text(700, s)), { maxWidth: tw, maxLines: 1, max: 36, min: 24 });
    ctx.font = text(700, fit.size);
    ctx.fillStyle = INK;
    ctx.fillText(fit.lines[0], tx, y + ROW_H / 2);
    return;
  }
  // Title (with year, muted) on one line, shrinking a little before it's cut short.
  const titleMeasure = measureWith(ctx, (s) => text(700, s));
  const yearW = (size: number) => (year ? measureWith(ctx, (s) => text(500, s))(year, size) : 0);
  let size = 32;
  while (size > 24 && titleMeasure(r.title, size) + yearW(size) > tw) size--;
  const title = ellipsize(r.title, size, tw - yearW(size), titleMeasure);
  ctx.font = text(700, size);
  ctx.fillStyle = INK;
  ctx.fillText(title, tx, y + 40);
  if (year && titleMeasure(title, size) + yearW(size) <= tw) {
    const after = tx + titleMeasure(title, size);
    ctx.font = text(500, size);
    ctx.fillStyle = MUTED;
    ctx.fillText(year, after, y + 40);
  }
  const feat = 'feat. ';
  ctx.font = text(500, 26);
  const featW = ctx.measureText(feat).width;
  ctx.fillStyle = MUTED;
  ctx.fillText(feat, tx, y + 78);
  ctx.fillStyle = INK;
  const name = ellipsize(r.sub, 26, tw - featW, measureWith(ctx, (s) => text(700, s)));
  ctx.font = text(700, 26);
  ctx.fillText(name, tx + featW, y + 78);
}

function gradeChip(ctx: Ctx, x: number, y: number, w: number, g: Grade, hinted: boolean): void {
  roundRect(ctx, x, y, w, 48, 24);
  ctx.fillStyle = GRADE_COLOR[g];
  ctx.fill();
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = INK;
  ctx.stroke();
  let ix = x + 26;
  if (hinted) {
    bulb(ctx, ix, y + 24, 30);
    ix += 28;
  }
  gradeSymbol(ctx, g, ix, y + 24 + (g === 'closer' ? 1.5 : g === 'further' ? -1.5 : 0), 9);
  ctx.font = display(hinted ? 15 : 17);
  ctx.fillStyle = INK;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(GRADE_WORD[g].toUpperCase(), ix + 18, y + 25);
}

function answerChip(ctx: Ctx, x: number, y: number, w: number): void {
  roundRect(ctx, x, y, w, 48, 24);
  ctx.fillStyle = WHITE;
  ctx.fill();
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.font = display(17);
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('ANSWER', x + w / 2, y + 25);
}

// ------------------------------------------------------------------ story card and video

/*
 * The 9:16 card for Instagram, TikTok and Snapchat stories, which is also every frame of
 * the share video: drawStory(ctx, card, at) draws the card as it stands `at` seconds into
 * the video, and the still image is the finished card. Story apps cover roughly the top and
 * bottom 250px with their own controls, so only decoration sits there.
 */

export const STORY_WIDTH = 1080;
export const STORY_HEIGHT = 1920;
/** Film rows on a story with the path; longer paths fold their middle into a "more" row. */
export const STORY_PATH_ROWS = 9;

export interface StoryCard extends ResultCard {
  /** How the player did against everyone else that day, e.g. "Beat 72% of players". */
  standing?: string;
}

/** When each part of the story arrives in the video, in seconds from the start. */
export interface StoryPlan {
  sticker: number;
  /** The arrow and JT's name under the sticker (spoiler-free story only). */
  goal: number;
  /** One per countdown card, START first (story with the path only). */
  rows: number[];
  panel: number;
  squares: number[];
  standing: number;
  cta: number;
  /** The video's length: everything in, then a hold on the finished card. */
  end: number;
}

export function storyPlan(c: StoryCard): StoryPlan {
  let t = 0.15;
  const sticker = t;
  t += 0.6;
  const goal = t;
  let rows: number[] = [];
  if (c.path) {
    const n = countdownRows(c, STORY_PATH_ROWS).length;
    // Long countdowns deal their cards faster, so the video stays about the same length.
    const step = Math.min(0.4, 2.4 / n);
    rows = Array.from({ length: n }, (_, i) => t + i * step);
    t += n * step + 0.2;
  } else {
    t += 0.75;
  }
  const panel = t;
  t += 0.35;
  const step = Math.min(0.28, 1.8 / Math.max(1, c.moves.length));
  const squares = c.moves.map((_, i) => t + i * step);
  t += c.moves.length * step + 0.3;
  const standing = t;
  if (c.standing) t += 0.5;
  const cta = t;
  t += 0.4;
  return { sticker, goal, rows, panel, squares, standing, cta, end: t + 1.8 };
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
/** 0 → 1 over `dur` seconds from `start`. A still (at = Infinity) is always 1. */
const phase = (at: number, start: number, dur: number) => clamp01((at - start) / dur);
const easeOut = (p: number) => 1 - (1 - p) ** 3;
/** Overshoots a little before settling, like a sticker slapped on. */
const easeBack = (p: number) => 1 + 2.70158 * (p - 1) ** 3 + 1.70158 * (p - 1) ** 2;

/** Run `draw` scaled by `s` about (cx, cy), at opacity `alpha`; skipped while invisible. */
function transformed(ctx: Ctx, o: { cx: number; cy: number; s?: number; dx?: number; dy?: number; turn?: number; alpha?: number }, draw: () => void): void {
  const s = o.s ?? 1;
  const alpha = o.alpha ?? 1;
  if (s <= 0.001 || alpha <= 0.001) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(o.cx + (o.dx ?? 0), o.cy + (o.dy ?? 0));
  if (o.turn) ctx.rotate(o.turn);
  ctx.scale(s, s);
  ctx.translate(-o.cx, -o.cy);
  draw();
  ctx.restore();
}

/** outlinedText, centred on cx. */
function outlinedCentred(ctx: Ctx, s: string, cx: number, y: number, size: number): void {
  ctx.font = display(size);
  outlinedText(ctx, s, cx - (ctx.measureText(s).width + size * 0.12) / 2, y, size);
}

export function drawStory(ctx: Ctx, c: StoryCard, at = Infinity): void {
  const W = STORY_WIDTH;
  const H = STORY_HEIGHT;
  const plan = storyPlan(c);
  const withPath = !!c.path;
  background(ctx, W, H);
  band(ctx, 96, W, 80, 'SIX DEGREES OF JUSTIN TIMBERLAKE', 26, true);

  // The sticker lands with a spin and a little overshoot.
  const size = withPath ? 470 : 640;
  const sy = withPath ? 470 : 600;
  const pop = phase(at, plan.sticker, 0.6);
  transformed(ctx, { cx: W / 2, cy: sy, s: easeBack(pop), turn: (1 - easeOut(pop)) * -0.5 }, () => {
    sticker(ctx, W / 2, sy, size, c.label, c.start, `Par ${c.par}`);
    if (c.hard) {
      ctx.save();
      ctx.translate(W / 2 + size * 0.12, sy + size * 0.36);
      ctx.rotate((6 * Math.PI) / 180);
      pill(ctx, 0, 0, 'Hard mode', 26, INK, LIME);
      ctx.restore();
    }
  });

  if (withPath) storyCountdown(ctx, c, plan, at);
  else {
    // ↓ Justin Timberlake: where the countdown ends up.
    const p = easeOut(phase(at, plan.goal, 0.5));
    transformed(ctx, { cx: W / 2, cy: 1050, dy: (1 - p) * -40, alpha: p }, () => {
      ctx.save();
      ctx.translate(W / 2, 925);
      ctx.rotate(Math.PI / 2);
      arrow(ctx, 0, 0, 105, 40);
      ctx.restore();
      outlinedCentred(ctx, 'JUSTIN', W / 2, 1096, 66);
      outlinedCentred(ctx, 'TIMBERLAKE', W / 2, 1172, 66);
    });
  }

  storyScore(ctx, c, plan, at, withPath);

  const cta = easeOut(phase(at, plan.cta, 0.4));
  transformed(ctx, { cx: W / 2, cy: 1676, dy: (1 - cta) * 30, alpha: cta }, () => {
    ctx.font = display(40);
    ctx.fillStyle = INK;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(c.gaveUp ? 'CAN YOU FINISH IT?' : 'CAN YOU BEAT IT?', W / 2, 1676);
  });
  band(ctx, 1736, W, 80, c.site.toUpperCase(), 26, false);
}

/** The countdown cards, dealt in from the right, shrunk to fit if the path is long. */
function storyCountdown(ctx: Ctx, c: StoryCard, plan: StoryPlan, at: number): void {
  const top = 760;
  // Down to just above the standing stamp on the score panel.
  const room = 1404 - top;
  const rows = countdownRows(c, STORY_PATH_ROWS);
  const natural = rows.length * (ROW_H + ROW_GAP) - ROW_GAP;
  const k = Math.min(1, room / natural);
  const w = STORY_WIDTH - 120;
  ctx.save();
  ctx.translate(STORY_WIDTH / 2 - (w * k) / 2, top + (room - natural * k) / 2);
  ctx.scale(k, k);
  rows.forEach((r, i) => {
    const p = easeOut(phase(at, plan.rows[i], 0.4));
    const y = i * (ROW_H + ROW_GAP);
    transformed(ctx, { cx: 0, cy: y, dx: (1 - p) * 800, alpha: p }, () => trackRow(ctx, 0, y, w, r));
  });
  ctx.restore();
}

/** The score panel: result line, grade squares popping in one by one, legend, standing. */
function storyScore(ctx: Ctx, c: StoryCard, plan: StoryPlan, at: number, compact: boolean): void {
  const W = STORY_WIDTH;
  const px = 60;
  const pw = W - 120;
  const py = compact ? 1470 : 1290;
  const ph = compact ? 160 : 330;
  const slide = easeOut(phase(at, plan.panel, 0.35));
  transformed(ctx, { cx: W / 2, cy: py, dy: (1 - slide) * 80, alpha: slide }, () => {
    panel(ctx, px, py, pw, ph, { fill: c.gaveUp ? WHITE : SOFT });
    const score = fitText(scoreLine(c).toUpperCase(), measureWith(ctx, display), { maxWidth: pw - 80, maxLines: 1, max: compact ? 34 : 42, min: 22 });
    ctx.font = display(score.size);
    ctx.fillStyle = INK;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(score.lines[0], W / 2, py + (compact ? 40 : 54));
  });

  const gap = compact ? 10 : 14;
  const areaH = compact ? 72 : 150;
  const areaTop = py + (compact ? 72 : 96);
  const grid = squareGrid(c.moves.length, pw - 80, areaH, gap, compact ? 64 : 110);
  const gridTop = areaTop + (areaH - (grid.rows * grid.size + (grid.rows - 1) * gap)) / 2;
  c.moves.forEach((m, i) => {
    const row = Math.floor(i / grid.perRow);
    const inRow = Math.min(grid.perRow, c.moves.length - row * grid.perRow);
    const x = W / 2 - (inRow * grid.size + (inRow - 1) * gap) / 2 + (i % grid.perRow) * (grid.size + gap);
    const y = gridTop + row * (grid.size + gap);
    const p = phase(at, plan.squares[i], 0.3);
    transformed(ctx, { cx: x + grid.size / 2, cy: y + grid.size / 2, s: easeBack(p) }, () => gradeSquare(ctx, x, y, grid.size, m));
  });

  if (!compact) {
    const last = plan.squares.at(-1) ?? plan.panel;
    transformed(ctx, { cx: W / 2, cy: py + ph - 40, alpha: phase(at, last + 0.15, 0.3) }, () => legend(ctx, W / 2, py + ph - 40, 18, c.moves.some((m) => m.hinted)));
  }

  if (c.standing) {
    // Stamped on the panel's top edge, clear of the score line.
    const label = c.standing.toUpperCase();
    const size = 24;
    ctx.font = display(size);
    const w = ctx.measureText(label).width + size * 1.6;
    const p = phase(at, plan.standing, 0.35);
    const sx = px + pw - w + 16;
    const sy = py - 56;
    transformed(ctx, { cx: sx + w / 2, cy: sy + size * 1.1, s: 1.6 - 0.6 * easeOut(p), turn: (-4 * Math.PI) / 180, alpha: p }, () => pill(ctx, sx, sy, label, size, LIME, INK));
  }
}

// ------------------------------------------------------------------ link preview card

/** Open Graph's recommended size. */
export const PREVIEW_WIDTH = 1200;
export const PREVIEW_HEIGHT = 630;

/** The link-preview image: the sticker on the left, the title and pills on the right. No spoilers. */
export function drawPreviewCard(ctx: Ctx, c: PreviewCard): void {
  const W = PREVIEW_WIDTH;
  const H = PREVIEW_HEIGHT;
  background(ctx, W, H, 34, 3.2);
  sticker(ctx, 312, 318, 520, c.tag, c.name, c.foot);

  const x = 640;
  const colW = W - x - 50;
  ['SIX DEGREES', 'OF JUSTIN', 'TIMBERLAKE'].forEach((line, i) => outlinedText(ctx, line, x, 92 + i * 66, 52));

  let px = x;
  c.pills.forEach((label, i) => {
    px += pill(ctx, px, 302, label, 20, i === 0 ? LIME : INK, i === 0 ? INK : LIME) + 18;
  });

  const blurb = fitText(c.blurb, measureWith(ctx, (s) => text(600, s)), { maxWidth: colW, maxLines: 3, max: 32, min: 22, lineHeight: 1.2 });
  ctx.font = text(600, blurb.size);
  ctx.fillStyle = INK;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  blurb.lines.forEach((line, i) => ctx.fillText(line, x, 424 + i * blurb.size * 1.2));

  ctx.font = display(18);
  ctx.fillText(c.site.toUpperCase(), x, 566);
}
