import { describe, expect, it } from 'vitest';
import { STORY_PATH_ROWS, drawPreviewCard, drawResultCard, drawStory, ellipsize, fitText, pathRows, resultCardSize, scoreLine, squareGrid, storyPlan, wrap, type CardStep, type Ctx, type Measure, type ResultCard, type StoryCard } from './card';

// Every character is 0.6em wide: close enough to Chakra Petch to exercise the fitting.
const measure: Measure = (s, size) => [...s].length * size * 0.6;

/** A context that records the text drawn, and where, measuring with the same fake metrics. */
function recorder(): Ctx & { texts: string[]; at: [string, number, number][] } {
  const texts: string[] = [];
  const at: [string, number, number][] = [];
  const sizeOf = (font: string) => Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 10);
  const ctx = {
    texts,
    at,
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
    scale() {},
    globalAlpha: 1,
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    arcTo() {},
    fill() {},
    stroke() {},
    fillRect() {},
    fillText(s: string, x: number, y: number) {
      texts.push(s);
      at.push([s, x, y]);
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

  it('heads for JT unless told otherwise, in the same place as ever', () => {
    const ctx = recorder();
    drawResultCard(ctx, card);
    expect(ctx.texts).toContain('SIX DEGREES OF JUSTIN TIMBERLAKE');
    // Each outlined word is drawn twice: its shadow, then the word.
    expect(ctx.at.filter(([s]) => s === 'JUSTIN').at(-1)).toEqual(['JUSTIN', 600, 360]);
    expect(ctx.at.filter(([s]) => s === 'TIMBERLAKE').at(-1)).toEqual(['TIMBERLAKE', 600, 428]);
  });

  it('names another star in the band and beside the sticker, first name over the rest', () => {
    const ctx = recorder();
    drawResultCard(ctx, { ...card, goal: 'Robert De Niro' });
    expect(ctx.texts).toContain('SIX DEGREES OF ROBERT DE NIRO');
    expect(ctx.texts).toContain('ROBERT');
    expect(ctx.texts).toContain('DE NIRO');
    expect(ctx.texts.join('\n')).not.toContain('TIMBERLAKE');
  });
});

describe('story card', () => {
  const card: StoryCard = {
    label: 'Daily #12',
    hard: false,
    start: 'Pelé',
    par: 2,
    moves: [
      { grade: 'closer', hinted: false },
      { grade: 'closer', hinted: true },
    ],
    gaveUp: false,
    site: 'example.com',
    standing: 'Beat 72% of players',
  };
  const path: CardStep[] = [
    { film: 'Secret Film', year: 2001, person: 'Hidden Costar', grade: 'closer' },
    { film: 'In Time', year: 2011, person: 'Justin Timberlake', grade: 'closer', hinted: true },
  ];
  const longPath: CardStep[] = Array.from({ length: 14 }, (_, i) => ({ film: `Film ${i + 1}`, year: 2000 + i, person: i === 13 ? 'Justin Timberlake' : `Person ${i + 1}`, grade: 'same' as const }));

  it('is spoiler-free by default, with the standing and a call to play', () => {
    const ctx = recorder();
    drawStory(ctx, card);
    const all = ctx.texts.join('\n');
    expect(all).toContain('2 FILMS · PAR 2');
    expect(all).toContain('BEAT 72% OF PLAYERS');
    expect(all).toContain('CAN YOU BEAT IT?');
    expect(all).not.toContain('Secret Film');
  });

  it('names the goal under the sticker: JT in his usual place, or another star', () => {
    const jt = recorder();
    drawStory(jt, card);
    expect(jt.at.filter(([s]) => s === 'JUSTIN').at(-1)).toEqual(['JUSTIN', expect.any(Number), 1096]);
    expect(jt.at.filter(([s]) => s === 'TIMBERLAKE').at(-1)).toEqual(['TIMBERLAKE', expect.any(Number), 1172]);
    const star = recorder();
    drawStory(star, { ...card, goal: 'Zendaya' });
    expect(star.texts).toContain('SIX DEGREES OF ZENDAYA');
    // One name, one line, centred where JT's two sit.
    expect(star.at.filter(([s]) => s === 'ZENDAYA').at(-1)).toEqual(['ZENDAYA', expect.any(Number), 1134]);
  });

  it('dares the next player to finish when this one gave up', () => {
    const ctx = recorder();
    drawStory(ctx, { ...card, gaveUp: true, standing: undefined });
    expect(ctx.texts).toContain('CAN YOU FINISH IT?');
  });

  it('folds a long countdown to fit', () => {
    const ctx = recorder();
    drawStory(ctx, { ...card, path: longPath });
    const all = ctx.texts.join('\n');
    expect(all).toContain('Film 1');
    expect(all).toContain('Film 14');
    expect(all).toContain('6 more films');
    expect(all).not.toContain('Film 9 ');
    expect(storyPlan({ ...card, path: longPath }).rows).toHaveLength(STORY_PATH_ROWS + 1);
  });

  it('plays its parts in order, ending on a hold', () => {
    const plan = storyPlan({ ...card, path });
    const times = [plan.sticker, ...plan.rows, plan.panel, ...plan.squares, plan.standing, plan.cta];
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(plan.end).toBeGreaterThan(plan.cta + 1);
    expect(plan.end).toBeLessThan(10);
  });

  it('draws nothing of a part before its time', () => {
    const early = recorder();
    drawStory(early, { ...card, path }, 0);
    expect(early.texts.join('\n')).not.toContain('Secret Film');
    expect(early.texts.join('\n')).not.toContain('CAN YOU BEAT IT?');
    const late = recorder();
    drawStory(late, { ...card, path }, storyPlan({ ...card, path }).end);
    expect(late.texts.join('\n')).toContain('Secret Film');
  });
});

describe('drawPreviewCard', () => {
  it('draws the sticker and the blurb', () => {
    const ctx = recorder();
    drawPreviewCard(ctx, { tag: 'Daily #1', name: 'Pelé', foot: '8 Oct 2026', pills: ['Daily #1'], blurb: 'Connect Pelé to Justin Timberlake.', site: 'example.com' });
    expect(ctx.texts).toEqual(expect.arrayContaining(['DAILY #1', 'Pelé', '8 OCT 2026', 'EXAMPLE.COM']));
  });

  it('heads for JT in its title as ever, or for the star daily’s star', () => {
    const base = { tag: 'Daily #1', name: 'Pelé', foot: '8 Oct 2026', pills: ['Daily #1'], blurb: '', site: 'example.com' };
    const jt = recorder();
    drawPreviewCard(jt, base);
    // Each outlined line is drawn twice (shadow, then line); the second is the line's place.
    const at = (ctx: ReturnType<typeof recorder>, s: string) => ctx.at.filter(([t]) => t === s).at(-1);
    expect(at(jt, 'SIX DEGREES')).toEqual(['SIX DEGREES', 640, 92]);
    expect(at(jt, 'OF JUSTIN')).toEqual(['OF JUSTIN', 640, 158]);
    expect(at(jt, 'TIMBERLAKE')).toEqual(['TIMBERLAKE', 640, 224]);
    const star = recorder();
    drawPreviewCard(star, { ...base, goal: 'Robert De Niro', pills: ['Daily #1', 'Star daily'] });
    expect(star.texts).toEqual(expect.arrayContaining(['SIX DEGREES', 'OF ROBERT', 'DE NIRO', 'STAR DAILY']));
    expect(star.texts).not.toContain('TIMBERLAKE');
  });
});
