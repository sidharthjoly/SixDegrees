import { href } from '../router';
import type { Mode, Qid } from '../types';
import { h } from './dom';

/** The page's own address without the hash, e.g. https://sixdegrees.sidharthjoly.com/. */
export const siteBase = () => `${location.origin}${location.pathname}`;

/** Link that replays the same puzzle: the day's daily, or free play from the same person. */
export function puzzleUrl(p: { day: string | null; start: Qid; mode: Mode }): string {
  return siteBase() + (p.day ? href({ name: 'daily', day: p.day, mode: p.mode, vs: null }) : href({ name: 'play', qid: p.start, mode: p.mode, vs: null }));
}

/** Shares on phones, copies to the clipboard elsewhere. */
export function shareButton(text: string): HTMLButtonElement {
  const btn = h('button', { class: 'btn primary', type: 'button' }, 'Share result');
  btn.addEventListener('click', async () => {
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ text });
        return;
      }
      await navigator.clipboard.writeText(text);
      btn.textContent = 'Copied!';
    } catch {
      btn.textContent = 'Couldn’t copy';
    }
    setTimeout(() => (btn.textContent = 'Share result'), 2000);
  });
  return btn;
}
