/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { configDefaults, defineConfig } from 'vitest/config';

/** The data folder this build reads, written by scripts/build_graph.py. Tests run without data. */
function dataVersion(): string {
  try {
    return JSON.parse(readFileSync('public/data/version.json', 'utf8')).version as string;
  } catch {
    return 'missing';
  }
}

export default defineConfig({
  // Relative asset paths, so the build works on the custom domain and on a /repo/ path.
  base: './',
  define: { __DATA_VERSION__: JSON.stringify(dataVersion()) },
  // Older phones stay on old browsers (an iPhone 7 stops at iOS 15), so newer syntax is
  // rewritten for them. Features a rewrite can't fix are guarded by src/compat.test.ts.
  build: { target: ['es2020', 'safari15', 'chrome100', 'firefox100', 'edge100'] },
  server: { port: 5174, strictPort: true },
  // Agent worktrees live under .claude/; their tests aren't this checkout's.
  test: { exclude: [...configDefaults.exclude, '.claude/**'] },
});
