import { describe, expect, it } from 'vitest';
import { encodeChallenge, type Challenge } from './challenge-code';
import { DAILY_PAGE_RE, challengeTitle } from './challenge-preview';

const game = (over: Partial<Challenge> = {}): Challenge => ({
  start: 11571,
  mode: 'normal',
  moves: [
    { grade: 'same', hinted: false },
    { grade: 'closer', hinted: false },
    { grade: 'closer', hinted: false },
  ],
  gaveUp: false,
  path: null,
  name: 'Sid',
  ...over,
});
const code = (over: Partial<Challenge> = {}) => encodeChallenge(game(over))!;

describe('challengeTitle', () => {
  it('names the sender and their score', () => {
    expect(challengeTitle(code(), 'normal')).toBe('Sid got to JT in 3 films. Can you beat that?');
  });

  it('mentions hints and hard mode', () => {
    expect(challengeTitle(code({ moves: [{ grade: 'closer', hinted: true }] }), 'normal')).toBe('Sid got to JT in 1 film with 1 hint. Can you beat that?');
    expect(challengeTitle(code({ mode: 'hard' }), 'hard')).toBe('Sid got to JT in 3 films in hard mode. Can you beat that?');
  });

  it('dares them to finish when the sender gave up', () => {
    expect(challengeTitle(code({ gaveUp: true, moves: [{ grade: 'further', hinted: false }] }), 'normal')).toBe('Sid gave up after 1 film. Can you get to JT?');
    expect(challengeTitle(code({ gaveUp: true, moves: [] }), 'normal')).toBe('Sid gave up straight away. Can you get to JT?');
  });

  it('falls back to "Your friend" without a name', () => {
    expect(challengeTitle(code({ name: null }), 'normal')).toBe('Your friend got to JT in 3 films. Can you beat that?');
  });

  it('ignores broken codes and codes for the other mode', () => {
    expect(challengeTitle('nonsense', 'normal')).toBeNull();
    expect(challengeTitle(code().slice(0, -1) + 'x', 'normal')).toBeNull();
    expect(challengeTitle(code({ mode: 'hard' }), 'normal')).toBeNull();
  });

  it('ignores codes for free play towards another star', () => {
    expect(challengeTitle(code({ target: 3454165 }), 'normal')).toBeNull();
  });
});

describe('DAILY_PAGE_RE', () => {
  it('matches daily preview pages only', () => {
    expect(DAILY_PAGE_RE.exec('/d/2026-10-08/')?.[1]).toBeUndefined();
    expect(DAILY_PAGE_RE.exec('/d/2026-10-08/hard/')?.[1]).toBe('hard/');
    for (const other of ['/d/2026-10-08', '/d/2026-10-08/index.html', '/d/x/', '/', '/og/2026-10-08.png']) expect(DAILY_PAGE_RE.test(other)).toBe(false);
  });
});
