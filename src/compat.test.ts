import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * The site supports Safari 15 (iPhone 7 and other phones stuck on iOS 15). Most newer
 * syntax is rewritten by the build (vite.config.ts), but a regex literal with lookbehind
 * can't be: Safari before 16.4 rejects it while parsing, so one anywhere in the bundle
 * stops the whole site loading. The build doesn't warn about it, so check the source.
 */

const SRC = join(import.meta.dirname, '.');

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path);
    return /\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [path] : [];
  });
}

describe('old Safari compatibility', () => {
  it('uses no regex lookbehind, which Safari before 16.4 cannot parse', () => {
    const offenders = sources(SRC).filter((f) => /\(\?<[=!]/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
