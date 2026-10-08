import { JT, type Grade, type MoveSummary } from './logic';
import { MAX_VS_LENGTH } from './router';
import type { Mode, Qid } from './types';

/**
 * "Beat my score" codes: a finished game packed into the ?vs= part of a link, so a friend
 * can play the same puzzle against it with no server.
 *
 *   1.8bl.nf.csCc.2s-9ix_ab-c4_x-xe0.U2Ft.k3q
 *   │ │   ││ │    │                  │    └ checksum: 3 base36 chars
 *   │ │   ││ │    │                  └ name: base64url UTF-8, or empty
 *   │ │   ││ │    └ path: film-person per move, base36, "_" between moves; empty when dropped
 *   │ │   ││ └ moves: c/s/f = closer/same/further, upper case when hinted
 *   │ │   │└ f = finished, g = gave up
 *   │ │   └ n = normal, h = hard
 *   │ └ start person, base36
 *   └ format version
 *
 * Every character is URL-safe, so the link needs no percent-escapes. The checksum keeps the
 * code ending in a letter or digit: chat apps drop a trailing "." from a link, and an empty
 * name field would otherwise leave one. It also catches links cut short or edited by hand.
 *
 * Codes arrive in links anyone can write, so decoding validates every field and returns
 * null for anything off. Names are only ever rendered as text.
 */

export interface Challenge {
  /** Who the game started from: the code is only for that puzzle. */
  start: Qid;
  mode: Mode;
  moves: MoveSummary[];
  gaveUp: boolean;
  /** [film, person] per move, or null when it was dropped to keep the link short. */
  path: [Qid, Qid][] | null;
  /** The challenger's display name, or null. */
  name: string | null;
}

const VERSION = '1';
export const MAX_NAME_LENGTH = 20;
/** Far beyond any real game; keeps a grades-only code well under the router's cap. */
export const MAX_MOVES = 200;
/** Base36 QIDs of at most 7 characters (up to about 78 billion; Wikidata is near 130 million). */
const QID_RE = /^[1-9a-z][0-9a-z]{0,6}$/;
/** 20 code points of up to 4 UTF-8 bytes each, as base64url. */
const MAX_NAME_FIELD = Math.ceil((MAX_NAME_LENGTH * 4 * 4) / 3);

const GRADE_CHAR: Record<Grade, string> = { closer: 'c', same: 's', further: 'f' };
const CHAR_GRADE: Record<string, Grade> = { c: 'closer', s: 'same', f: 'further' };

/** FNV-1a over the code body, as 3 base36 characters. Exported for tests. */
export function checksum(body: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < body.length; i++) {
    h ^= body.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % 36 ** 3).toString(36).padStart(3, '0');
}

const qidOut = (q: Qid) => q.toString(36);

function qidIn(s: string): Qid | null {
  return QID_RE.test(s) ? parseInt(s, 36) : null;
}

const ALLOWED_NAME = /^[\p{L}\p{N}][\p{L}\p{M}\p{N} '’.-]*$/u;

/** Letters, digits, single spaces and a little punctuation; no stacks of combining marks. */
export function isValidName(s: string): boolean {
  return (
    s === s.normalize('NFC') &&
    [...s].length <= MAX_NAME_LENGTH &&
    ALLOWED_NAME.test(s) &&
    s === s.trim() &&
    !s.includes('  ') &&
    !/\p{M}{3,}/u.test(s)
  );
}

/** Best effort at turning whatever was typed into a valid name; '' when nothing is left. */
export function cleanName(raw: string): string {
  const kept = raw
    .normalize('NFC')
    .replace(/[^\p{L}\p{M}\p{N} '’.-]/gu, ' ')
    .replace(/(\p{M}{2})\p{M}+/gu, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[^\p{L}\p{N}]+/u, '');
  const cut = [...kept].slice(0, MAX_NAME_LENGTH).join('').trim();
  return isValidName(cut) ? cut : '';
}

function toBase64Url(s: string): string {
  let bin = '';
  for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string | null {
  if (s.length > MAX_NAME_FIELD || !/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) return null;
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    const text = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    // Only one spelling per name, so a hand-edited code can't smuggle stray bits through.
    return toBase64Url(text) === s ? text : null;
  } catch {
    return null;
  }
}

/** The ?vs= code for a game, or null if it can't be shared (an absurdly long game). */
export function encodeChallenge(c: Challenge): string | null {
  if (c.moves.length > MAX_MOVES) return null;
  const name = c.name ? cleanName(c.name) : '';
  const head = [
    VERSION,
    qidOut(c.start),
    (c.mode === 'hard' ? 'h' : 'n') + (c.gaveUp ? 'g' : 'f'),
    c.moves.map((m) => (m.hinted ? GRADE_CHAR[m.grade].toUpperCase() : GRADE_CHAR[m.grade])).join(''),
  ];
  const withPath = (path: string) => {
    const body = [...head, path, name ? toBase64Url(name) : ''].join('.');
    return `${body}.${checksum(body)}`;
  };
  const path = c.path && c.path.length === c.moves.length ? c.path.map(([f, p]) => `${qidOut(f)}-${qidOut(p)}`).join('_') : '';
  const full = withPath(path);
  // The path is the bulky part: over the cap, the grades alone still make a challenge.
  return full.length <= MAX_VS_LENGTH ? full : withPath('');
}

/** The challenge in a ?vs= code, or null when the code is malformed in any way. */
export function decodeChallenge(code: string): Challenge | null {
  if (typeof code !== 'string' || code.length > MAX_VS_LENGTH) return null;
  const fields = code.split('.');
  if (fields.length !== 7) return null;
  const [version, startField, flags, movesField, pathField, nameField, sum] = fields;
  if (version !== VERSION || sum !== checksum(fields.slice(0, 6).join('.'))) return null;

  const start = qidIn(startField);
  if (start === null || start === JT) return null;
  const flag = /^([nh])([fg])$/.exec(flags);
  if (!flag) return null;
  const mode: Mode = flag[1] === 'h' ? 'hard' : 'normal';
  const gaveUp = flag[2] === 'g';

  // Hard mode has no hints, so an upper-case grade there is a forgery.
  if (movesField.length > MAX_MOVES || !(mode === 'hard' ? /^[csf]*$/ : /^[csfCSF]*$/).test(movesField)) return null;
  const moves: MoveSummary[] = [...movesField].map((ch) => ({ grade: CHAR_GRADE[ch.toLowerCase()], hinted: ch !== ch.toLowerCase() }));
  // A finished game ends on JT, which is always a step closer; giving up can happen before any move.
  if (!gaveUp && (moves.length === 0 || moves.at(-1)!.grade !== 'closer')) return null;

  let path: [Qid, Qid][] | null = null;
  if (pathField) {
    const steps = pathField.split('_');
    if (steps.length !== moves.length) return null;
    path = [];
    for (const step of steps) {
      const parts = step.split('-');
      const film = parts.length === 2 ? qidIn(parts[0]) : null;
      const person = parts.length === 2 ? qidIn(parts[1]) : null;
      if (film === null || person === null) return null;
      path.push([film, person]);
    }
    // Reaching JT ends the game, so he can only be the very last step, and only of a finished game.
    if (path.some(([, p], i) => (p === JT) !== (!gaveUp && i === path!.length - 1))) return null;
  }

  let name: string | null = null;
  if (nameField) {
    name = fromBase64Url(nameField);
    if (name === null || !isValidName(name)) return null;
  }
  return { start, mode, moves, gaveUp, path, name };
}

export type Outcome = 'win' | 'lose' | 'draw';
/** Why: fewer films, fewer hints at equal films, one side gave up, both gave up, or a dead heat. */
export type Reason = 'films' | 'hints' | 'gaveUp' | 'bothGaveUp' | 'tie';

export interface Side {
  films: number;
  hints: number;
  gaveUp: boolean;
}

export const sideOf = (moves: MoveSummary[], gaveUp: boolean): Side => ({ films: moves.length, hints: moves.filter((m) => m.hinted).length, gaveUp });

/** Who won, from `you`'s point of view: fewer films wins, giving up loses, hints break ties. */
export function compareResults(you: Side, them: Side): { outcome: Outcome; reason: Reason } {
  if (you.gaveUp || them.gaveUp) {
    if (you.gaveUp && them.gaveUp) return { outcome: 'draw', reason: 'bothGaveUp' };
    return { outcome: you.gaveUp ? 'lose' : 'win', reason: 'gaveUp' };
  }
  if (you.films !== them.films) return { outcome: you.films < them.films ? 'win' : 'lose', reason: 'films' };
  if (you.hints !== them.hints) return { outcome: you.hints < them.hints ? 'win' : 'lose', reason: 'hints' };
  return { outcome: 'draw', reason: 'tie' };
}
