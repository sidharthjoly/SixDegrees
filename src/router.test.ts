import { describe, expect, it } from 'vitest';
import { MAX_VS_LENGTH, href, parseRoute, type Route } from './router';

describe('parseRoute', () => {
  it('reads every route', () => {
    expect(parseRoute('')).toEqual({ name: 'home' });
    expect(parseRoute('#/')).toEqual({ name: 'home' });
    expect(parseRoute('#/daily')).toEqual({ name: 'daily', day: null, mode: 'normal', vs: null });
    expect(parseRoute('#/daily/2026-10-08')).toEqual({ name: 'daily', day: '2026-10-08', mode: 'normal', vs: null });
    expect(parseRoute('#/daily/2026-10-08/hard?vs=abc')).toEqual({ name: 'daily', day: '2026-10-08', mode: 'hard', vs: 'abc' });
    expect(parseRoute('#/p/11571')).toEqual({ name: 'play', qid: 11571, mode: 'normal', vs: null });
    expect(parseRoute('#/p/11571/hard')).toEqual({ name: 'play', qid: 11571, mode: 'hard', vs: null });
    expect(parseRoute('#/archive')).toEqual({ name: 'archive' });
    expect(parseRoute('#/stats')).toEqual({ name: 'stats' });
  });

  it('rejects malformed routes instead of guessing', () => {
    for (const bad of ['#/daily/yesterday', '#/daily/2026-10-08/easy', '#/p/abc', '#/p/1/hard/x', '#/nope', '#/stats/x']) {
      expect(parseRoute(bad)).toEqual({ name: 'unknown' });
    }
  });

  it('ignores an oversized challenge code', () => {
    const long = 'x'.repeat(MAX_VS_LENGTH + 1);
    expect(parseRoute(`#/p/1?vs=${long}`)).toEqual({ name: 'play', qid: 1, mode: 'normal', vs: null });
  });
});

describe('href', () => {
  it('round-trips through parseRoute', () => {
    const routes: Route[] = [
      { name: 'home' },
      { name: 'daily', day: '2026-10-08', mode: 'hard', vs: 'a b+c' },
      { name: 'daily', day: '2026-10-09', mode: 'normal', vs: null },
      { name: 'play', qid: 11571, mode: 'normal', vs: 'xyz' },
      { name: 'play', qid: 7, mode: 'hard', vs: null },
      { name: 'archive' },
      { name: 'stats' },
    ];
    for (const r of routes) expect(parseRoute(href(r))).toEqual(r);
  });
});
