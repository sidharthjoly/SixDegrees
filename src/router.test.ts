import { describe, expect, it } from 'vitest';
import { MAX_VS_LENGTH, href, parseRoute, type Route } from './router';

describe('parseRoute', () => {
  it('reads every route', () => {
    expect(parseRoute('')).toEqual({ name: 'home' });
    expect(parseRoute('#/')).toEqual({ name: 'home' });
    expect(parseRoute('#/daily')).toEqual({ name: 'daily', day: null, mode: 'normal', vs: null });
    expect(parseRoute('#/daily/2026-10-08')).toEqual({ name: 'daily', day: '2026-10-08', mode: 'normal', vs: null });
    expect(parseRoute('#/daily/2026-10-08/hard?vs=abc')).toEqual({ name: 'daily', day: '2026-10-08', mode: 'hard', vs: 'abc' });
    expect(parseRoute('#/daily/2026-10-08/star')).toEqual({ name: 'daily', day: '2026-10-08', mode: 'star', vs: null });
    expect(parseRoute('#/daily/2026-10-08/bollywood')).toEqual({ name: 'daily', day: '2026-10-08', mode: 'bollywood', vs: null });
    expect(parseRoute('#/daily/2026-10-08/bollywood-hard')).toEqual({ name: 'daily', day: '2026-10-08', mode: 'bollywood-hard', vs: null });
    expect(href({ name: 'daily', day: '2026-10-08', mode: 'bollywood-hard', vs: null })).toBe('#/daily/2026-10-08/bollywood-hard');
    expect(parseRoute('#/p/11571')).toEqual({ name: 'play', qid: 11571, mode: 'normal', vs: null });
    expect(parseRoute('#/p/11571/hard')).toEqual({ name: 'play', qid: 11571, mode: 'hard', vs: null });
    expect(parseRoute('#/p/11571/to/3454165?vs=abc')).toEqual({ name: 'play', qid: 11571, mode: 'normal', vs: 'abc', target: 3454165 });
    expect(parseRoute('#/archive')).toEqual({ name: 'archive' });
    expect(parseRoute('#/stats')).toEqual({ name: 'stats' });
    expect(parseRoute('#/g/nhdxc4tcbv')).toEqual({ name: 'group', code: 'nhdxc4tcbv' });
    expect(parseRoute('#/g/NHDXC4TCBV')).toEqual({ name: 'group', code: 'nhdxc4tcbv' });
  });

  it('rejects malformed routes instead of guessing', () => {
    const stars = ['#/p/1/to', '#/p/1/to/x', '#/p/1/to/2/hard', '#/p/1/hard/to/2', '#/p/1/to/2/3', '#/p/1/star', '#/daily/2026-10-08/star/hard', '#/p/1/bollywood', '#/daily/2026-10-08/bollywood/star', '#/p/1/bollywood-hard', '#/p/1/to/9535/bollywood-hard', '#/daily/2026-10-08/bollywood/hard'];
    for (const bad of ['#/daily/yesterday', '#/daily/2026-10-08/easy', '#/p/abc', '#/p/1/hard/x', '#/nope', '#/stats/x', '#/g', '#/g/a b', '#/g/abc/x', ...stars]) {
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
      { name: 'daily', day: '2026-10-09', mode: 'star', vs: 'xyz' },
      { name: 'play', qid: 11571, mode: 'normal', vs: 'xyz' },
      { name: 'play', qid: 7, mode: 'hard', vs: null },
      { name: 'play', qid: 7, mode: 'normal', vs: 'xyz', target: 3454165 },
      { name: 'archive' },
      { name: 'stats' },
      { name: 'group', code: 'nhdxc4tcbv' },
    ];
    for (const r of routes) expect(parseRoute(href(r))).toEqual(r);
  });
});
