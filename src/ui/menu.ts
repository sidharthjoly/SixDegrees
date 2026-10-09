import { h } from './dom';

export interface MenuItem {
  value: number;
  label: string;
  /** A second, smaller line, e.g. what they're known for. */
  sub?: string;
}

export interface Menu {
  el: HTMLElement;
  /** Show `value` as chosen, without calling onChange. */
  set(value: number): void;
}

/** How long a pause ends a typed run of letters ("to" finds Tom, then "tom c" Tom Cruise). */
const TYPEAHEAD_MS = 600;

/**
 * A drop-down list in the site's own style, in place of a <select>, whose list the system
 * draws in its own. A button shows the choice and opens the list under it (the APG
 * "collapsible listbox" pattern): ↑/↓, Home/End and typing a name move through it, Enter or
 * Space picks, and Esc, Tab or a tap outside closes it without changing anything.
 */
export function dropdown(opts: { id: string; labelledBy: string; items: MenuItem[]; value: number; onChange: (value: number) => void }): Menu {
  const { id, items } = opts;
  let value = opts.value;
  let active = 0;
  let typed = '';
  let typedAt = 0;
  /**
   * A press on the menu is under way. Safari doesn't focus a button it presses, and some
   * browsers drop focus from the list when an option is pressed, so the list can lose focus to
   * nothing before the press lands: that mustn't close it.
   */
  let pressing = false;

  const current = h('span', { class: 'menu-value' });
  const button = h('button', {
    type: 'button',
    class: 'menu-button',
    id: `${id}-button`,
    'aria-haspopup': 'listbox',
    'aria-expanded': 'false',
    'aria-controls': `${id}-list`,
    'aria-labelledby': `${opts.labelledBy} ${id}-button`,
  }, current);
  const optionId = (i: number) => `${id}-${items[i].value}`;
  const options = items.map((item, i) =>
    h(
      'li',
      { class: 'menu-option', id: optionId(i), role: 'option', 'aria-selected': 'false', onclick: () => choose(i) },
      item.label,
      item.sub && h('span', { class: 'opt-sub' }, item.sub),
    ),
  );
  const list = h('ul', { class: 'menu-list', id: `${id}-list`, role: 'listbox', tabindex: '-1', 'aria-labelledby': opts.labelledBy, hidden: true }, ...options);
  const el = h('div', { class: 'menu' }, button, list);

  const indexOf = (v: number) => Math.max(0, items.findIndex((item) => item.value === v));
  const isOpen = () => !list.hidden;

  function highlight(i: number): void {
    options[active]?.classList.remove('active');
    active = (i + items.length) % items.length;
    options[active].classList.add('active');
    list.setAttribute('aria-activedescendant', optionId(active));
    options[active].scrollIntoView({ block: 'nearest' });
  }

  // A tap anywhere else closes the list, as a system one would.
  const outside = (e: PointerEvent) => {
    if (!el.isConnected || !el.contains(e.target as Node)) close(false);
  };

  function open(): void {
    if (isOpen()) return;
    list.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', outside, true);
    list.focus({ preventScroll: true });
    highlight(indexOf(value));
  }

  function close(refocus = true): void {
    if (!isOpen()) return;
    list.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    list.removeAttribute('aria-activedescendant');
    document.removeEventListener('pointerdown', outside, true);
    if (refocus) button.focus({ preventScroll: true });
  }

  function choose(i: number): void {
    const next = items[i].value;
    close();
    if (next === value) return;
    set(next);
    opts.onChange(next);
  }

  function set(v: number): void {
    value = v;
    const i = indexOf(v);
    current.textContent = items[i].label;
    options.forEach((o, j) => o.setAttribute('aria-selected', String(j === i)));
  }

  el.addEventListener('pointerdown', () => {
    pressing = true;
    // After the click that follows, which comes in the same go as the pointer lifting.
    const release = () => setTimeout(() => (pressing = false));
    window.addEventListener('pointerup', release, { once: true, capture: true });
    window.addEventListener('pointercancel', release, { once: true, capture: true });
  });
  button.addEventListener('click', () => (isOpen() ? close() : open()));
  button.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      open();
    }
  });
  list.addEventListener('keydown', (e) => {
    const step: Record<string, () => number> = {
      ArrowDown: () => active + 1,
      ArrowUp: () => active - 1,
      Home: () => 0,
      End: () => items.length - 1,
      PageDown: () => Math.min(items.length - 1, active + 5),
      PageUp: () => Math.max(0, active - 5),
    };
    if (step[e.key]) {
      e.preventDefault();
      highlight(step[e.key]());
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      choose(active);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') {
      close(false);
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Type to find: the next name starting with what's been typed.
      const now = Date.now();
      typed = now - typedAt > TYPEAHEAD_MS ? e.key.toLowerCase() : typed + e.key.toLowerCase();
      typedAt = now;
      const from = typed.length === 1 ? active + 1 : active;
      for (let k = 0; k < items.length; k++) {
        const i = (from + k) % items.length;
        if (items[i].label.toLowerCase().startsWith(typed)) {
          highlight(i);
          break;
        }
      }
    }
  });
  // Focus leaving the list (Tab, or a tap that moves it) closes it.
  list.addEventListener('focusout', (e) => {
    if (!pressing && !el.contains(e.relatedTarget as Node | null)) close(false);
  });

  set(value);
  return { el, set };
}
