/*
 * Static pages for link previews. Preview crawlers (WhatsApp, iMessage, Slack…) ignore
 * everything after the #, so a shared #/daily/<date> link would only ever unfurl as the
 * home page. The build (scripts/previews.ts) writes d/<date>/index.html for each daily: the
 * game's page with that day's Open Graph tags, which starts the game in place. Hard mode's
 * page is d/<date>/hard/, the star daily's d/<date>/star/, the Bollywood daily's
 * d/<date>/bollywood/ and its hard mode's d/<date>/bollywood-hard/.
 *
 * Pure string building with no imports, so Node can load it by type stripping and vitest can
 * test it without data.
 */

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

export type PreviewMode = 'normal' | 'hard' | 'star' | 'bollywood' | 'bollywood-hard';

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
  return `d/${day}/` + (mode === 'normal' ? '' : `${mode}/`);
}

/**
 * A day's preview image. The JT daily's is shared by both its modes: it shows the day's start,
 * not the par. The star and Bollywood dailies' name their star instead of JT, and the
 * Bollywood daily's is shared by both its modes too.
 */
export const imagePath = (day: string, mode: PreviewMode = 'normal') =>
  `og/${day}${mode === 'star' ? '-star' : mode === 'bollywood' || mode === 'bollywood-hard' ? '-bollywood' : ''}.png`;

/** "../../" from d/<date>/, "../../../" from d/<date>/hard/: relative, so any base path works. */
export function rootPrefix(path: string): string {
  return '../'.repeat(path.split('/').filter(Boolean).length);
}

/** The game's own hash route for a daily (see src/router.ts). */
export const dailyRoute = (day: string, mode: PreviewMode) => `#/daily/${day}` + (mode === 'normal' ? '' : `/${mode}`);

export interface DailyPage {
  /** Normalized site URL, with a trailing slash. */
  site: string;
  day: string;
  /** Daily number (1 = the first daily). */
  number: number;
  mode: PreviewMode;
  name: string;
  par: number;
  /** The star daily's star. */
  star?: { id: number; name: string };
}

export const IMAGE_WIDTH = 1200;
export const IMAGE_HEIGHT = 630;

export function dailyTitle(p: Pick<DailyPage, 'number' | 'mode' | 'star'>): string {
  return `Six Degrees of ${p.star?.name ?? 'JT'} #${p.number}` + (p.mode === 'hard' || p.mode === 'bollywood-hard' ? ' (hard)' : '');
}

export function dailyDescription(p: Pick<DailyPage, 'name' | 'par' | 'star'>): string {
  return `Connect ${p.name} to ${p.star?.name ?? 'Justin Timberlake'}. Par ${p.par}.`;
}

/**
 * The tag on a star daily's page that names its star, first among its preview tags: the
 * Worker reads it before the title, to write a challenge's title (worker/index.ts).
 */
export const STAR_TAG = 'sixdegrees-star';

/** The markers in index.html around the tags each daily's page swaps for its own. */
export const TAGS_START = '<!-- preview-tags -->';
export const TAGS_END = '<!-- /preview-tags -->';

/**
 * The page for one daily: the game's own index.html (`app`) with that day's title and Open
 * Graph tags, so the game starts right here rather than after a redirect, a second page load
 * that cost a phone about half a second. The first thing the page does is put the game's
 * address in the address bar (no navigation), and a <base> makes its relative URLs, the
 * bundle and the data, resolve from the site root as they do on the home page. Preview crawlers mostly
 * don't run scripts, and the ones that do still read this page's tags.
 */
export function dailyPage(p: DailyPage, app: string): string {
  const path = pagePath(p.day, p.mode);
  const title = dailyTitle(p);
  const description = dailyDescription(p);
  const url = p.site + path;
  const image = p.site + imagePath(p.day, p.mode);
  const alt = `Daily #${p.number}: a pink sticker reading ${p.name}` + (p.star ? `, heading for ${p.star.name}` : '');
  const a = escapeHtml;
  const start = app.indexOf(TAGS_START);
  const end = app.indexOf(TAGS_END);
  if (start < 0 || end < start) throw new Error('index.html has lost its preview-tags markers');
  if (!app.includes('<head>')) throw new Error('index.html has no <head>');
  const star = p.star ? `\n<meta name="${STAR_TAG}" content="${p.star.id}" data-name="${a(p.star.name)}">` : '';
  const tags = `${TAGS_START}${star}
<title>${a(title)}</title>
<meta name="description" content="${a(description)}">
<link rel="canonical" href="${a(url)}">
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
${TAGS_END}`;
  // First in <head>, before any relative URL is read. The <base> points them at the site
  // root from the start (the browser's preload scanner reads ahead of scripts, so the
  // address change alone would come too late for it); the script then moves the address to
  // the game's route, taking any ?vs= challenge code along.
  const root = rootPrefix(path);
  const head = `<base href="${root}">\n    <script>history.replaceState(null, '', ${JSON.stringify(dailyRoute(p.day, p.mode))} + location.search)</script>`;
  const page = app.slice(0, start) + tags + app.slice(end + TAGS_END.length);
  return page.replace('<head>', `<head>\n    ${head}`);
}

/** A daily page's URL path: [1] the site root, [2] the date, [3] "/hard", "/star" or "/bollywood" for the other dailies. */
export const DAILY_PATH_RE = /^(.*?\/)d\/(\d{4}-\d{2}-\d{2})(\/hard|\/star|\/bollywood-hard|\/bollywood)?\/?$/;

/*
 * GitHub Pages serves 404.html for any missing path. A daily link newer than the last
 * build (pages run 45 days ahead, but scheduled builds can lapse) still reaches the game.
 * The site root is whatever comes before /d/, so this works on a /repo/ path too.
 *
 * The root goes after this site's origin, never on its own: a path like //evil.example/d/…
 * would otherwise make it a link to another site, so anyone could send people from this
 * address to theirs.
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
if (m) location.replace(location.origin + m[1] + "#/daily/" + m[2] + (m[3] || "") + location.search);
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

// Just enough of the game's look for 404.html's moment before its redirect (or without scripts).
const PAGE_CSS =
  'body{margin:0;background:#b9b4ff radial-gradient(#a29cf7 2px,transparent 2px) 0 0/28px 28px;color:#111;font:500 18px/1.5 system-ui,sans-serif}' +
  'main{box-sizing:border-box;max-width:min(34em,calc(100% - 32px));margin:15vh auto;padding:24px;background:#fff;border:3px solid #111;border-radius:20px;box-shadow:6px 6px 0 #111}' +
  'h1{margin:0 0 8px;font-size:24px}a{display:inline-block;padding:12px 20px;border:3px solid #111;border-radius:999px;background:#c6ff3d;color:#111;font-weight:700;text-decoration:none}' +
  'a:focus-visible{outline:3px solid #111;outline-offset:3px}';
