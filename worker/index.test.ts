import { afterEach, describe, expect, it, vi } from 'vitest';
import { forgetSiteData } from '../src/gate';
import { JT } from '../src/logic';
import { A, F1, F2, route, siteFile } from '../src/route-fixture';
import worker from './index';

describe('the Worker', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    forgetSiteData();
  });
  const env = { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_test', SOURCE_SECRET: 'salt' };
  const post = (path: string, body: unknown) =>
    new Request(`https://sixdegrees.example${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' }, body: JSON.stringify(body) });

  it('handles /api/ itself and never passes it on to the site', async () => {
    const fetched: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        fetched.push(input instanceof Request ? input.url : String(input));
        return new Response('null', { status: 200 });
      }),
    );
    const join = { p_code: 'abcdefghjk', p_client: 'c', p_player_name: 'Sid' };
    expect((await worker.fetch(post('/api/rpc/sixdegrees_join_group', join), env)).status).toBe(200);
    expect((await worker.fetch(post('/api/rpc/sixdegrees_day', {}), env)).status).toBe(404);
    expect((await worker.fetch(post('/api/', {}), env)).status).toBe(404);
    expect(fetched).toEqual(['https://project.supabase.co/rest/v1/rpc/sixdegrees_join_group']);
  });

  it('reads the game’s data to check a result, asking Cloudflare to keep the versioned files', async () => {
    const cached: Record<string, unknown> = {};
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit & { cf?: unknown }) => {
        const url = String(input);
        cached[url] = init?.cf;
        return siteFile(url, 'https://sixdegrees.example') ?? new Response(null, { status: 204 });
      }),
    );
    const result = { p_client: 'c', p_day: '2026-10-09', p_mode: 'normal', p_films: 2, p_hints: 0, p_par: 2, p_gave_up: false, p_late: false, p_first_film: F1, p_route: route([F1, A], [F2, JT]) };
    expect((await worker.fetch(post('/api/rpc/sixdegrees_submit', result), env)).status).toBe(204);
    expect(cached['https://sixdegrees.example/data/version.json']).toBeUndefined();
    expect(cached['https://sixdegrees.example/data/v/test/meta.json']).toEqual({ cacheEverything: true, cacheTtl: 86_400 });
  });

  it('passes other pages through to the site', async () => {
    const page = new Response('<html></html>', { headers: { 'content-type': 'text/html' } });
    vi.stubGlobal('fetch', vi.fn(async () => page));
    expect(await worker.fetch(new Request('https://sixdegrees.example/d/2026-10-09/'), {})).toBe(page);
  });
});
