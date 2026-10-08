import { DAILY_PAGE_RE, challengeTitle } from '../src/challenge-preview';

/*
 * A Cloudflare Worker in front of the daily preview pages (sixdegrees.sidharthjoly.com/d/*).
 * A "beat my score" link is a daily's page plus ?vs=<code>, and GitHub Pages serves the same
 * page whatever the query, so every challenge unfurled as the plain daily. For a valid code
 * this rewrites the page's title tags with the sender's score ("Sid got to JT in 3 films.
 * Can you beat that?") and its URL tags with the full link. The image stays the day's.
 *
 * Anything else passes straight through, and so does any page if this throws: the worst case
 * is the old, generic preview. Rewriting streams the page, well inside the free plan's CPU time.
 */

export default {
  async fetch(request: Request): Promise<Response> {
    const response = await fetch(request);
    try {
      const url = new URL(request.url);
      const page = DAILY_PAGE_RE.exec(url.pathname);
      const vs = url.searchParams.get('vs');
      if (request.method !== 'GET' || !page || !vs || !response.ok || !response.headers.get('content-type')?.startsWith('text/html')) return response;
      const title = challengeTitle(vs, page[1] ? 'hard' : 'normal');
      if (!title) return response;
      // The page's own URL tags are https; keep them so whatever scheme the request came in on.
      url.protocol = 'https:';
      // Names are letters, digits, spaces and ' ’ . - (challenge-code.ts), so they're safe in an attribute.
      const content = (value: string) => ({ element: (e: Element) => void e.setAttribute('content', value) });
      return new HTMLRewriter()
        .on('title', { element: (e) => void e.setInnerContent(title) })
        .on('meta[property="og:title"]', content(title))
        .on('meta[name="twitter:title"]', content(title))
        .on('meta[property="og:url"]', content(url.href))
        .on('link[rel="canonical"]', { element: (e) => void e.setAttribute('href', url.href) })
        .transform(response);
    } catch {
      return response;
    }
  },
};
