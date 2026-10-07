import { StaleDataError, loadMeta } from '../data';
import { href } from '../router';
import type { Mode } from '../types';
import { h } from './dom';

export const app = document.querySelector<HTMLElement>('#app')!;
/** Outside <main> so the home page's ticker runs the full window width. */
export const tickerSlot = document.querySelector<HTMLElement>('#ticker')!;

/** Bumped on every navigation so late fetches don't render over a newer view. */
let generation = 0;

export function beginNavigation(): number {
  tickerSlot.replaceChildren();
  return ++generation;
}

export const isCurrent = (gen: number) => gen === generation;
export const currentGeneration = () => generation;

/** Navigate, re-running the route even when the hash is already `hash`. */
export function go(hash: string): void {
  if (location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = hash;
}

export async function randomStart(mode: Mode = 'normal'): Promise<void> {
  const { daily } = await loadMeta();
  go(href({ name: 'play', qid: daily[Math.floor(Math.random() * daily.length)], mode, vs: null }));
}

const DEFAULT_TITLE = 'Six Degrees of Justin Timberlake';

export function topBar(): HTMLElement {
  return h('header', { class: 'bar' }, h('a', { href: '#/', class: 'home-link' }, 'Six Degrees of JT'));
}

export function renderLoading(text = 'Loading…'): void {
  app.replaceChildren(topBar(), h('p', { class: 'loading', role: 'status' }, text));
}

export function renderMessage(title: string, body: string): void {
  document.title = DEFAULT_TITLE;
  app.replaceChildren(topBar(), h('section', { class: 'card' }, h('h2', null, title), h('p', null, body), h('a', { href: '#/', class: 'btn' }, 'Back home')));
}

export function renderError(err: unknown): void {
  document.title = DEFAULT_TITLE;
  if (err instanceof StaleDataError) {
    app.replaceChildren(
      topBar(),
      h(
        'section',
        { class: 'card', role: 'alert' },
        h('h2', null, 'New version out'),
        h('p', null, err.message),
        h('button', { class: 'btn primary', type: 'button', onclick: () => location.reload() }, 'Reload'),
      ),
    );
    return;
  }
  const msg = err instanceof Error ? err.message : String(err);
  app.replaceChildren(
    topBar(),
    h(
      'section',
      { class: 'card error', role: 'alert' },
      h('h2', null, 'Something went wrong'),
      h('p', null, msg),
      import.meta.env.DEV && h('p', { class: 'muted' }, 'If the data files are missing, run ', h('code', null, 'npm run data'), '.'),
      h('a', { href: '#/', class: 'btn' }, 'Back home'),
    ),
  );
}
