import { CARD_FONTS, drawResultCard, resultCardSize, type CardStep, type ResultCard } from '../card';
import { dayNumber, fold } from '../logic';
import { displaySite, pagePath } from '../preview-pages';
import { href } from '../router';
import type { Mode, Qid } from '../types';
import { h } from './dom';
import type { ResultContext } from './result';

/** The site's root, without the hash or a file name, e.g. https://sixdegrees.sidharthjoly.com/. */
export const siteBase = () => `${location.origin}${location.pathname.replace(/[^/]*$/, '')}`;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The part of a puzzle link after the site root. With `staticPages` (production builds) a
 * daily links to its page under d/<date>/, which carries that day's link-preview tags and
 * forwards to the game (scripts/previews.ts); otherwise it's the hash route.
 */
export function puzzlePath(p: { day: string | null; start: Qid; mode: Mode }, staticPages: boolean): string {
  if (p.day && staticPages && DAY_RE.test(p.day)) return pagePath(p.day, p.mode);
  return p.day ? href({ name: 'daily', day: p.day, mode: p.mode, vs: null }) : href({ name: 'play', qid: p.start, mode: p.mode, vs: null });
}

/** Link that replays the same puzzle: the day's daily, or free play from the same person. */
export function puzzleUrl(p: { day: string | null; start: Qid; mode: Mode }): string {
  return siteBase() + puzzlePath(p, import.meta.env.PROD);
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

// ------------------------------------------------------------------ result screen

/**
 * The result screen's share control: one button (the row beside it stays tidy on a phone)
 * that opens a sheet with the share image, a "Show my path" switch, and the ways to send it.
 */
export function shareActions(ctx: ResultContext): Node {
  const images = cardImages(ctx);
  const btn = h('button', { class: 'btn primary', type: 'button', 'aria-haspopup': 'dialog' }, 'Share result');
  btn.addEventListener('click', () => openShareSheet(ctx, images));
  // Draw the spoiler-free image while the player reads the result, so it's ready on tap.
  // iOS only lets navigator.share() open the share sheet straight after a tap; drawing
  // after the tap can use up that window.
  whenIdle(() => void images.get(false).catch(() => undefined));
  return btn;
}

const GRADE_WORDS = { closer: 'closer', same: 'no closer', further: 'further' } as const;

/** The card's data: spoiler-free, or with the countdown's films and co-stars. */
export function resultCard(ctx: ResultContext, withPath: boolean, site: string): ResultCard {
  const path: CardStep[] = [
    ...ctx.moves.map((m) => ({ film: m.film.title, year: m.film.year, person: m.person.name, grade: m.grade, hinted: m.hinted })),
    ...ctx.revealed.map((s) => ({ film: s.film.title, year: s.film.year, person: s.person.name, revealed: true })),
  ];
  return {
    label: ctx.day ? `Daily #${dayNumber(ctx.day)}` : 'Free play',
    hard: ctx.mode === 'hard',
    start: ctx.start.name,
    par: ctx.par,
    moves: ctx.moves.map((m) => ({ grade: m.grade, hinted: m.hinted })),
    gaveUp: ctx.gaveUp,
    site,
    path: withPath ? path : undefined,
  };
}

/** What the image shows, for the preview's alt text. */
export function cardAlt(card: ResultCard): string {
  const moves = card.moves.map((m) => GRADE_WORDS[m.grade] + (m.hinted ? ' with a hint' : '')).join(', ');
  const result = card.gaveUp ? `gave up after ${card.moves.length}` : `${card.moves.length}`;
  const parts = [`${card.label}${card.hard ? ', hard mode' : ''}. ${card.start} to Justin Timberlake: ${result} ${card.moves.length === 1 ? 'film' : 'films'}, par ${card.par}.`];
  if (moves) parts.push(`Moves: ${moves}.`);
  if (card.path) parts.push(`Path: ${card.path.map((s) => `${s.film}${s.year ? ` (${s.year})` : ''} with ${s.person}`).join('; ')}.`);
  return parts.join(' ');
}

export function fileName(ctx: Pick<ResultContext, 'day' | 'mode' | 'start'>): string {
  const which = ctx.day ? String(dayNumber(ctx.day)) : fold(ctx.start.name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'free-play';
  return `six-degrees-jt-${which}${ctx.mode === 'hard' ? '-hard' : ''}.png`;
}

interface CardImages {
  /** The PNG, drawn once per variant. */
  get(withPath: boolean): Promise<Blob>;
  /** The PNG if it's already drawn, so a tap can share it without waiting. */
  ready(withPath: boolean): Blob | undefined;
}

function cardImages(ctx: ResultContext): CardImages {
  const pending = new Map<boolean, Promise<Blob>>();
  const done = new Map<boolean, Blob>();
  return {
    get(withPath) {
      let p = pending.get(withPath);
      if (!p) {
        p = drawPng(resultCard(ctx, withPath, displaySite(siteBase())));
        pending.set(withPath, p);
        p.then((blob) => done.set(withPath, blob)).catch(() => pending.delete(withPath));
      }
      return p;
    },
    ready: (withPath) => done.get(withPath),
  };
}

/** Wait (briefly) for the webfonts, including the subsets this card's text needs, then draw. */
async function drawPng(card: ResultCard): Promise<Blob> {
  const sample = [card.label, card.start, card.site, ...(card.path ?? []).flatMap((s) => [s.film, s.person])].join(' ');
  const fonts = Promise.all(CARD_FONTS.map((f) => document.fonts.load(f, sample)));
  // A slow or blocked font shouldn't stop the share: after 3s, draw with the fallbacks.
  await Promise.race([fonts.catch(() => undefined), new Promise((r) => setTimeout(r, 3000))]);
  const { width, height } = resultCardSize(card);
  const canvas = h('canvas', { width, height });
  const c2d = canvas.getContext('2d');
  if (!c2d) throw new Error('Canvas isn’t available');
  drawResultCard(c2d, card);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Couldn’t draw the image'))), 'image/png'));
}

function whenIdle(fn: () => void): void {
  if ('requestIdleCallback' in window) requestIdleCallback(fn, { timeout: 1500 });
  else setTimeout(fn, 300);
}

/** Phones get the share sheet; desktops get download and copy, which is what people do there. */
function canShareFiles(): boolean {
  if (!matchMedia('(pointer: coarse)').matches || typeof navigator.canShare !== 'function') return false;
  try {
    return navigator.canShare({ files: [new File([''], 'card.png', { type: 'image/png' })] });
  } catch {
    return false;
  }
}

const canCopyImage = () => typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard?.write === 'function';

function openShareSheet(ctx: ResultContext, images: CardImages): void {
  let withPath = false;
  let objectUrl: string | null = null;
  const name = fileName(ctx);
  const site = displaySite(siteBase());

  const status = h('p', { class: 'share-status', role: 'status' });
  const say = (msg: string) => {
    status.textContent = msg;
  };
  const img = h('img', { class: 'share-img', alt: '' });
  const preview = h('div', { class: 'share-preview', 'aria-busy': 'true' }, img);
  const toggle = h('input', { type: 'checkbox', role: 'switch', id: 'share-path', class: 'share-switch' });
  const close = h('button', { type: 'button', class: 'share-close', 'aria-label': 'Close' }, '×');

  const show = () => {
    const variant = withPath;
    const card = resultCard(ctx, variant, site);
    const { width, height } = resultCardSize(card);
    preview.setAttribute('aria-busy', 'true');
    // The right shape before the image arrives, so the sheet doesn't jump.
    img.width = width;
    img.height = height;
    images
      .get(variant)
      .then((blob) => {
        if (variant !== withPath || !dialog.open) return;
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = URL.createObjectURL(blob);
        img.src = objectUrl;
        img.alt = cardAlt(card);
        preview.setAttribute('aria-busy', 'false');
      })
      .catch(() => say('Couldn’t draw the image. Copy the text instead.'));
  };

  const actions: HTMLElement[] = [];
  if (canShareFiles()) {
    actions.push(action('Share image', 'primary', async () => {
      // No await before share() when the image is ready, so iOS still counts it as the tap's.
      const blob = images.ready(withPath) ?? (await images.get(withPath));
      try {
        await navigator.share({ files: [new File([blob], name, { type: 'image/png' })], text: ctx.text });
      } catch (err) {
        if ((err as Error).name !== 'AbortError') say('Couldn’t open the share sheet. Press and hold the image to save it.');
      }
    }));
  } else {
    actions.push(action('Download image', 'primary', async () => {
      const url = URL.createObjectURL(await images.get(withPath));
      h('a', { href: url, download: name }).click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      say('Image saved to your downloads.');
    }));
    if (canCopyImage()) {
      actions.push(action('Copy image', '', async () => {
        try {
          // Safari wants the ClipboardItem made during the tap, holding a promise of the image.
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': images.get(withPath) })]);
          say('Image copied. Paste it into a chat.');
        } catch {
          say('Couldn’t copy the image. Download it instead.');
        }
      }));
    }
  }
  actions.push(action('Copy text', '', async () => {
    try {
      await navigator.clipboard.writeText(ctx.text);
      say('Text copied. Paste it into a chat.');
    } catch {
      say('Couldn’t copy the text.');
    }
  }));

  const dialog = h(
    'dialog',
    { class: 'share-dialog', 'aria-labelledby': 'share-title' },
    h(
      'div',
      { class: 'share-sheet' },
      h('div', { class: 'share-head' }, h('h2', { id: 'share-title' }, 'Share your countdown'), close),
      preview,
      h(
        'label',
        { class: 'share-toggle', for: 'share-path' },
        toggle,
        h('span', null, h('span', { class: 'share-toggle-label' }, 'Show my path'), h('span', { class: 'share-toggle-sub' }, 'Adds the films and co-stars. Spoilers!')),
      ),
      h('div', { class: 'share-buttons' }, ...actions),
      status,
    ),
  );

  toggle.addEventListener('change', () => {
    withPath = toggle.checked;
    say('');
    show();
  });
  close.addEventListener('click', () => dialog.close());
  // A tap on the backdrop (outside the sheet) closes it, like a phone's share sheet.
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    dialog.remove();
  });

  document.body.append(dialog);
  dialog.showModal();
  show();
}

function action(label: string, kind: 'primary' | '', run: () => Promise<void>): HTMLButtonElement {
  const btn = h('button', { type: 'button', class: 'btn' + (kind ? ` ${kind}` : '') }, label);
  btn.addEventListener('click', () => void run());
  return btn;
}
