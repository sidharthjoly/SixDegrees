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
