import { afterEach, describe, expect, it, vi } from 'vitest';
import { StaleDataError, loadMeta } from './data';

const respond = (body: string, status: number, type: string) => vi.fn(async () => new Response(body, { status, headers: { 'content-type': type } }));

describe('data files that have gone', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('ask for a reload when the file is missing', async () => {
    vi.stubGlobal('fetch', respond('Not found', 404, 'text/html'));
    await expect(loadMeta()).rejects.toBeInstanceOf(StaleDataError);
  });

  it('ask for a reload when a server answers with a page instead of the file', async () => {
    vi.stubGlobal('fetch', respond('<!doctype html><title>Six Degrees</title>', 200, 'text/html; charset=utf-8'));
    await expect(loadMeta()).rejects.toBeInstanceOf(StaleDataError);
  });

  it('read the file when it is there', async () => {
    vi.stubGlobal('fetch', respond('{"shards":4096}', 200, 'application/json; charset=utf-8'));
    await expect(loadMeta()).resolves.toMatchObject({ shards: 4096 });
  });
});

describe('another star’s distances', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('come from that star’s own shard, with -1 meaning unreachable', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        urls.push(url);
        const body = url.endsWith('meta.json') ? { shards: 4096, targetShards: 1024 } : { 2049: [2, 7, 9], 3073: [-1, 0, 0] };
        return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
      }),
    );
    // A fresh module: the tests above leave a meta.json without targetShards in its cache.
    vi.resetModules();
    const { getReach } = await import('./data');
    await expect(getReach(3454165, 2049)).resolves.toEqual({ dist: 2, parentFilm: 7, parentPerson: 9 });
    await expect(getReach(3454165, 3073)).resolves.toEqual({ dist: Infinity, parentFilm: 0, parentPerson: 0 });
    await expect(getReach(3454165, 1025)).rejects.toThrow(/No one with id Q1025/);
    expect(urls.filter((u) => u.includes('/t/'))).toEqual([expect.stringMatching(/\/t\/3454165\/1\.json$/)]);
  });
});
