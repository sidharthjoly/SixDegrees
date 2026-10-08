/*
 * Static pages for link previews. Preview crawlers (WhatsApp, iMessage, Slack…) ignore
 * everything after the #, so a shared #/daily/<date> link would only ever unfurl as the
 * home page. The build (scripts/previews.ts) writes d/<date>/index.html for each daily, with
 * that day's Open Graph tags, which sends people straight on to the game.
 *
 * Pure string building with no imports, so Node can load it by type stripping and vitest can
 * test it without data.
 */

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

export type PreviewMode = 'normal' | 'hard';

/** SITE_URL with exactly one trailing slash, so paths can be appended. Rejects anything but http(s). */
export function normalizeSite(raw: string): string {
  const url = new URL(raw.trim());
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(`SITE_URL must be http(s): ${raw}`);
  url.search = '';
  url.hash = '';
  return url.href.replace(/\/*$/, '/');
}

/** "sixdegrees.sidharthjoly.com" for the image footer: host and path, no scheme or trailing slash. */
export function displaySite(site: string): string {
  const url = new URL(site);
  return (url.host + url.pathname).replace(/\/+$/, '');
}

/** Every day from `first` through `ahead` days after `today`, as YYYY-MM-DD (UTC calendar arithmetic). */
export function previewDays(first: string, today: string, ahead: number): string[] {
  const start = Date.parse(`${first}T00:00:00Z`);
  const end = Date.parse(`${today}T00:00:00Z`) + ahead * DAY_MS;
  if (Number.isNaN(start) || Number.isNaN(end)) throw new Error(`Bad date range ${first}..${today}`);
  const days: string[] = [];
  for (let t = start; t <= end; t += DAY_MS) days.push(new Date(t).toISOString().slice(0, 10));
  return days;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "8 Oct 2026". Fixed English month names, so the image doesn't depend on the build machine's locale. */
export function shortDate(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Where a daily's page lives, relative to the site root. */
export function pagePath(day: string, mode: PreviewMode): string {
  if (!DAY_RE.test(day)) throw new Error(`Bad day ${day}`);
  return `d/${day}/` + (mode === 'hard' ? 'hard/' : '');
}

/** One preview image per day, shared by both modes: it shows the day's star, not the par. */
export const imagePath = (day: string) => `og/${day}.png`;

/** "../../" from d/<date>/, "../../../" from d/<date>/hard/: relative, so any base path works. */
export function rootPrefix(path: string): string {
  return '../'.repeat(path.split('/').filter(Boolean).length);
}

/** The game's own hash route for a daily (see src/router.ts). */
export const dailyRoute = (day: string, mode: PreviewMode) => `#/daily/${day}` + (mode === 'hard' ? '/hard' : '');

export interface DailyPage {
  /** Normalized site URL, with a trailing slash. */
  site: string;
  day: string;
  /** Daily number (1 = the first daily). */
  number: number;
  mode: PreviewMode;
  name: string;
  par: number;
}

export const IMAGE_WIDTH = 1200;
export const IMAGE_HEIGHT = 630;

export function dailyTitle(p: Pick<DailyPage, 'number' | 'mode'>): string {
  return `Six Degrees of JT #${p.number}` + (p.mode === 'hard' ? ' (hard)' : '');
}

export function dailyDescription(p: Pick<DailyPage, 'name' | 'par'>): string {
  return `Connect ${p.name} to Justin Timberlake. Par ${p.par}.`;
}

/*
 * Preview crawlers that run scripts must not follow the redirect, or they'd unfurl the
 * home page instead. iMessage fetches previews with these tokens in its user agent. There's
 * no <meta http-equiv="refresh"> for the same reason: crawlers that don't run scripts can
 * still follow a refresh. Without scripts, people get a link to tap.
 */
const CRAWLER_RE = 'facebookexternalhit|Facebot|Twitterbot';

/** The page for one daily: Open Graph and Twitter tags, then straight on to the game. */
export function dailyPage(p: DailyPage): string {
  const path = pagePath(p.day, p.mode);
  const target = rootPrefix(path) + dailyRoute(p.day, p.mode);
  const title = dailyTitle(p);
  const description = dailyDescription(p);
  const url = p.site + path;
  const image = p.site + imagePath(p.day);
  const alt = `Daily #${p.number}: a pink sticker reading ${p.name}`;
  const a = escapeHtml;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${a(title)}</title>
<script>if (!/${CRAWLER_RE}/i.test(navigator.userAgent)) location.replace(${JSON.stringify(target)} + location.search);</script>
<link rel="canonical" href="${a(url)}">
<meta name="description" content="${a(description)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Six Degrees of Justin Timberlake">
<meta property="og:title" content="${a(title)}">
<meta property="og:description" content="${a(description)}">
<meta property="og:url" content="${a(url)}">
<meta property="og:image" content="${a(image)}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="${IMAGE_WIDTH}">
<meta property="og:image:height" content="${IMAGE_HEIGHT}">
<meta property="og:image:alt" content="${a(alt)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${a(title)}">
<meta name="twitter:description" content="${a(description)}">
<meta name="twitter:image" content="${a(image)}">
<meta name="theme-color" content="#b9b4ff">
<style>${PAGE_CSS}</style>
</head>
<body>
<main>
<h1>${a(title)}</h1>
<p>${a(description)}</p>
<p><a href="${a(target)}">Play the daily</a></p>
</main>
</body>
</html>
`;
}

/** A daily page's URL path: [1] the site root, [2] the date, [3] "/hard" for hard mode. */
export const DAILY_PATH_RE = /^(.*?\/)d\/(\d{4}-\d{2}-\d{2})(\/hard)?\/?$/;

/*
 * GitHub Pages serves 404.html for any missing path. A daily link newer than the last
 * build (pages run 45 days ahead, but scheduled builds can lapse) still reaches the game.
 * The site root is whatever comes before /d/, so this works on a /repo/ path too.
 */
export function notFoundPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Six Degrees of Justin Timberlake</title>
<script>
var m = location.pathname.match(${DAILY_PATH_RE});
if (m) location.replace(m[1] + "#/daily/" + m[2] + (m[3] ? "/hard" : "") + location.search);
</script>
<style>${PAGE_CSS}</style>
</head>
<body>
<main>
<h1>Page not found</h1>
<p>That link doesn’t lead anywhere in the game.</p>
<p><a href="/">Play Six Degrees of Justin Timberlake</a></p>
</main>
</body>
</html>
`;
}

// Just enough of the game's look for the moment before the redirect (or without scripts).
const PAGE_CSS =
  'body{margin:0;background:#b9b4ff radial-gradient(#a29cf7 2px,transparent 2px) 0 0/28px 28px;color:#111;font:500 18px/1.5 system-ui,sans-serif}' +
  'main{box-sizing:border-box;max-width:min(34em,calc(100% - 32px));margin:15vh auto;padding:24px;background:#fff;border:3px solid #111;border-radius:20px;box-shadow:6px 6px 0 #111}' +
  'h1{margin:0 0 8px;font-size:24px}a{display:inline-block;padding:12px 20px;border:3px solid #111;border-radius:999px;background:#c6ff3d;color:#111;font-weight:700;text-decoration:none}' +
  'a:focus-visible{outline:3px solid #111;outline-offset:3px}';
