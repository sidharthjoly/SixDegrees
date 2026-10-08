/// <reference types="node" />
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { configDefaults, defineConfig } from 'vitest/config';
import { addDays, daysBetween } from './src/days';
import { EPOCH, dailyPick } from './src/logic';

/** The data folder this build reads, written by scripts/build_graph.py. Tests run without data. */
function dataVersion(): string {
  try {
    return JSON.parse(readFileSync('public/data/version.json', 'utf8')).version as string;
  } catch {
    return 'missing';
  }
}

/**
 * Starts the first data downloads from the page itself, alongside the bundle: meta.json and
 * the person the route opens on (today's daily on the home page, a given day's daily, or a
 * free-play star). Otherwise the bundle has to load and run before asking for meta.json, and
 * only then for the person, three trips in a row on a slow phone connection. The page can't
 * work out a daily by itself (that needs the pool in meta.json), so the build writes in which
 * shard each day's pick lives, for the same days as the link-preview pages.
 */
function preloadData(version: string): Plugin {
  return {
    name: 'preload-data',
    transformIndexHtml(html) {
      const metaFile = `public/data/v/${version}/meta.json`;
      if (!existsSync(metaFile)) return html;
      const meta = JSON.parse(readFileSync(metaFile, 'utf8')) as { daily: number[]; shards: number };
      const today = process.env.PREVIEWS_TODAY || new Date().toISOString().slice(0, 10);
      const first = addDays(today, -90) > EPOCH ? addDays(today, -90) : EPOCH;
      const shards = Array.from({ length: daysBetween(first, addDays(today, 45)) + 1 }, (_, i) => dailyPick(meta.daily, addDays(first, i)) % meta.shards);
      const [y, m, d] = first.split('-').map(Number);
      // Plain ES5: it runs as written, before the bundle, on every browser the site supports.
      const code = `(function () {
  var h = location.hash, base = './data/v/${version}/', first = Date.UTC(${y}, ${m - 1}, ${d}), byDay = ${JSON.stringify(shards)}, m, s;
  if (!/^(#\\/?)?$|^#\\/(daily|p|archive)(\\/|\\?|$)/.test(h)) return;
  function preload(path) { var l = document.createElement('link'); l.rel = 'preload'; l.as = 'fetch'; l.crossOrigin = 'anonymous'; l.href = base + path; document.head.appendChild(l); }
  function shardOn(key) { return byDay[Math.round((Date.UTC(+key.slice(0, 4), key.slice(5, 7) - 1, +key.slice(8, 10)) - first) / 864e5)]; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  preload('meta.json');
  if ((m = /^#\\/p\\/(\\d+)/.exec(h))) s = m[1] % ${meta.shards};
  else if ((m = /^#\\/daily\\/(\\d{4}-\\d\\d-\\d\\d)/.exec(h))) s = shardOn(m[1]);
  else if (!/^#\\/archive/.test(h)) { var t = new Date(); s = shardOn(t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate())); }
  if (s != null) preload('p/' + s + '.json');
})();`;
      // Right after the charset (which has to come in the first 1024 bytes), so it runs
      // before the stylesheet: a script after a stylesheet waits for it.
      const charset = '<meta charset="utf-8" />';
      if (!html.includes(charset)) throw new Error('preload-data: index.html has no <meta charset="utf-8" />');
      return html.replace(charset, `${charset}\n    <script>${code}</script>`);
    },
  };
}

/**
 * Restarts the dev server when `npm run data` rebuilds the data. The data version is compiled
 * in when the server starts, and the rebuild deletes the old folder, so an open page would
 * otherwise go on asking for files that are gone.
 */
function restartOnNewData(): Plugin {
  return {
    name: 'restart-on-new-data',
    apply: 'serve',
    configureServer(server) {
      const file = resolve('public/data/version.json');
      server.watcher.add(file);
      server.watcher.on('change', (changed) => {
        if (resolve(changed) === file) void server.restart();
      });
    },
  };
}

export default defineConfig({
  // Relative asset paths, so the build works on the custom domain and on a /repo/ path.
  base: './',
  define: { __DATA_VERSION__: JSON.stringify(dataVersion()) },
  plugins: [preloadData(dataVersion()), restartOnNewData()],
  // Older phones stay on old browsers (an iPhone 7 stops at iOS 15), so newer syntax is
  // rewritten for them. Features a rewrite can't fix are guarded by src/compat.test.ts.
  build: { target: ['es2020', 'safari15', 'chrome100', 'firefox100', 'edge100'] },
  server: { port: 5174, strictPort: true },
  // Agent worktrees live under .claude/; their tests aren't this checkout's.
  test: { exclude: [...configDefaults.exclude, '.claude/**'] },
});
