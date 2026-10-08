import { describe, expect, it } from 'vitest';
import { drawPreviewCard, drawResultCard, ellipsize, fitText, pathRows, resultCardSize, scoreLine, squareGrid, wrap, type CardStep, type Ctx, type Measure, type ResultCard } from './card';

// Every character is 0.6em wide: close enough to Chakra Petch to exercise the fitting.
const measure: Measure = (s, size) => [...s].length * size * 0.6;

/** A context that records the text drawn, measuring with the same fake metrics. */
function recorder(): Ctx & { texts: string[] } {
  const texts: string[] = [];
  const sizeOf = (font: string) => Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 10);
  const ctx = {
    texts,
    fillStyle: '' as unknown,
    strokeStyle: '' as unknown,
    lineWidth: 1,
    lineJoin: '' as unknown,
    font: '10px sans-serif',
    textAlign: '' as unknown,
    textBaseline: '' as unknown,
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    arcTo() {},
    fill() {},
    stroke() {},
    fillRect() {},
    fillText(s: string) {
      texts.push(s);
    },
    strokeText() {},
    measureText(s: string) {
      return { width: measure(s, sizeOf(ctx.font)) };
    },
    setLineDash() {},
  };
  return ctx;
}

describe('wrap', () => {
  it('breaks between words and after hyphens', () => {
    expect(wrap('Soraya Esfandiari-Bakhtiari', 10, 70, measure)).toEqual(['Soraya', 'Esfandiari-', 'Bakhtiari']);
    expect(wrap('Pelé', 10, 70, measure)).toEqual(['Pelé']);
  });

  it('keeps a hyphenated name together when it fits', () => {
    expect(wrap('Rosie Huntington-Whiteley', 10, 1000, measure)).toEqual(['Rosie Huntington-Whiteley']);
  });
});

describe('fitText', () => {
  const box = { maxWidth: 288, maxLines: 4, max: 50, min: 24, maxHeight: 163, lineHeight: 1.08 };

  it('keeps short names at the largest size', () => {
    expect(fitText('Pelé', measure, box)).toEqual({ size: 50, lines: ['Pelé'] });
  });

  it('shrinks a 42-character name until it fits the sticker', () => {
    const fit = fitText('Edward Grey, 1st Viscount Grey of Fallodon', measure, box);
    expect(fit.size).toBeLessThan(50);
    expect(fit.size).toBeGreaterThanOrEqual(24);
    expect(fit.lines.length).toBeLessThanOrEqual(4);
    expect(fit.lines.join(' ')).toBe('Edward Grey, 1st Viscount Grey of Fallodon');
    for (const line of fit.lines) expect(measure(line, fit.size)).toBeLessThanOrEqual(box.maxWidth);
    expect(fit.lines.length * fit.size * 1.08).toBeLessThanOrEqual(box.maxHeight);
  });

  it('cuts text short with an ellipsis when even the smallest size overflows', () => {
    const fit = fitText('A very long film title that goes on and on and on', measure, { maxWidth: 200, maxLines: 1, max: 30, min: 20 });
    expect(fit.size).toBe(20);
    expect(fit.lines).toHaveLength(1);
    expect(fit.lines[0].endsWith('…')).toBe(true);
    expect(measure(fit.lines[0], 20)).toBeLessThanOrEqual(200);
  });
});

describe('ellipsize', () => {
  it('leaves fitting text alone and trims the rest', () => {
    expect(ellipsize('Goal III', 10, 100, measure)).toBe('Goal III');
    expect(ellipsize('The Man from U.N.C.L.E.', 10, 60, measure)).toBe('The Man f…');
  });
});

describe('squareGrid', () => {
  it('uses one row of big squares for a short game', () => {
    expect(squareGrid(4, 880, 150, 14, 100)).toEqual({ size: 100, perRow: 4, rows: 1 });
  });

  it('wraps long games into rows that still fit the box', () => {
    const g = squareGrid(30, 880, 150, 14, 100);
    expect(g.rows).toBeGreaterThan(1);
    expect(g.perRow * g.size + (g.perRow - 1) * 14).toBeLessThanOrEqual(880);
    expect(g.rows * g.size + (g.rows - 1) * 14).toBeLessThanOrEqual(150);
    expect(g.perRow * g.rows).toBeGreaterThanOrEqual(30);
  });
});

const step = (i: number): CardStep => ({ film: `Film ${i}`, year: 2000 + i, person: `Person ${i}`, grade: 'closer', hinted: false });

describe('pathRows', () => {
  it('keeps short paths whole', () => {
    expect(pathRows([step(1), step(2)])).toHaveLength(2);
  });

  it('keeps the start of a long path and the film with JT, with a gap row', () => {
    const steps = Array.from({ length: 30 }, (_, i) => step(i));
    const rows = pathRows(steps, 16);
    expect(rows).toHaveLength(16);
    expect(rows[14]).toEqual({ more: 15 });
    expect(rows[15]).toBe(steps[29]);
  });
});

describe('scoreLine', () => {
  const moves = [{ grade: 'closer' as const, hinted: false }];
  it('reads like the result screen', () => {
    expect(scoreLine({ moves, par: 3, gaveUp: false })).toBe('1 film · par 3');
    expect(scoreLine({ moves: [...moves, ...moves], par: 3, gaveUp: true })).toBe('Gave up after 2 films · par 3');
  });
});

describe('drawResultCard', () => {
  const card: ResultCard = {
    label: 'Daily #12',
    hard: true,
    start: 'Edward Grey, 1st Viscount Grey of Fallodon',
    par: 3,
    moves: [
      { grade: 'closer', hinted: false },
      { grade: 'same', hinted: true },
      { grade: 'closer', hinted: false },
    ],
    gaveUp: false,
    site: 'sixdegrees.sidharthjoly.com',
  };
  const path: CardStep[] = [
    { film: 'Secret Film One', year: 2001, person: 'Hidden Costar', grade: 'closer', hinted: false },
    { film: 'Secret Film Two', year: null, person: 'Another Costar', grade: 'same', hinted: true },
    { film: 'The Social Network', year: 2010, person: 'Justin Timberlake', grade: 'closer', hinted: false },
  ];

  it('is spoiler-free by default: no film or co-star names', () => {
    const ctx = recorder();
    drawResultCard(ctx, card);
    const all = ctx.texts.join('\n');
    expect(all).toContain('DAILY #12');
    expect(all).toContain('HARD MODE');
    expect(all).toContain('3 FILMS · PAR 3');
    expect(all).toContain('SIXDEGREES.SIDHARTHJOLY.COM');
    for (const secret of ['Secret Film', 'Costar', 'Social Network']) expect(all).not.toContain(secret);
    expect(resultCardSize(card)).toEqual({ width: 1080, height: 1080 });
  });

  it('adds the countdown when asked, and grows to fit it', () => {
    const ctx = recorder();
    const withPath = { ...card, path };
    drawResultCard(ctx, withPath);
    const all = ctx.texts.join('\n');
    expect(all).toContain('Secret Film One');
    expect(all).toContain('Another Costar');
    expect(all).toContain('#1');
    expect(resultCardSize(withPath).height).toBeGreaterThan(1080);
  });
});

describe('drawPreviewCard', () => {
  it('draws the sticker and the blurb', () => {
    const ctx = recorder();
    drawPreviewCard(ctx, { tag: 'Daily #1', name: 'Pelé', foot: '8 Oct 2026', pills: ['Daily #1'], blurb: 'Connect Pelé to Justin Timberlake.', site: 'example.com' });
    expect(ctx.texts).toEqual(expect.arrayContaining(['DAILY #1', 'Pelé', '8 OCT 2026', 'EXAMPLE.COM']));
  });
});
