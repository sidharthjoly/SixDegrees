import { describe, expect, it } from 'vitest';
import { MAX_MOVES, MAX_NAME_LENGTH, checksum, cleanName, compareResults, decodeChallenge, encodeChallenge, isValidName, sideOf, type Challenge } from './challenge-code';
import { JT, type MoveSummary } from './logic';
import { MAX_VS_LENGTH, href, parseRoute } from './router';

const m = (grade: MoveSummary['grade'], hinted = false): MoveSummary => ({ grade, hinted });

// Ronaldo -> Goal III -> Beckham -> U.N.C.L.E. -> someone -> U.N.C.L.E. -> Hammer -> The Social Network -> JT.
const finished: Challenge = {
  start: 11571,
  mode: 'normal',
  moves: [m('closer'), m('same', true), m('closer'), m('closer')],
  gaveUp: false,
  path: [
    [3, 10],
    [2, 13],
    [2, 11],
    [185888, JT],
  ],
  name: 'Sam',
};

const variants: Record<string, Challenge> = {
  finished,
  'no name': { ...finished, name: null },
  'no path': { ...finished, path: null },
  'no name or path': { ...finished, name: null, path: null },
  'gave up at 0 moves': { ...finished, moves: [], path: null, gaveUp: true, name: null },
  'gave up part way': { ...finished, moves: [m('closer'), m('further')], path: [[3, 10], [4, 99]], gaveUp: true },
  hard: { ...finished, mode: 'hard', moves: finished.moves.map((x) => ({ ...x, hinted: false })) },
  'unicode name': { ...finished, name: 'Zoë 李小龍' },
  'big qids': { ...finished, path: [[123_456_789, 98_765_432], [130_000_000, JT]], moves: [m('closer'), m('closer')] },
};

const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

describe('challenge codes', () => {
  it.each(Object.entries(variants))('round-trip: %s', (_label, c) => {
    const code = encodeChallenge(c)!;
    // Chat apps strip a trailing "." from links, so codes must end in a letter or digit.
    expect(code).toMatch(/[0-9a-z]$/);
    // URL-safe as-is: nothing for encodeURIComponent to escape.
    expect(encodeURIComponent(code)).toBe(code);
    expect(decodeChallenge(code)).toEqual(c);
  });

  it('survive the router', () => {
    const code = encodeChallenge(finished)!;
    const route = parseRoute(href({ name: 'daily', day: '2026-10-08', mode: 'normal', vs: code }));
    expect(route).toMatchObject({ vs: code });
  });

  it('are compact', () => {
    expect(encodeChallenge(finished)!.length).toBeLessThan(60);
  });

  it('drop the path rather than exceed the link cap, keeping the grades', () => {
    const long: Challenge = {
      ...finished,
      moves: [...Array(40).fill(m('same')), m('closer')],
      path: [...Array.from({ length: 40 }, (_, i): [number, number] => [100_000_000 + i, 120_000_000 + i]), [185888, JT]],
    };
    const code = encodeChallenge(long)!;
    expect(code.length).toBeLessThanOrEqual(MAX_VS_LENGTH);
    expect(code).toMatch(/[0-9a-z]$/);
    expect(decodeChallenge(code)).toEqual({ ...long, path: null });
  });

  it('refuse an absurdly long game', () => {
    expect(encodeChallenge({ ...finished, moves: [...Array(MAX_MOVES).fill(m('same')), m('closer')], path: null })).toBeNull();
  });

  it('fit the longest game they accept, with the longest name, under the cap', () => {
    const c: Challenge = { ...finished, moves: [...Array(MAX_MOVES - 1).fill(m('same')), m('closer')], path: null, name: '𝓩'.repeat(MAX_NAME_LENGTH) };
    const code = encodeChallenge(c)!;
    expect(code.length).toBeLessThanOrEqual(MAX_VS_LENGTH);
    expect(decodeChallenge(code)).toEqual(c);
  });

  it('ignore a path of the wrong length', () => {
    expect(decodeChallenge(encodeChallenge({ ...finished, path: [[3, 10]] })!)).toEqual({ ...finished, path: null });
  });

  it('clean the name on the way in', () => {
    expect(decodeChallenge(encodeChallenge({ ...finished, name: '  <b>Sam</b>  ' })!)?.name).toBe('b Sam b');
    expect(decodeChallenge(encodeChallenge({ ...finished, name: '!!!' })!)?.name).toBeNull();
  });
});

describe('decodeChallenge rejects', () => {
  const good = encodeChallenge(finished)!;
  const fields = good.split('.').slice(0, 6);
  /** Re-sign an edited code, so these tests reach the field checks behind the checksum. */
  const sign = (f: string[]) => `${f.join('.')}.${checksum(f.join('.'))}`;
  const edit = (i: number, value: string) => sign(fields.map((f, j) => (j === i ? value : f)));

  it('nothing it should accept (the helpers work)', () => {
    expect(sign(fields)).toBe(good);
    expect(decodeChallenge(edit(5, b64('Al')))?.name).toBe('Al');
    expect(decodeChallenge(edit(5, ''))?.name).toBeNull();
  });

  it('junk', () => {
    for (const bad of ['', 'x', '1', '......', '1.8bl.nf.c...', 'null', '<script>alert(1)</script>', good + '.', good + '.x', good.slice(0, -1), good.toUpperCase()]) {
      expect(decodeChallenge(bad)).toBeNull();
    }
  });

  it('a bad checksum (a truncated or hand-edited link)', () => {
    expect(decodeChallenge(good.slice(0, -1) + (good.endsWith('0') ? '1' : '0'))).toBeNull();
    expect(decodeChallenge(good.replace('.nf.', '.ng.'))).toBeNull();
    expect(decodeChallenge(good.slice(0, good.lastIndexOf('.')))).toBeNull();
  });

  it('an unknown version', () => {
    expect(decodeChallenge(edit(0, '2'))).toBeNull();
  });

  it('bad start QIDs', () => {
    for (const bad of ['', '0', '0a', 'A1', '-1', '12345678', JT.toString(36), '1_5']) expect(decodeChallenge(edit(1, bad))).toBeNull();
  });

  it('bad flags', () => {
    for (const bad of ['', 'n', 'nx', 'xf', 'nff', 'NF']) expect(decodeChallenge(edit(2, bad))).toBeNull();
  });

  it('bad moves', () => {
    expect(decodeChallenge(edit(3, 'cScx'))).toBeNull();
    expect(decodeChallenge(edit(3, ''))).toBeNull(); // a finished game has at least one move
    expect(decodeChallenge(edit(3, 'cScs'))).toBeNull(); // and ends a step closer
    expect(decodeChallenge(edit(3, 'c'.repeat(MAX_MOVES + 1)))).toBeNull();
  });

  it('hints in hard mode', () => {
    const hard = encodeChallenge(variants.hard)!.split('.').slice(0, 6);
    expect(decodeChallenge(sign(hard))).not.toBeNull();
    hard[3] = 'cScc';
    expect(decodeChallenge(sign(hard))).toBeNull();
  });

  it('a path that does not match the moves', () => {
    const jt = JT.toString(36);
    expect(decodeChallenge(edit(4, `3-a_2-d_2-b_1-${jt}`))).not.toBeNull();
    for (const bad of [
      '3-a_2-d_2-b', // one step short
      `3-a_2-d_2-b_1-${jt}_1-${jt}`, // one too many
      '3-a_2-d_2-b_x',
      `3-a_2-d_2-b_-${jt}`,
      `3-a_2-d_2-b_0-${jt}`,
      `3-a-1_2-d_2-b_1-${jt}`,
      '3-a_2-d_2-b_1-b', // finished but doesn't end on JT
      `3-${jt}_2-d_2-b_1-${jt}`, // JT mid-game
    ]) {
      expect(decodeChallenge(edit(4, bad))).toBeNull();
    }
  });

  it('a gave-up path that ends on JT', () => {
    const f = encodeChallenge(variants['gave up part way'])!.split('.').slice(0, 6);
    expect(decodeChallenge(sign(f))).not.toBeNull();
    f[4] = `3-a_4-${JT.toString(36)}`;
    expect(decodeChallenge(sign(f))).toBeNull();
  });

  it('bad names', () => {
    for (const bad of [
      b64('<img src=x onerror=alert(1)>'),
      b64('x'.repeat(MAX_NAME_LENGTH + 1)),
      b64(' Sam'),
      b64('Sam‮gnp.exe'), // right-to-left override
      b64('á́́'), // stacked combining marks
      b64('é'), // not NFC
      b64('�'),
      'U2Ft=', // padding
      'U2F!',
      'A', // impossible length
      'QWx', // "Al" is QWw: same bytes, different spare bits
      '_w', // invalid UTF-8
    ]) {
      expect(decodeChallenge(edit(5, bad))).toBeNull();
    }
  });
});

describe('names', () => {
  it('accepts ordinary names', () => {
    for (const ok of ['Sam', 'Mary-Jane', "O'Neil", 'Zoë', '李小龍', 'J.T. fan 2', 'Ana María']) expect(isValidName(ok)).toBe(true);
  });

  it('rejects the rest', () => {
    for (const bad of ['', ' ', 'a  b', '-Sam', 'Sam ', '😀', 'a<b', 'x'.repeat(21), 'a​b']) expect(isValidName(bad)).toBe(false);
  });

  it('cleans typed names', () => {
    expect(cleanName('  Sam   the  man ')).toBe('Sam the man');
    expect(cleanName('😀 Sam 😀')).toBe('Sam');
    expect(cleanName('x'.repeat(30))).toBe('x'.repeat(20));
    expect(cleanName('é')).toBe('é');
    expect(cleanName('<>&"')).toBe('');
    // NFC folds the first mark into "á"; the stack after it is cut to two.
    expect(cleanName('á̂̃̄')).toBe('á̂̃');
    expect(isValidName(cleanName('abcdefghijklmnopqrs tuvwxyz'))).toBe(true);
  });
});

describe('compareResults', () => {
  const side = (films: number, hints = 0, gaveUp = false) => ({ films, hints, gaveUp });

  it('fewer films wins', () => {
    expect(compareResults(side(3), side(4))).toEqual({ outcome: 'win', reason: 'films' });
    expect(compareResults(side(5, 0), side(4, 3))).toEqual({ outcome: 'lose', reason: 'films' });
  });

  it('giving up loses, however short', () => {
    expect(compareResults(side(1, 0, true), side(9, 2))).toEqual({ outcome: 'lose', reason: 'gaveUp' });
    expect(compareResults(side(9, 2), side(1, 0, true))).toEqual({ outcome: 'win', reason: 'gaveUp' });
    expect(compareResults(side(2, 0, true), side(5, 0, true))).toEqual({ outcome: 'draw', reason: 'bothGaveUp' });
  });

  it('hints break a tie on films', () => {
    expect(compareResults(side(4, 0), side(4, 1))).toEqual({ outcome: 'win', reason: 'hints' });
    expect(compareResults(side(4, 2), side(4, 1))).toEqual({ outcome: 'lose', reason: 'hints' });
    expect(compareResults(side(4, 1), side(4, 1))).toEqual({ outcome: 'draw', reason: 'tie' });
  });

  it('builds a side from moves', () => {
    expect(sideOf([m('closer', true), m('same'), m('closer', true)], false)).toEqual({ films: 3, hints: 2, gaveUp: false });
  });
});
