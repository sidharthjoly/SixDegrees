import type { Mode, Qid } from './types';

/**
 * Hash routes:
 *   #/                         home
 *   #/daily                    today's daily (kept for old links)
 *   #/daily/2026-10-08         a given day's daily; add /hard for hard mode
 *   #/p/11571                  free play from a person; add /hard for hard mode
 *   #/archive, #/stats
 *   #/g/abcdefgh23             a group's board
 * Daily and free-play routes may carry ?vs=<code>, a friend's result to beat.
 */
export type Route =
  | { name: 'home' }
  | { name: 'daily'; day: string | null; mode: Mode; vs: string | null }
  | { name: 'play'; qid: Qid; mode: Mode; vs: string | null }
  | { name: 'archive' }
  | { name: 'stats' }
  | { name: 'group'; code: string }
  | { name: 'unknown' };

/** Longest ?vs= code accepted; anything longer is ignored rather than parsed. */
export const MAX_VS_LENGTH = 400;

export function parseRoute(hash: string): Route {
  const [path, query = ''] = hash.replace(/^#/, '').split('?', 2);
  const parts = path.split('/').filter(Boolean);
  const vsRaw = new URLSearchParams(query).get('vs');
  const vs = vsRaw && vsRaw.length <= MAX_VS_LENGTH ? vsRaw : null;
  const modeAt = (i: number): Mode | null => (parts[i] === undefined ? 'normal' : parts[i] === 'hard' && parts.length === i + 1 ? 'hard' : null);

  if (parts.length === 0) return { name: 'home' };
  if (parts[0] === 'daily') {
    if (parts.length === 1) return { name: 'daily', day: null, mode: 'normal', vs };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(parts[1])) return { name: 'unknown' };
    const mode = modeAt(2);
    return mode ? { name: 'daily', day: parts[1], mode, vs } : { name: 'unknown' };
  }
  if (parts[0] === 'p' && /^\d{1,12}$/.test(parts[1] ?? '')) {
    const mode = modeAt(2);
    return mode ? { name: 'play', qid: Number(parts[1]), mode, vs } : { name: 'unknown' };
  }
  if (parts.length === 1 && parts[0] === 'archive') return { name: 'archive' };
  if (parts.length === 1 && parts[0] === 'stats') return { name: 'stats' };
  // Codes are lower case, but a link typed from someone reading it out might not be.
  if (parts.length === 2 && parts[0] === 'g' && /^[a-z0-9]{4,16}$/i.test(parts[1])) return { name: 'group', code: parts[1].toLowerCase() };
  return { name: 'unknown' };
}

export function href(route: Route): string {
  const suffix = (mode: Mode, vs: string | null) => (mode === 'hard' ? '/hard' : '') + (vs ? `?vs=${encodeURIComponent(vs)}` : '');
  switch (route.name) {
    case 'home':
    case 'unknown':
      return '#/';
    case 'daily':
      return route.day ? `#/daily/${route.day}${suffix(route.mode, route.vs)}` : `#/daily${route.vs ? `?vs=${encodeURIComponent(route.vs)}` : ''}`;
    case 'play':
      return `#/p/${route.qid}${suffix(route.mode, route.vs)}`;
    case 'archive':
      return '#/archive';
    case 'stats':
      return '#/stats';
    case 'group':
      return `#/g/${route.code}`;
  }
}
