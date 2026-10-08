import { describe, expect, it } from 'vitest';
import { EPOCH } from './logic';
import { DAILY_PATH_RE, dailyPage, displaySite, escapeHtml, normalizeSite, notFoundPage, pagePath, previewDays, rootPrefix, shortDate } from './preview-pages';

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
    expect(() => pagePath('../../etc', 'normal')).toThrow();
  });

  it('climbs back to the root from each depth', () => {
    expect(rootPrefix('d/2026-10-08/')).toBe('../../');
    expect(rootPrefix('d/2026-10-08/hard/')).toBe('../../../');
  });
});

describe('dailyPage', () => {
  const site = 'https://sixdegrees.sidharthjoly.com/';
  const page = dailyPage({ site, day: '2026-10-19', number: 12, mode: 'normal', name: 'Dwayne "The Rock" Johnson <script>', par: 3 });
  const meta = (key: string) => new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)">`).exec(page)?.[1];

  it('has the Open Graph tags, with absolute URLs', () => {
    expect(page).toContain('<title>Six Degrees of JT #12</title>');
    expect(meta('og:title')).toBe('Six Degrees of JT #12');
    expect(meta('og:url')).toBe('https://sixdegrees.sidharthjoly.com/d/2026-10-19/');
    expect(meta('og:image')).toBe('https://sixdegrees.sidharthjoly.com/og/2026-10-19.png');
    expect(meta('twitter:card')).toBe('summary_large_image');
    expect(meta('og:image:width')).toBe('1200');
    expect(meta('og:image:height')).toBe('630');
  });

  it('escapes the name everywhere it appears', () => {
    expect(meta('og:description')).toBe('Connect Dwayne &quot;The Rock&quot; Johnson &lt;script&gt; to Justin Timberlake. Par 3.');
    expect(page).not.toContain('<script>"');
    expect(page.match(/<script>/g)).toHaveLength(1);
  });

  it('forwards people to the game with a relative link, keeping any ?vs= code', () => {
    expect(page).toContain('location.replace("../../#/daily/2026-10-19" + location.search)');
    expect(page).toContain('href="../../#/daily/2026-10-19"');
    // Crawlers can follow a meta refresh to the home page's generic preview.
    expect(page).not.toContain('http-equiv="refresh"');
  });

  it('marks hard mode and goes one level further up', () => {
    const hard = dailyPage({ site, day: '2026-10-19', number: 12, mode: 'hard', name: 'Pelé', par: 4 });
    expect(hard).toContain('<meta property="og:title" content="Six Degrees of JT #12 (hard)">');
    expect(hard).toContain('<meta property="og:url" content="https://sixdegrees.sidharthjoly.com/d/2026-10-19/hard/">');
    expect(hard).toContain('location.replace("../../../#/daily/2026-10-19/hard" + location.search)');
    expect(hard).toContain('Par 4.');
  });
});

describe('notFoundPage', () => {
  it('sends daily links without a page yet to the game', () => {
    expect(notFoundPage()).toContain(String(DAILY_PATH_RE));
    expect('/d/2027-03-01/'.match(DAILY_PATH_RE)?.slice(1)).toEqual(['/', '2027-03-01', undefined]);
    expect('/repo/d/2027-03-01/hard'.match(DAILY_PATH_RE)?.slice(1)).toEqual(['/repo/', '2027-03-01', '/hard']);
    expect('/d/2027-03-01/extra/'.match(DAILY_PATH_RE)).toBeNull();
    expect('/nothing-here'.match(DAILY_PATH_RE)).toBeNull();
  });
});
