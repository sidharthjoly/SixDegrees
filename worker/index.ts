import { DAILY_PAGE_RE, challengeTitle } from '../src/challenge-preview';
import { handleWrite, type GateEnv } from '../src/gate';

/*
 * A Cloudflare Worker with two jobs on sixdegrees.sidharthjoly.com.
 *
 * /api/*: the gate for the game's database writes (src/gate.ts). Those requests are handled
 * here and never passed on to the site, which has nothing there.
 *
 * /d/*: the daily preview pages.
 * A "beat my score" link is a daily's page plus ?vs=<code>, and GitHub Pages serves the same
 * page whatever the query, so every challenge unfurled as the plain daily. For a valid code
 * this rewrites the page's title tags with the sender's score ("Sid got to JT in 3 films.
 * Can you beat that?") and its URL tags with the full link. The image stays the day's.
 *
 * Anything else passes straight through, and so does any page if this throws: the worst case
 * is the old, generic preview. Rewriting streams the page, well inside the free plan's CPU time.
 */

/**
 * The gate's own requests: to Supabase, and to the site's data for checking routes. Data
 * versions are content-hashed, so Cloudflare can keep those files for a day; it doesn't cache
 * JSON unless told to.
 */
function upstream(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (String(input).includes('/data/v/')) return fetch(input, { ...init, cf: { cacheEverything: true, cacheTtl: 86_400 } } as RequestInit);
  return fetch(input, init);
}

export default {
  async fetch(request: Request, env: GateEnv): Promise<Response> {
    if (new URL(request.url).pathname.startsWith('/api/')) {
      const { cf } = request as Request & { cf?: { country?: string } };
      return handleWrite(request, env, upstream, cf?.country);
    }
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
