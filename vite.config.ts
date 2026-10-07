/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

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
  server: { port: 5174, strictPort: true },
});
