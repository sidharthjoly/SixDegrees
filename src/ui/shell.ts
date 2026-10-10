import { StaleDataError, getReach, loadBollywood, loadMeta } from '../data';
import { href } from '../router';
import type { World } from '../storage';
import type { Mode, Qid } from '../types';
import { h } from './dom';
import { leaveScreen } from './leave';

export { onLeave } from './leave';

export const app = document.querySelector<HTMLElement>('#app')!;
/** Outside <main> so the home page's ticker runs the full window width. */
export const tickerSlot = document.querySelector<HTMLElement>('#ticker')!;

/** Bumped on every navigation so late fetches don't render over a newer view. */
let generation = 0;

export function beginNavigation(): number {
  leaveScreen();
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

/**
 * Free play from someone in the daily pool: famous, and at least two films from JT. Heading
 * for another star, skip that star, and try a few times for someone who isn't one of their
 * co-stars, which would be a one-move game. A Bollywood star's starts are Bollywood's own, the
 * ones the Bollywood daily picks from (all at least two films from Shah Rukh Khan).
 */
export async function randomStart(mode: Mode = 'normal', target?: Qid): Promise<void> {
  const { daily, targets } = await loadMeta();
  const bollywood = targets.find((t) => t.id === target)?.world === 'bollywood';
  const pool = (bollywood ? (await loadBollywood()).starts : daily).filter((id) => id !== target);
  const pick = () => pool[Math.floor(Math.random() * pool.length)];
  let qid = pick();
  for (let tries = 1; target && tries < 5; tries++) {
    const near = await getReach(target, qid).then((r) => r.dist < 2, () => false);
    if (!near) break;
    qid = pick();
  }
  go(href({ name: 'play', qid, mode, vs: null, target }));
}

const DEFAULT_TITLE = 'Six Degrees of Justin Timberlake';

/** The browser toolbar's colour in each world, light and dark: the page background (index.html). */
const TOOLBAR: Record<World, [string, string]> = { hollywood: ['#b9b4ff', '#1b1745'], bollywood: ['#ffbf57', '#3a0b1d'] };

/**
 * Which world's colours the page is in: Bollywood mode's (styles/base.css) or JT's. The home page
 * and the pages around it follow the player's choice; a game follows its puzzle, so a Bollywood
 * daily is in Bollywood's colours whoever opens it.
 */
export function showWorld(world: World): void {
  const root = document.documentElement;
  if (world === 'bollywood') root.dataset.world = 'bollywood';
  else delete root.dataset.world;
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.content = TOOLBAR[world][meta.media.includes('dark') ? 1 : 0];
  }
}

const shownWorld = (): World => (document.documentElement.dataset.world === 'bollywood' ? 'bollywood' : 'hollywood');

export function topBar(): HTMLElement {
  return h('header', { class: 'bar' }, h('a', { href: '#/', class: 'home-link' }, shownWorld() === 'bollywood' ? 'Six Degrees of SRK' : 'Six Degrees of JT'));
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
