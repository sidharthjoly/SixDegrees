/*
 * Link previews, run after `vite build` (see package.json). For every daily from 90 days ago
 * (or the first daily, if later) through 45 days from now it writes:
 *   dist/og/<date>.png             the day's sticker, 1200×630, drawn by src/card.ts
 *   dist/d/<date>/index.html       Open Graph tags, then on to #/daily/<date>
 *   dist/d/<date>/hard/index.html  the same for hard mode
 * plus dist/og/home.png for the home page, dist/404.html, and the absolute URLs in
 * dist/index.html's preview tags.
 *
 * Env: SITE_URL, the deployed address (default http://localhost:4173/, `vite preview`'s).
 *      PREVIEWS_TODAY, a YYYY-MM-DD to build as if it were that day (for testing).
 *
 * Run as `node scripts/previews.ts`: Node strips the types, so imports name the .ts files.
 */
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drawPreviewCard, PREVIEW_HEIGHT, PREVIEW_WIDTH, type PreviewCard } from '../src/card.ts';
import { EPOCH, dailyPick, dayNumber } from '../src/logic.ts';
import { dailyPage, displaySite, imagePath, normalizeSite, notFoundPage, pagePath, previewDays, shortDate, type PreviewMode } from '../src/preview-pages.ts';
import type { Meta, PersonRow, Qid } from '../src/types.ts';

/** The site rebuilds at least monthly; pages this far ahead cover links shared until the next build. */
const AHEAD_DAYS = 45;
/**
 * Only the last 90 days get pages. Otherwise the window grows by a day forever (about 42 MB
 * of images a year); older shared links still reach the game through 404.html, and
 * chat apps keep the previews they already fetched.
 */
const BEHIND_DAYS = 90;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const FONTS = join(ROOT, 'assets/fonts');

function registerFonts(): void {
  const fonts: [string, string][] = [
    ['rubik-mono-one/RubikMonoOne-Regular.ttf', 'Rubik Mono One'],
    ['chakra-petch/ChakraPetch-Medium.ttf', 'Chakra Petch'],
    ['chakra-petch/ChakraPetch-SemiBold.ttf', 'Chakra Petch'],
    ['chakra-petch/ChakraPetch-Bold.ttf', 'Chakra Petch'],
  ];
  for (const [file, family] of fonts) {
    // Without the real font Skia silently substitutes another, so fail instead.
    if (!GlobalFonts.registerFromPath(join(FONTS, file), family)) throw new Error(`Couldn't load font ${file}`);
  }
  const weights = (family: string) => GlobalFonts.families.find((f) => f.family === family)?.styles.map((s) => s.weight) ?? [];
  const missing = [
    ['Rubik Mono One', 400],
    ['Chakra Petch', 500],
    ['Chakra Petch', 600],
    ['Chakra Petch', 700],
  ].filter(([family, weight]) => !weights(String(family)).includes(Number(weight)));
  if (missing.length) throw new Error(`Fonts missing after registering: ${missing.map(([f, w]) => `${f} ${w}`).join(', ')}`);
}

function write(path: string, data: string | Buffer): void {
  const full = join(DIST, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, data);
}

/** Draw on the main thread, encode PNGs on the thread pool, a few at a time. */
function imageWriter(): { add(path: string, card: PreviewCard): Promise<void>; done(): Promise<void> } {
  const limit = Math.max(2, availableParallelism());
  const inflight = new Set<Promise<void>>();
  return {
    async add(path, card) {
      const canvas = createCanvas(PREVIEW_WIDTH, PREVIEW_HEIGHT);
      drawPreviewCard(canvas.getContext('2d'), card);
      const job: Promise<void> = canvas.encode('png').then((png) => {
        write(path, png);
        inflight.delete(job);
      });
      inflight.add(job);
      if (inflight.size >= limit) await Promise.race(inflight);
    },
    async done() {
      await Promise.all(inflight);
    },
  };
}

interface DataFiles {
  meta: Meta;
  person(id: Qid): PersonRow;
}

/** The data `vite build` copied into dist, the same files the deployed game reads. */
function loadData(): DataFiles | null {
  const versionFile = join(DIST, 'data/version.json');
  if (!existsSync(versionFile)) return null;
  const { version } = JSON.parse(readFileSync(versionFile, 'utf8')) as { version: string };
  const base = join(DIST, 'data/v', version);
  const meta = JSON.parse(readFileSync(join(base, 'meta.json'), 'utf8')) as Meta;
  const shards = new Map<number, Record<string, PersonRow>>();
  return {
    meta,
    person(id) {
      const k = id % meta.shards;
      let shard = shards.get(k);
      if (!shard) {
        shard = JSON.parse(readFileSync(join(base, `p/${k}.json`), 'utf8')) as Record<string, PersonRow>;
        shards.set(k, shard);
      }
      const row = shard[id];
      if (!row) throw new Error(`Daily pick Q${id} is missing from person shard ${k}`);
      return row;
    },
  };
}

/** Fill in the home page's preview tags, which need absolute URLs (index.html has %SITE_URL%). */
function rewriteIndex(site: string): void {
  const file = join(DIST, 'index.html');
  const html = readFileSync(file, 'utf8');
  if (!html.includes('%SITE_URL%')) throw new Error('dist/index.html has no %SITE_URL% to fill in; did index.html lose its preview tags?');
  writeFileSync(file, html.replaceAll('%SITE_URL%', site));
}

async function main(): Promise<void> {
  const started = performance.now();
  if (!existsSync(join(DIST, 'index.html'))) throw new Error('Run `vite build` first: dist/index.html is missing');
  const site = normalizeSite(process.env.SITE_URL || 'http://localhost:4173/');
  const today = process.env.PREVIEWS_TODAY || new Date().toISOString().slice(0, 10);
  registerFonts();
  const images = imageWriter();
  const footer = displaySite(site);

  await images.add('og/home.png', {
    tag: 'Daily',
    name: 'A new star every midnight',
    foot: 'Free to play',
    pills: ['Film trivia'],
    blurb: 'Link any actor, athlete or filmmaker to Justin Timberlake through the films they share.',
    site: footer,
  });
  rewriteIndex(site);
  write('404.html', notFoundPage());

  const data = loadData();
  if (!data) {
    // CI always builds the data first; a local build without it still gets the rest.
    if (process.env.CI) throw new Error('No game data in dist/data: run `npm run data` before building');
    console.warn('previews: no game data in dist/data, so no daily pages (run `npm run data` first)');
    await images.done();
    return;
  }

  const lookback = new Date(Date.parse(`${today}T00:00:00Z`) - BEHIND_DAYS * 86_400_000).toISOString().slice(0, 10);
  const days = previewDays(lookback > EPOCH ? lookback : EPOCH, today, AHEAD_DAYS);
  for (const day of days) {
    const [name, , dist, , , , hardDist] = data.person(dailyPick(data.meta.daily, day));
    const number = dayNumber(day);
    // The image is the same for both modes (it shows the date, not the par), so one per day.
    await images.add(imagePath(day), {
      tag: `Daily #${number}`,
      name,
      foot: shortDate(day),
      pills: [`Daily #${number}`],
      blurb: `Connect ${name} to Justin Timberlake through the films they share.`,
      site: footer,
    });
    const pars: [PreviewMode, number][] = [['normal', dist], ['hard', hardDist]];
    for (const [mode, par] of pars) {
      // The daily pool only holds people hard mode can reach, but don't publish "Par -1" if that changes.
      if (par < 0) continue;
      write(pagePath(day, mode) + 'index.html', dailyPage({ site, day, number, mode, name, par }));
    }
  }
  await images.done();
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  console.log(`previews: ${days.length} dailies (${days[0]} to ${days.at(-1)}) for ${site} in ${seconds}s`);
}

await main();
