/*
 * Link previews, run after `vite build` (see package.json). For every daily from 90 days ago
 * (or the first daily, if later) through 45 days from now it writes:
 *   dist/og/<date>.png             the day's sticker, 1200×630, drawn by src/card.ts
 *   dist/d/<date>/index.html       the game's page with that day's Open Graph tags
 *   dist/d/<date>/hard/index.html  the same for hard mode
 *   dist/og/<date>-star.png        the star daily's (the day's start, heading for its star)
 *   dist/d/<date>/star/index.html  the star daily's page
 *   dist/og/<date>-bollywood.png   the Bollywood daily's, and its pages under d/<date>/bollywood/
 *                                  and d/<date>/bollywood-hard/
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
import { EPOCH, bollywoodOfDay, dailyPick, dayNumber, starOfDay } from '../src/logic.ts';
import { dailyPage, displaySite, imagePath, normalizeSite, notFoundPage, pagePath, previewDays, shortDate, type PreviewMode } from '../src/preview-pages.ts';
import type { BollywoodFile, Meta, PersonRow, Qid, TargetRow } from '../src/types.ts';

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
  /** bollywood.json, or null for data from before Bollywood mode. */
  bollywood: BollywoodFile | null;
  person(id: Qid): PersonRow;
  /** A person's row towards one of the other stars (`hard`: without Bollywood hard mode's banned films), or undefined. */
  toward(star: Qid, id: Qid, hard?: boolean): TargetRow | undefined;
}

/** The data `vite build` copied into dist, the same files the deployed game reads. */
function loadData(): DataFiles | null {
  const versionFile = join(DIST, 'data/version.json');
  if (!existsSync(versionFile)) return null;
  const { version } = JSON.parse(readFileSync(versionFile, 'utf8')) as { version: string };
  const base = join(DIST, 'data/v', version);
  const meta = JSON.parse(readFileSync(join(base, 'meta.json'), 'utf8')) as Meta;
  const bollywoodFile = join(base, 'bollywood.json');
  const bollywood = existsSync(bollywoodFile) ? (JSON.parse(readFileSync(bollywoodFile, 'utf8')) as BollywoodFile) : null;
  const shards = new Map<number, Record<string, PersonRow>>();
  const starShards = new Map<string, Record<string, TargetRow>>();
  return {
    meta,
    bollywood,
    toward(star, id, hard = false) {
      const file = join(base, `t/${star}${hard ? '-hard' : ''}/${id % meta.targetShards}.json`);
      let shard = starShards.get(file);
      if (!shard) {
        shard = JSON.parse(readFileSync(file, 'utf8')) as Record<string, TargetRow>;
        starShards.set(file, shard);
      }
      return shard[id];
    },
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
  // Each daily's page is the game's own page with that day's preview tags.
  const app = readFileSync(join(DIST, 'index.html'), 'utf8');
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
  let starDays = 0;
  let bollywoodDays = 0;
  for (const day of days) {
    const start = dailyPick(data.meta.daily, day);
    const [name, , dist, , , , hardDist] = data.person(start);
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
      write(pagePath(day, mode) + 'index.html', dailyPage({ site, day, number, mode, name, par }, app));
    }
    // The star daily, picked as the game and the Worker pick it.
    const targets = data.meta.targets ?? [];
    const found = await starOfDay(
      targets,
      day,
      start,
      async (s) => {
        const row = data.toward(s, start);
        return row && row[0] >= 0 ? row[0] : Infinity;
      },
    );
    const star = found && targets.find((t) => t.id === found.id);
    // The Bollywood daily, from its own start to Shah Rukh Khan, in either mode.
    const bolly = data.bollywood && bollywoodOfDay(data.bollywood, day);
    const bollyStar = bolly && targets.find((t) => t.id === bolly.goal);
    const bollyPar = bolly ? data.toward(bolly.goal, bolly.start)?.[0] : undefined;
    if (bolly && bollyStar && bollyPar !== undefined && bollyPar >= 0) {
      bollywoodDays++;
      const [bollyName] = data.person(bolly.start);
      const hardPar = data.toward(bolly.goal, bolly.start, true)?.[0];
      await images.add(imagePath(day, 'bollywood'), {
        tag: `Daily #${number}`,
        name: bollyName,
        foot: shortDate(day),
        pills: [`Daily #${number}`, 'Bollywood'],
        blurb: `Connect ${bollyName} to ${bollyStar.name} through the films they share.`,
        site: footer,
        goal: bollyStar.name,
      });
      const page = { site, day, number, mode: 'bollywood' as const, name: bollyName, par: bollyPar, star: { id: bollyStar.id, name: bollyStar.name } };
      write(pagePath(day, 'bollywood') + 'index.html', dailyPage(page, app));
      // Its starts all reach him in hard mode too, but don't publish "Par -1" if that changes.
      if (hardPar !== undefined && hardPar >= 0) write(pagePath(day, 'bollywood-hard') + 'index.html', dailyPage({ ...page, mode: 'bollywood-hard', par: hardPar }, app));
    }
    if (!found || !star) continue;
    starDays++;
    await images.add(imagePath(day, 'star'), {
      tag: `Daily #${number}`,
      name,
      foot: shortDate(day),
      pills: [`Daily #${number}`, 'Star daily'],
      blurb: `Connect ${name} to ${star.name} through the films they share.`,
      site: footer,
      goal: star.name,
    });
    write(pagePath(day, 'star') + 'index.html', dailyPage({ site, day, number, mode: 'star', name, par: found.par, star: { id: star.id, name: star.name } }, app));
  }
  await images.done();
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  console.log(`previews: ${days.length} dailies (${days[0]} to ${days.at(-1)}), ${starDays} with a star daily, ${bollywoodDays} with a Bollywood daily, for ${site} in ${seconds}s`);
}

await main();
