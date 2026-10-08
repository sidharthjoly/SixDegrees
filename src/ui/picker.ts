import { h, type Child } from './dom';

export interface PickOption {
  /** DOM id, stable across refills so the highlight stays on an entry as results stream in. */
  id: string;
  content: Child[];
  className?: string;
  /** Shown but can't be chosen (a banned film, or anything while a move is loading). */
  disabled?: boolean;
  /** Accessible name, when the visible text alone would be unclear. */
  label?: string;
  choose: () => void;
}

export interface PickGroup {
  /** Heading; leave out for a single plain list. */
  label?: string;
  /** Short status beside the heading, e.g. search progress. */
  aside?: string;
  options: PickOption[];
}

interface Shown {
  opt: PickOption;
  el: HTMLButtonElement;
}

/**
 * A filter box driving the list under it: a combobox whose listbox is always open, with the
 * first match selected automatically (the APG "list autocomplete" pattern). Focus stays in
 * the box while ↑/↓ move the highlight (aria-activedescendant), so typing never stops
 * working. Options are still real buttons, so mouse, touch and screen readers can press them.
 */
export class Picker {
  readonly input: HTMLInputElement;
  readonly list: HTMLElement;
  private shown: Shown[] = [];
  /** The highlighted option's id; null follows the first enabled option. */
  private active: string | null = null;

  constructor(
    private readonly id: string,
    opts: { label: string; placeholder: string; value: string; describedBy?: string; onInput: (value: string) => void },
  ) {
    this.list = h('div', { class: 'options', id: `${id}-list`, role: 'listbox', 'aria-label': opts.label });
    this.input = h('input', {
      type: 'search',
      class: 'filter',
      id: `${id}-input`,
      value: opts.value,
      placeholder: opts.placeholder,
      'aria-label': opts.label,
      autocomplete: 'off',
      autocapitalize: 'off',
      spellcheck: 'false',
      enterkeyhint: 'go',
      role: 'combobox',
      'aria-expanded': 'true',
      'aria-autocomplete': 'list',
      'aria-controls': this.list.id,
      'aria-describedby': opts.describedBy,
      oninput: () => {
        // New text, new matches: go back to highlighting the best one.
        this.active = null;
        opts.onInput(this.input.value);
      },
    });
  }

  /** Replace the options, keeping the highlight on the same entry if it's still there. */
  setGroups(groups: PickGroup[]): void {
    this.shown = [];
    const option = (o: PickOption) => {
      const el = h(
        'button',
        {
          type: 'button',
          id: o.id,
          role: 'option',
          class: 'option' + (o.className ? ` ${o.className}` : ''),
          // The box owns keyboard focus; Tab goes past the list rather than through every entry.
          tabindex: '-1',
          disabled: o.disabled,
          'aria-disabled': o.disabled ? 'true' : undefined,
          'aria-label': o.label,
          onclick: () => o.choose(),
        },
        ...o.content,
      );
      this.shown.push({ opt: o, el });
      return el;
    };
    const children = groups.flatMap((g, i): Node[] => {
      if (!g.label) return g.options.map(option);
      const labelId = `${this.id}-g${i}`;
      return [
        h(
          'div',
          { class: 'opt-group', role: 'group', 'aria-labelledby': labelId },
          // The heading names the group for screen readers through aria-labelledby; hidden
          // itself so it isn't read again as loose text between options.
          h('div', { class: 'opt-group-head', 'aria-hidden': 'true' }, h('span', { id: labelId, class: 'opt-group-label' }, g.label), g.aside && h('span', { class: 'opt-aside' }, g.aside)),
          ...g.options.map(option),
        ),
      ];
    });
    this.list.replaceChildren(...children);
    this.paint(false);
  }

  /** Move the highlight by `delta` enabled options, stopping at either end. */
  move(delta: number): void {
    const enabled = this.enabled();
    if (enabled.length === 0) return;
    const at = enabled.indexOf(this.current()!);
    this.active = enabled[Math.max(0, Math.min(enabled.length - 1, at + delta))].opt.id;
    this.paint(true);
  }

  highlight(id: string): void {
    this.active = id;
    this.paint(true);
  }

  /** Choose the highlighted option, or the first enabled one. False when there's nothing to choose. */
  choose(): boolean {
    const cur = this.current();
    if (!cur) return false;
    cur.opt.choose();
    return true;
  }

  get value(): string {
    return this.input.value;
  }

  set value(v: string) {
    this.input.value = v;
    this.active = null;
  }

  private enabled(): Shown[] {
    return this.shown.filter((s) => !s.opt.disabled);
  }

  private current(): Shown | undefined {
    const enabled = this.enabled();
    return enabled.find((s) => s.opt.id === this.active) ?? enabled[0];
  }

  private paint(scroll: boolean): void {
    const cur = this.current();
    // Forget a highlight whose entry has gone, so it can't jump back if the entry returns.
    if (this.active !== null && cur?.opt.id !== this.active) this.active = null;
    for (const s of this.shown) {
      s.el.classList.toggle('active', s === cur);
      s.el.setAttribute('aria-selected', s === cur ? 'true' : 'false');
    }
    // Leave the attribute alone when it hasn't changed, so streaming results don't make
    // screen readers re-read the same option.
    if (!cur) this.input.removeAttribute('aria-activedescendant');
    else if (this.input.getAttribute('aria-activedescendant') !== cur.opt.id) this.input.setAttribute('aria-activedescendant', cur.opt.id);
    if (scroll) cur?.el.scrollIntoView({ block: 'nearest' });
  }
}
