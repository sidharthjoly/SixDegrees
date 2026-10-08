import { describe, expect, it } from 'vitest';
import { keyCommand, type KeyContext, type KeyLike } from './keys';

const key = (k: string, extra: Partial<KeyLike> = {}): KeyLike => ({
  key: k,
  code: '',
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  repeat: false,
  isComposing: false,
  ...extra,
});
const inFilter: KeyContext = { inFilter: true, inOtherField: false, filterHasText: false };
const typed: KeyContext = { ...inFilter, filterHasText: true };
const onPage: KeyContext = { inFilter: false, inOtherField: false, filterHasText: false };

describe('keyCommand', () => {
  it('moves and picks from the filter box', () => {
    expect(keyCommand(key('ArrowDown'), typed)).toBe('down');
    expect(keyCommand(key('ArrowUp'), typed)).toBe('up');
    expect(keyCommand(key('Enter'), typed)).toBe('pick');
    expect(keyCommand(key('Enter', { shiftKey: true }), typed)).toBeNull();
  });

  it('leaves arrows and Enter alone elsewhere, so the page scrolls and buttons press', () => {
    expect(keyCommand(key('ArrowDown'), onPage)).toBeNull();
    expect(keyCommand(key('Enter'), onPage)).toBeNull();
  });

  it('clears the filter first, then goes back', () => {
    expect(keyCommand(key('Escape'), typed)).toBe('clear');
    expect(keyCommand(key('Escape'), inFilter)).toBe('back');
    expect(keyCommand(key('Escape'), onPage)).toBe('back');
  });

  it('only treats Backspace as back on an empty box, and never on auto-repeat', () => {
    expect(keyCommand(key('Backspace'), typed)).toBeNull();
    expect(keyCommand(key('Backspace'), inFilter)).toBe('back');
    expect(keyCommand(key('Backspace', { repeat: true }), inFilter)).toBeNull();
  });

  it('ignores auto-repeat on Escape and Enter, but not on the arrows', () => {
    expect(keyCommand(key('Escape', { repeat: true }), inFilter)).toBeNull();
    expect(keyCommand(key('Escape', { repeat: true }), typed)).toBeNull();
    expect(keyCommand(key('Enter', { repeat: true }), typed)).toBeNull();
    expect(keyCommand(key('ArrowDown', { repeat: true }), typed)).toBe('down');
  });

  it('reads Alt+H by physical key, since macOS turns it into "˙"', () => {
    expect(keyCommand(key('˙', { altKey: true, code: 'KeyH' }), typed)).toBe('hint');
    expect(keyCommand(key('h', { altKey: true, code: 'KeyH' }), onPage)).toBe('hint');
    expect(keyCommand(key('h', { code: 'KeyH' }), typed)).toBeNull();
    expect(keyCommand(key('∫', { altKey: true, code: 'KeyB' }), typed)).toBeNull();
  });

  it('sends printable keys to the filter box from elsewhere on the page', () => {
    expect(keyCommand(key('a'), onPage)).toBe('type');
    expect(keyCommand(key('A', { shiftKey: true }), onPage)).toBe('type');
    expect(keyCommand(key(' '), onPage)).toBeNull();
    expect(keyCommand(key('Tab'), onPage)).toBeNull();
    // Already in the box: the browser types it.
    expect(keyCommand(key('a'), inFilter)).toBeNull();
  });

  it('ignores shortcuts, IME composition and other fields', () => {
    expect(keyCommand(key('a', { metaKey: true }), onPage)).toBeNull();
    expect(keyCommand(key('ArrowDown', { ctrlKey: true }), typed)).toBeNull();
    expect(keyCommand(key('Enter', { isComposing: true }), typed)).toBeNull();
    expect(keyCommand(key('Escape'), { ...onPage, inOtherField: true })).toBeNull();
  });
});
