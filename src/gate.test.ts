import { beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetSiteData, handleWrite, sourceAddress, sourceKey, WRITES, type GateEnv } from './gate';
import { JT } from './logic';
import { A, F1, F2, START, route, siteFile } from './route-fixture';

describe('sourceAddress', () => {
  it('keeps IPv4 addresses as they are', () => {
    expect(sourceAddress('203.0.113.7')).toBe('203.0.113.7');
    expect(sourceAddress(' 203.0.113.7 ')).toBe('203.0.113.7');
  });

  it('counts IPv6 addresses by their /64, however they are written', () => {
    expect(sourceAddress('2001:db8:abcd:12:1:2:3:4')).toBe('2001:db8:abcd:12::/64');
    expect(sourceAddress('2001:DB8:ABCD:0012:ffff:0:0:9')).toBe('2001:db8:abcd:12::/64');
    expect(sourceAddress('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(sourceAddress('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
  });

  it('counts IPv6 addresses by their /48 for the wider cap, and IPv4 as it is', () => {
    expect(sourceAddress('2001:db8:abcd:12:1:2:3:4', 48)).toBe('2001:db8:abcd::/48');
    expect(sourceAddress('2001:db8:abcd:ffff::1', 48)).toBe('2001:db8:abcd::/48');
    expect(sourceAddress('203.0.113.7', 48)).toBe('203.0.113.7');
    expect(sourceAddress('::ffff:203.0.113.7', 48)).toBe('203.0.113.7');
  });

  it('turns IPv4 written as IPv6 back into IPv4', () => {
    expect(sourceAddress('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(sourceAddress('::ffff:cb00:7107')).toBe('203.0.113.7');
  });

  it('keeps anything it can’t read as given', () => {
    expect(sourceAddress('')).toBe('');
    expect(sourceAddress('not:an::ip::at:all')).toBe('not:an::ip::at:all');
    expect(sourceAddress('1:2:3:4:5:6:7:8:9')).toBe('1:2:3:4:5:6:7:8:9');
  });
});

describe('sourceKey', () => {
  it('is a short HMAC that depends on what’s counted and the secret, without the address in it', async () => {
    const a = await sourceKey('2001:db8:abcd:12::/64', 'secret');
    expect(a).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(await sourceKey('2001:db8:abcd:12::/64', 'secret')).toBe(a);
    expect(await sourceKey('2001:db8:abcd:13::/64', 'secret')).not.toBe(a);
    expect(await sourceKey('2001:db8:abcd:12::/64', 'another secret')).not.toBe(a);
    expect(a).not.toContain('2001');
  });
});

describe('handleWrite', () => {
  const ORIGIN = 'https://sixdegrees.example';
  const SUPABASE = 'https://project.supabase.co/rest/v1/rpc/';
  const env: GateEnv = { SUPABASE_URL: 'https://project.supabase.co/', SUPABASE_SECRET_KEY: 'sb_secret_test', SOURCE_SECRET: 'salt' };
  const call = (fn: string, body: unknown, init: { method?: string; headers?: Record<string, string> } = {}) =>
    new Request(`${ORIGIN}/api/rpc/${fn}`, {
      method: init.method ?? 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.7', Origin: ORIGIN, 'Sec-Fetch-Site': 'same-origin', ...init.headers },
      body: init.method === 'GET' ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
  /** The site's data files (route-fixture.ts), and Supabase answering `status` and `body`. */
  const answering = (status: number, body: string) =>
    vi.fn<typeof fetch>(async (input) => siteFile(String(input), ORIGIN) ?? new Response(status === 204 ? null : body, { status }));
  /** What went to Supabase: the function and the arguments. */
  const sentTo = (upstream: ReturnType<typeof answering>) =>
    upstream.mock.calls.filter(([url]) => String(url).startsWith(SUPABASE)).map(([url, init]) => ({ fn: String(url).slice(SUPABASE.length), args: JSON.parse(init?.body as string), init }));
  /** A finished daily on the fixture's graph: START -F1- A -F2- JT, par 2. */
  const result = { p_client: 'c', p_day: '2026-10-09', p_mode: 'normal', p_films: 2, p_hints: 0, p_par: 2, p_gave_up: false, p_late: false, p_first_film: F1, p_route: route([F1, A], [F2, JT]) };
  const join = { p_code: 'abcdefghjk', p_client: 'c', p_player_name: 'Sid' };

  beforeEach(() => forgetSiteData());

  it('passes a write on with the secret key and the connection’s keys, whatever the caller sent', async () => {
    const upstream = answering(204, '');
    const res = await handleWrite(call('sixdegrees_submit', { ...result, p_source: 'forged', p_wide: 'forged', extra: 1, 'p_bad-name': 2 }), env, upstream);
    expect(res.status).toBe(204);
    const [sent] = sentTo(upstream);
    expect(sent.fn).toBe('sixdegrees_submit');
    expect((sent.init?.headers as Record<string, string>).apikey).toBe('sb_secret_test');
    expect((sent.init?.headers as Record<string, string>).Authorization).toBeUndefined();
    const key = await sourceKey('203.0.113.7', 'salt');
    expect(sent.args).toEqual({ ...result, p_source: key, p_wide: key });
  });

  it('keys an IPv6 connection by its /64 and its /48', async () => {
    const upstream = answering(200, '{}');
    await handleWrite(call('sixdegrees_join_group', join, { headers: { 'CF-Connecting-IP': '2001:db8:abcd:12:1:2:3:4' } }), env, upstream);
    await handleWrite(call('sixdegrees_join_group', join, { headers: { 'CF-Connecting-IP': '2001:db8:abcd:99::1' } }), env, upstream);
    const [first, second] = sentTo(upstream).map((s) => s.args);
    expect(first.p_source).toBe(await sourceKey('2001:db8:abcd:12::/64', 'salt'));
    expect(first.p_wide).toBe(await sourceKey('2001:db8:abcd::/48', 'salt'));
    expect(second.p_source).not.toBe(first.p_source);
    expect(second.p_wide).toBe(first.p_wide);
  });

  it('counts everyone on Tor as one connection', async () => {
    const upstream = answering(200, '{}');
    await handleWrite(call('sixdegrees_join_group', join, { headers: { 'CF-Connecting-IP': '198.51.100.1' } }), env, upstream, 'T1');
    await handleWrite(call('sixdegrees_join_group', join, { headers: { 'CF-Connecting-IP': '2001:db8::1' } }), env, upstream, 'T1');
    await handleWrite(call('sixdegrees_join_group', join, { headers: { 'CF-Connecting-IP': '198.51.100.1' } }), env, upstream, 'AU');
    const [a, b, c] = sentTo(upstream).map((s) => s.args);
    expect(a.p_source).toBe(b.p_source);
    expect(a.p_wide).toBe(b.p_wide);
    expect(c.p_source).not.toBe(a.p_source);
  });

  it('sends a legacy JWT key in Authorization too', async () => {
    const upstream = answering(200, '"abc"');
    await handleWrite(call('sixdegrees_new_code', { p_code: 'x' }), { ...env, SUPABASE_SECRET_KEY: 'eyJhbGciOi.test' }, upstream);
    expect((sentTo(upstream)[0].init?.headers as Record<string, string>).Authorization).toBe('Bearer eyJhbGciOi.test');
  });

  it('returns what the database answered', async () => {
    const res = await handleWrite(call('sixdegrees_create_group', { p_player_name: 'Sid' }), env, answering(200, '"abcdefghjk"'));
    expect(res.status).toBe(200);
    expect(await res.json()).toBe('abcdefghjk');
  });

  it('only gates the functions that add rows', async () => {
    expect([...WRITES].sort()).toEqual(['sixdegrees_create_group', 'sixdegrees_hint', 'sixdegrees_join_group', 'sixdegrees_new_code', 'sixdegrees_submit']);
    const upstream = answering(200, '{}');
    for (const fn of ['sixdegrees_day', 'sixdegrees_leave_group', 'anything', '']) {
      expect((await handleWrite(call(fn, {}), env, upstream)).status).toBe(404);
    }
    expect((await handleWrite(new Request(`${ORIGIN}/api/other`, { method: 'POST' }), env, upstream)).status).toBe(404);
    expect((await handleWrite(call('sixdegrees_submit', null, { method: 'GET' }), env, upstream)).status).toBe(405);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('turns away requests from other sites’ pages', async () => {
    const upstream = answering(200, '{}');
    const tries = [
      call('sixdegrees_submit', result, { headers: { 'Content-Type': 'text/plain' } }),
      call('sixdegrees_submit', result, { headers: { Origin: 'https://evil.example' } }),
      call('sixdegrees_submit', result, { headers: { 'Sec-Fetch-Site': 'cross-site' } }),
      call('sixdegrees_submit', result, { headers: { 'Sec-Fetch-Site': 'same-site' } }),
    ];
    for (const req of tries) expect((await handleWrite(req, env, upstream)).status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('refuses bodies that aren’t a call, and names the game wouldn’t make', async () => {
    const upstream = answering(200, '{}');
    for (const body of ['not json', '[1]', 'null', JSON.stringify({ p: 'x'.repeat(5000) })]) {
      expect((await handleWrite(call('sixdegrees_submit', body), env, upstream)).status).toBeGreaterThanOrEqual(400);
    }
    for (const name of ['‮kcab', 'S<b>id', ' Sid', 42]) {
      const res = await handleWrite(call('sixdegrees_join_group', { ...join, p_player_name: name }), env, upstream);
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe('22023');
    }
    expect(upstream).not.toHaveBeenCalled();
  });

  it('passes the database’s own refusals back, so the game can show or act on them', async () => {
    for (const [status, code] of [[400, '54000'], [409, '23505'], [503, '53100'], [400, 'P0001']] as const) {
      const body = JSON.stringify({ code, message: 'No.' });
      const res = await handleWrite(call('sixdegrees_join_group', join), env, answering(status, body));
      expect(res.status).toBe(status);
      expect(await res.json()).toEqual({ code, message: 'No.' });
    }
  });

  it('turns anything else into an outage without a code, so results wait and go again', async () => {
    const cases: (typeof fetch)[] = [
      answering(404, JSON.stringify({ code: 'PGRST202', message: 'Could not find the function' })),
      answering(401, JSON.stringify({ message: 'Invalid API key' })),
      answering(403, JSON.stringify({ code: '42501', message: 'permission denied' })),
      answering(502, '<html>Bad gateway</html>'),
      vi.fn<typeof fetch>(async () => {
        throw new TypeError('network');
      }),
    ];
    for (const upstream of cases) {
      const res = await handleWrite(call('sixdegrees_join_group', join), env, upstream);
      expect(res.status).toBe(503);
      expect((await res.json()).code).toBeUndefined();
    }
  });

  it('is an outage too when the Worker’s secrets aren’t set', async () => {
    const upstream = answering(200, '{}');
    const res = await handleWrite(call('sixdegrees_submit', result), {}, upstream);
    expect(res.status).toBe(503);
    expect(upstream).not.toHaveBeenCalled();
  });

  describe('results', () => {
    it('store what the route shows, not what was claimed', async () => {
      const upstream = answering(204, '');
      await handleWrite(call('sixdegrees_submit', { ...result, p_par: 7, p_films: 7, p_first_film: 999 }), env, upstream);
      expect(sentTo(upstream)[0].args).toMatchObject({ p_par: 2, p_films: 2, p_first_film: F1, p_route: result.p_route });
    });

    it('with a route that isn’t possible are refused for good, and never reach the database', async () => {
      const upstream = answering(204, '');
      for (const bad of [route([F2, JT]), route([F1, A]), 'garbage']) {
        const res = await handleWrite(call('sixdegrees_submit', { ...result, p_route: bad }), env, upstream);
        expect(res.status).toBe(400);
        expect((await res.json()).code).toBe('22023');
      }
      for (const notAResult of [{ ...result, p_day: 'yesterday' }, { ...result, p_mode: 'easy' }, { ...result, p_gave_up: 'no' }, { ...result, p_route: 42 }]) {
        expect((await handleWrite(call('sixdegrees_submit', notAResult), env, upstream)).status).toBe(400);
      }
      expect(sentTo(upstream)).toEqual([]);
    });

    it('too long to check go in as give-ups', async () => {
      const upstream = answering(204, '');
      const long = route(...Array.from({ length: 41 }, (): [number, number] => [F1, A]));
      await handleWrite(call('sixdegrees_submit', { ...result, p_route: long, p_films: 41 }), env, upstream);
      expect(sentTo(upstream)[0].args).toMatchObject({ p_gave_up: true, p_films: 41, p_first_film: null, p_route: null });
    });

    it('from before routes were sent with give-ups keep no films, hints or opener', async () => {
      const upstream = answering(204, '');
      await handleWrite(call('sixdegrees_submit', { ...result, p_gave_up: true, p_route: null, p_films: 3, p_hints: 2, p_first_film: F1 }), env, upstream);
      expect(sentTo(upstream)[0].args).toMatchObject({ p_films: 0, p_hints: 0, p_first_film: null, p_route: null, p_par: 2 });
    });

    it('wait and go again later if the game’s data can’t be read', async () => {
      const upstream = vi.fn<typeof fetch>(async (input) => (String(input).includes('/data/') ? new Response('Not found', { status: 404 }) : new Response(null, { status: 204 })));
      const res = await handleWrite(call('sixdegrees_submit', result), env, upstream);
      expect(res.status).toBe(503);
      expect((await res.json()).code).toBeUndefined();
      expect(upstream.mock.calls.some(([url]) => String(url).startsWith(SUPABASE))).toBe(false);
    });

    it('read the data once and keep it for the next', async () => {
      const upstream = answering(204, '');
      await handleWrite(call('sixdegrees_submit', result), env, upstream);
      await handleWrite(call('sixdegrees_submit', { ...result, p_client: 'd' }), env, upstream);
      const reads = upstream.mock.calls.map(([url]) => String(url)).filter((url) => url.includes('/data/'));
      expect(reads.filter((url) => url.endsWith('version.json'))).toHaveLength(1);
      expect(new Set(reads).size).toBe(reads.length);
      expect(sentTo(upstream)).toHaveLength(2);
    });
  });

  it('passes a real time zone’s offset on, and refuses anything else', async () => {
    for (const p_offset of [660, -420, 345, -720, 840, 0, null]) {
      const upstream = answering(200, '{}');
      expect((await handleWrite(call('sixdegrees_join_group', { ...join, p_offset }), env, upstream)).status).toBe(200);
      expect(sentTo(upstream)[0].args.p_offset).toBe(p_offset);
    }
    for (const p_offset of [7, 841, -735, 60.5, '660']) {
      const upstream = answering(200, '{}');
      const res = await handleWrite(call('sixdegrees_join_group', { ...join, p_offset }), env, upstream);
      expect(res.status).toBe(400);
      expect(sentTo(upstream)).toEqual([]);
    }
  });

  describe('hints', () => {
    const ask = { p_client: 'c', p_day: '2026-10-09', p_mode: 'normal', p_person: START };

    it('are recorded first, then answered with the next step of a shortest route', async () => {
      const upstream = answering(204, '');
      const res = await handleWrite(call('sixdegrees_hint', ask), env, upstream);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ film: F1, person: A });
      expect(sentTo(upstream)).toMatchObject([{ fn: 'sixdegrees_hint', args: ask }]);
    });

    it('aren’t given when the database won’t record them', async () => {
      const busy = await handleWrite(call('sixdegrees_hint', ask), env, answering(400, JSON.stringify({ code: '54000', message: 'Lots of hints today.' })));
      expect(busy.status).toBe(400);
      expect(await busy.json()).toEqual({ code: '54000', message: 'Lots of hints today.' });
      const away = await handleWrite(call('sixdegrees_hint', ask), env, answering(404, JSON.stringify({ code: 'PGRST202', message: 'Could not find the function' })));
      expect(away.status).toBe(503);
      expect(await away.json()).not.toHaveProperty('film');
    });

    it('don’t exist in hard mode, at JT, or for someone the game doesn’t have', async () => {
      const upstream = answering(204, '');
      for (const bad of [{ ...ask, p_mode: 'hard' }, { ...ask, p_person: JT }, { ...ask, p_person: 999 }, { ...ask, p_person: '100' }, { ...ask, p_day: 'today' }]) {
        const res = await handleWrite(call('sixdegrees_hint', bad), env, upstream);
        expect(res.status).toBe(400);
        expect((await res.json()).code).toBe('22023');
      }
      expect(sentTo(upstream)).toEqual([]);
    });
  });
});
