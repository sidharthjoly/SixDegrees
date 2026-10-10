import { describe, expect, it } from 'vitest';
import { EPOCH } from './logic';
import { DAILY_PATH_RE, STAR_TAG, TAGS_END, TAGS_START, dailyPage, displaySite, escapeHtml, imagePath, normalizeSite, notFoundPage, pagePath, previewDays, rootPrefix, shortDate } from './preview-pages';

describe('normalizeSite', () => {
  it('ends with exactly one slash', () => {
    expect(normalizeSite('https://sixdegrees.sidharthjoly.com')).toBe('https://sixdegrees.sidharthjoly.com/');
    expect(normalizeSite('https://example.com/six-degrees//')).toBe('https://example.com/six-degrees/');
    expect(normalizeSite(' http://localhost:4173/?x=1#y ')).toBe('http://localhost:4173/');
  });

  it('rejects anything that is not http(s)', () => {
    expect(() => normalizeSite('javascript:alert(1)')).toThrow();
    expect(() => normalizeSite('not a url')).toThrow();
  });
});

describe('displaySite', () => {
  it('drops the scheme and trailing slash', () => {
    expect(displaySite('https://sixdegrees.sidharthjoly.com/')).toBe('sixdegrees.sidharthjoly.com');
    expect(displaySite('http://localhost:4173/repo/')).toBe('localhost:4173/repo');
  });
});

describe('previewDays', () => {
  it('runs from the first daily through 45 days ahead, inclusive', () => {
    const days = previewDays(EPOCH, EPOCH, 45);
    expect(days).toHaveLength(46);
    expect(days[0]).toBe('2026-10-08');
    expect(days.at(-1)).toBe('2026-11-22');
  });

  it('crosses month, year and leap-day boundaries one day at a time', () => {
    expect(previewDays('2027-12-30', '2027-12-30', 3)).toEqual(['2027-12-30', '2027-12-31', '2028-01-01', '2028-01-02']);
    expect(previewDays('2028-02-28', '2028-02-28', 2)).toEqual(['2028-02-28', '2028-02-29', '2028-03-01']);
  });

  it('grows with the build date', () => {
    expect(previewDays(EPOCH, '2027-10-08', 45)).toHaveLength(365 + 46);
  });
});

describe('shortDate', () => {
  it('formats without depending on the locale', () => {
    expect(shortDate('2026-10-08')).toBe('8 Oct 2026');
    expect(shortDate('2027-01-31')).toBe('31 Jan 2027');
  });
});

describe('escapeHtml', () => {
  it('escapes everything that could end an attribute or open a tag', () => {
    expect(escapeHtml(`<b>"Tom" & 'Jerry'</b>`)).toBe('&lt;b&gt;&quot;Tom&quot; &amp; &#39;Jerry&#39;&lt;/b&gt;');
  });
});

describe('page paths', () => {
  it('nests hard mode under the day', () => {
    expect(pagePath('2026-10-08', 'normal')).toBe('d/2026-10-08/');
    expect(pagePath('2026-10-08', 'hard')).toBe('d/2026-10-08/hard/');
    expect(pagePath('2026-10-08', 'star')).toBe('d/2026-10-08/star/');
    expect(() => pagePath('../../etc', 'normal')).toThrow();
  });

  it('climbs back to the root from each depth', () => {
    expect(rootPrefix('d/2026-10-08/')).toBe('../../');
    expect(rootPrefix('d/2026-10-08/hard/')).toBe('../../../');
  });
});

describe('dailyPage', () => {
  const site = 'https://sixdegrees.sidharthjoly.com/';
  // The shape of dist/index.html: the game's page, with the home page's tags between markers.
  const app = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <script>/* early data downloads */</script>
    ${TAGS_START}
    <title>Six Degrees of Justin Timberlake</title>
    <meta property="og:title" content="Six Degrees of Justin Timberlake" />
    ${TAGS_END}
    <script type="module" crossorigin src="./assets/index-abc.js"></script>
  </head>
  <body><main id="app"><p class="loading">Loading…</p></main></body>
</html>`;
  const page = dailyPage({ site, day: '2026-10-19', number: 12, mode: 'normal', name: 'Dwayne "The Rock" Johnson <script>', par: 3 }, app);
  const meta = (key: string) => new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)">`).exec(page)?.[1];

  it('has the Open Graph tags, with absolute URLs, in place of the home page\'s', () => {
    expect(page).toContain('<title>Six Degrees of JT #12</title>');
    expect(meta('og:title')).toBe('Six Degrees of JT #12');
    expect(meta('og:url')).toBe('https://sixdegrees.sidharthjoly.com/d/2026-10-19/');
    expect(meta('og:image')).toBe('https://sixdegrees.sidharthjoly.com/og/2026-10-19.png');
    expect(meta('twitter:card')).toBe('summary_large_image');
    expect(meta('og:image:width')).toBe('1200');
    expect(meta('og:image:height')).toBe('630');
    expect(page).not.toContain('Six Degrees of Justin Timberlake</title>');
    expect(page.match(/<title>/g)).toHaveLength(1);
  });

  it('escapes the name everywhere it appears', () => {
    expect(meta('og:description')).toBe('Connect Dwayne &quot;The Rock&quot; Johnson &lt;script&gt; to Justin Timberlake. Par 3.');
    expect(page).not.toContain('<script>"');
    expect(page).not.toContain('Johnson <script>');
  });

  it('is the game itself, which moves to the game\'s address first, keeping any ?vs= code', () => {
    expect(page).toContain('src="./assets/index-abc.js"');
    expect(page).toContain('<base href="../../">');
    expect(page).toContain(`history.replaceState(null, '', "#/daily/2026-10-19" + location.search)`);
    // Before anything that reads a relative URL, including the early downloads.
    const at = (s: string) => page.indexOf(s);
    for (const first of ['<base href', 'history.replaceState']) {
      expect(at(first)).toBeLessThan(at('<meta charset'));
      expect(at(first)).toBeLessThan(at('early data downloads'));
      expect(at(first)).toBeLessThan(at('./assets/'));
    }
    // No redirect, so no second page load (and nothing for a crawler to follow away).
    expect(page).not.toContain('location.replace');
    expect(page).not.toContain('http-equiv="refresh"');
  });

  it('marks hard mode and goes one level further up', () => {
    const hard = dailyPage({ site, day: '2026-10-19', number: 12, mode: 'hard', name: 'Pelé', par: 4 }, app);
    expect(hard).toContain('<meta property="og:title" content="Six Degrees of JT #12 (hard)">');
    expect(hard).toContain('<meta property="og:url" content="https://sixdegrees.sidharthjoly.com/d/2026-10-19/hard/">');
    expect(hard).toContain('<base href="../../../">');
    expect(hard).toContain(`history.replaceState(null, '', "#/daily/2026-10-19/hard" + location.search)`);
    expect(hard).toContain('Par 4.');
  });

  it('gives the star daily its own page and image, naming the star ahead of the title for the Worker', () => {
    const star = dailyPage({ site, day: '2026-10-19', number: 12, mode: 'star', name: 'Pelé', par: 2, star: { id: 873, name: 'Meryl Streep' } }, app);
    expect(star).toContain('<title>Six Degrees of Meryl Streep #12</title>');
    expect(star).toContain('<meta property="og:url" content="https://sixdegrees.sidharthjoly.com/d/2026-10-19/star/">');
    expect(star).toContain('<meta property="og:image" content="https://sixdegrees.sidharthjoly.com/og/2026-10-19-star.png">');
    expect(star).toContain('<meta name="description" content="Connect Pelé to Meryl Streep. Par 2.">');
    expect(star).toContain(`history.replaceState(null, '', "#/daily/2026-10-19/star" + location.search)`);
    expect(star).toContain('<base href="../../../">');
    const tag = `<meta name="${STAR_TAG}" content="873" data-name="Meryl Streep">`;
    expect(star.indexOf(tag)).toBeGreaterThan(0);
    expect(star.indexOf(tag)).toBeLessThan(star.indexOf('<title>'));
    expect(page).not.toContain(STAR_TAG);
    expect(imagePath('2026-10-19')).toBe('og/2026-10-19.png');
    expect(imagePath('2026-10-19', 'hard')).toBe('og/2026-10-19.png');
  });

  it('refuses a page that has lost its markers, rather than publish the home page\'s tags', () => {
    expect(() => dailyPage({ site, day: '2026-10-19', number: 12, mode: 'normal', name: 'Pelé', par: 3 }, app.replace(TAGS_END, ''))).toThrow(/markers/);
  });
});

describe('notFoundPage', () => {
  it('sends daily links without a page yet to the game', () => {
    expect(notFoundPage()).toContain(String(DAILY_PATH_RE));
    expect('/d/2027-03-01/'.match(DAILY_PATH_RE)?.slice(1)).toEqual(['/', '2027-03-01', undefined]);
    expect('/repo/d/2027-03-01/hard'.match(DAILY_PATH_RE)?.slice(1)).toEqual(['/repo/', '2027-03-01', '/hard']);
    expect('/d/2027-03-01/star/'.match(DAILY_PATH_RE)?.slice(1)).toEqual(['/', '2027-03-01', '/star']);
    expect('/d/2027-03-01/extra/'.match(DAILY_PATH_RE)).toBeNull();
    expect('/nothing-here'.match(DAILY_PATH_RE)).toBeNull();
  });

  // Runs the page's own script against a stand-in for `location`, returning where it went.
  const redirect = (pathname: string, search = '') => {
    const script = /<script>([\s\S]*?)<\/script>/.exec(notFoundPage())![1];
    const went: string[] = [];
    const location = { origin: 'https://sixdegrees.example', pathname, search, replace: (url: string) => went.push(url) };
    new Function('location', script)(location);
    return went;
  };

  it('forwards to the game on this site', () => {
    expect(redirect('/d/2027-03-01/', '?vs=abc')).toEqual(['https://sixdegrees.example/#/daily/2027-03-01?vs=abc']);
    expect(redirect('/repo/d/2027-03-01/hard/')).toEqual(['https://sixdegrees.example/repo/#/daily/2027-03-01/hard']);
    expect(redirect('/d/2027-03-01/star/', '?vs=abc')).toEqual(['https://sixdegrees.example/#/daily/2027-03-01/star?vs=abc']);
    expect(redirect('/nothing-here')).toEqual([]);
  });

  it('never forwards to another site', () => {
    for (const path of ['//evil.example/d/2027-03-01/', '/x//evil.example/d/2027-03-01/hard/', '///evil.example/d/2027-03-01']) {
      const went = redirect(path);
      expect(went).toHaveLength(1);
      expect(new URL(went[0]).origin).toBe('https://sixdegrees.example');
    }
  });
});
