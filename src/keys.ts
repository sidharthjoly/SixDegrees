/**
 * Keyboard play. The mapping from key to command is pure so it can be tested; the play
 * screen decides what each command does.
 */

export type KeyCommand =
  /** Move the highlight through the options. */
  | 'up'
  | 'down'
  /** Choose the highlighted option. */
  | 'pick'
  /** Empty the filter box. */
  | 'clear'
  /** Close the cast list, or undo the last move. */
  | 'back'
  | 'hint'
  /** A printable key while focus is elsewhere: send it to the filter box. */
  | 'type';

export type KeyLike = Pick<KeyboardEvent, 'key' | 'code' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'repeat' | 'isComposing'>;

export interface KeyContext {
  /** Focus is in the play screen's filter box. */
  inFilter: boolean;
  /** Focus is in some other field or control that should keep its own keys. */
  inOtherField: boolean;
  /** The filter box has text in it. */
  filterHasText: boolean;
}

export function keyCommand(e: KeyLike, ctx: KeyContext): KeyCommand | null {
  // Leave browser and OS shortcuts alone, and never interrupt an IME mid-word.
  if (e.isComposing || e.ctrlKey || e.metaKey) return null;
  if (ctx.inOtherField) return null;
  // Match the physical key: on macOS Alt+H types "˙", so e.key is no use.
  if (e.altKey) return e.code === 'KeyH' && !e.shiftKey ? 'hint' : null;
  // A held key auto-repeats. Arrows may (scrolling a long list), but a held Escape,
  // Backspace or Enter must not run on into undoing moves or picking someone by accident.
  if (e.repeat && (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'Enter')) return null;
  switch (e.key) {
    case 'Escape':
      return ctx.filterHasText ? 'clear' : 'back';
    case 'Backspace':
      // Only an already-empty box: Backspace in text just deletes.
      return ctx.filterHasText ? null : 'back';
    case 'ArrowUp':
      return ctx.inFilter ? 'up' : null;
    case 'ArrowDown':
      return ctx.inFilter ? 'down' : null;
    case 'Enter':
      return ctx.inFilter && !e.shiftKey ? 'pick' : null;
  }
  // Space stays with the page (scrolling) and with buttons (pressing them).
  return !ctx.inFilter && e.key.length === 1 && e.key !== ' ' ? 'type' : null;
}

/**
 * Listen for keys on the whole document, but only while `anchor` is on the page. Typing
 * has to reach the filter box even when focus has fallen back to <body>, yet other screens
 * must never see these keys. `container` is the element whose children every screen
 * replaces; the listener drops itself the moment `anchor` leaves it. Returns a stop function.
 */
export function keysWhileMounted(anchor: Element, container: Node, onKey: (e: KeyboardEvent) => void): () => void {
  const ctrl = new AbortController();
  const observer = new MutationObserver(() => {
    if (!anchor.isConnected) stop();
  });
  function stop(): void {
    ctrl.abort();
    observer.disconnect();
  }
  document.addEventListener(
    'keydown',
    (e) => {
      if (anchor.isConnected) onKey(e);
      else stop();
    },
    { signal: ctrl.signal },
  );
  observer.observe(container, { childList: true });
  return stop;
}
