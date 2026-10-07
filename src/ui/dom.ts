import type { FilmRef } from '../types';

export type Child = Node | string | number | null | undefined | false;

/** Tiny element builder: props become attributes, `on*` functions become listeners. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c !== null && c !== undefined && c !== false) el.append(typeof c === 'number' ? String(c) : c);
  }
  return el;
}

export const yearOf = (f: FilmRef) => (f.year ? ` (${f.year})` : '');
