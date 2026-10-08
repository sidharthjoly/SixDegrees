import { CARD_FONTS, STORY_HEIGHT, STORY_WIDTH, drawResultCard, drawStory, resultCardSize, type CardStep, type ResultCard, type StoryCard } from '../card';
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
  const videos = new Map<boolean, Promise<Blob>>();
  const btn = h('button', { class: 'btn primary', type: 'button', 'aria-haspopup': 'dialog' }, 'Share result');
  btn.addEventListener('click', () => openShareSheet(ctx, images, videos));
  // Draw the spoiler-free image while the player reads the result, so it's ready on tap.
  // iOS only lets navigator.share() open the share sheet straight after a tap; drawing
  // after the tap can use up that window.
  whenIdle(() => void images.get({ format: 'square', withPath: false }).catch(() => undefined));
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

/** The square image's file name; `kind` names the story image and the video after it. */
export function fileName(ctx: Pick<ResultContext, 'day' | 'mode' | 'start'>, kind: 'square' | 'story' | 'video' = 'square'): string {
  const which = ctx.day ? String(dayNumber(ctx.day)) : fold(ctx.start.name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'free-play';
  const base = `six-degrees-jt-${which}${ctx.mode === 'hard' ? '-hard' : ''}`;
  return kind === 'video' ? `${base}.mp4` : `${base}${kind === 'story' ? '-story' : ''}.png`;
}

/** The story card's data: the result card, plus how the player stood against everyone that day. */
export function storyCard(ctx: ResultContext, withPath: boolean, site: string): StoryCard {
  return { ...resultCard(ctx, withPath, site), standing: ctx.standing?.() ?? undefined };
}

type Format = 'square' | 'story';

interface Variant {
  format: Format;
  withPath: boolean;
}

const variantKey = (v: Variant) => `${v.format}:${v.withPath}`;

interface CardImages {
  /** The PNG, drawn once per variant. */
  get(v: Variant): Promise<Blob>;
  /** The PNG if it's already drawn, so a tap can share it without waiting. */
  ready(v: Variant): Blob | undefined;
}

function cardImages(ctx: ResultContext): CardImages {
  const pending = new Map<string, Promise<Blob>>();
  const done = new Map<string, Blob>();
  // A story drawn before the day's standing arrived is redrawn with it.
  const keyOf = (v: Variant) => variantKey(v) + (v.format === 'story' ? `:${ctx.standing?.() ?? ''}` : '');
  return {
    get(v) {
      const key = keyOf(v);
      let p = pending.get(key);
      if (!p) {
        const site = displaySite(siteBase());
        p = v.format === 'story' ? drawPng(storyCard(ctx, v.withPath, site), 'story') : drawPng(resultCard(ctx, v.withPath, site), 'square');
        pending.set(key, p);
        p.then((blob) => done.set(key, blob)).catch(() => pending.delete(key));
      }
      return p;
    },
    ready: (v) => done.get(keyOf(v)),
  };
}

/** Wait (briefly) for the webfonts, including the subsets this card's text needs. */
async function cardFonts(card: ResultCard): Promise<void> {
  const sample = [card.label, card.start, card.site, ...(card.path ?? []).flatMap((s) => [s.film, s.person])].join(' ');
  const fonts = Promise.all(CARD_FONTS.map((f) => document.fonts.load(f, sample)));
  // A slow or blocked font shouldn't stop the share: after 3s, draw with the fallbacks.
  await Promise.race([fonts.catch(() => undefined), new Promise((r) => setTimeout(r, 3000))]);
}

async function drawPng(card: ResultCard, format: Format): Promise<Blob> {
  await cardFonts(card);
  const { width, height } = format === 'story' ? { width: STORY_WIDTH, height: STORY_HEIGHT } : resultCardSize(card);
  const canvas = h('canvas', { width, height });
  const c2d = canvas.getContext('2d');
  if (!c2d) throw new Error('Canvas isn’t available');
  if (format === 'story') drawStory(c2d, card);
  else drawResultCard(c2d, card);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Couldn’t draw the image'))), 'image/png'));
}

function whenIdle(fn: () => void): void {
  if ('requestIdleCallback' in window) requestIdleCallback(fn, { timeout: 1500 });
  else setTimeout(fn, 300);
}

/** Phones get the share sheet; desktops get download and copy, which is what people do there. */
function canShareFiles(type = 'image/png', name = 'card.png'): boolean {
  if (!matchMedia('(pointer: coarse)').matches || typeof navigator.canShare !== 'function') return false;
  try {
    return navigator.canShare({ files: [new File([''], name, { type })] });
  } catch {
    return false;
  }
}

const canCopyImage = () => typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard?.write === 'function';

/**
 * Whether this browser can encode H.264 (WebCodecs), checked without loading the video
 * code. 720p is the size every H.264 encoder handles; video.ts goes bigger where it can.
 */
async function canMakeVideo(): Promise<boolean> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoEncoder.isConfigSupported !== 'function') return false;
  try {
    const { supported } = await VideoEncoder.isConfigSupported({ codec: 'avc1.42001f', width: 720, height: 1280, bitrate: 4_000_000, framerate: 30 });
    return !!supported;
  } catch {
    return false;
  }
}

function saveFile(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  h('a', { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function openShareSheet(ctx: ResultContext, images: CardImages, videos: Map<boolean, Promise<Blob>>): void {
  const view: Variant = { format: 'square', withPath: false };
  /** Showing the video in the frame, since it was just made; any change goes back to the image. */
  let showingVideo = false;
  const urls = new Set<string>();
  const objectUrl = (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    urls.add(url);
    return url;
  };
  const site = displaySite(siteBase());

  const status = h('p', { class: 'share-status', role: 'status' });
  const say = (msg: string) => {
    status.textContent = msg;
  };
  const img = h('img', { class: 'share-img', alt: '' });
  const video = h('video', { class: 'share-img', width: STORY_WIDTH, height: STORY_HEIGHT, muted: true, loop: true, playsinline: true, hidden: true, 'aria-label': 'Your countdown video' });
  // Safari wants these as properties too before it will autoplay inline.
  video.muted = true;
  video.playsInline = true;
  const preview = h('div', { class: 'share-preview', 'aria-busy': 'true' }, img, video);
  const toggle = h('input', { type: 'checkbox', role: 'switch', id: 'share-path', class: 'share-switch' });
  const close = h('button', { type: 'button', class: 'share-close', 'aria-label': 'Close' }, '×');

  const formatButton = (format: Format, label: string, sub: string) => {
    const b = h('button', { type: 'button', class: 'share-format', 'aria-pressed': String(view.format === format) }, h('span', { class: 'share-format-label' }, label), h('span', { class: 'share-format-sub' }, sub));
    b.addEventListener('click', () => {
      if (view.format === format && !showingVideo) return;
      view.format = format;
      for (const other of formats.children) other.setAttribute('aria-pressed', String(other === b));
      changed();
    });
    return b;
  };
  const formats = h('div', { class: 'share-formats', role: 'group', 'aria-label': 'Image shape' }, formatButton('square', 'Square', 'Chats and feeds'), formatButton('story', 'Story', '9:16, for stories'));

  const show = () => {
    const v = { ...view };
    img.hidden = false;
    video.hidden = true;
    video.pause();
    const card = v.format === 'story' ? storyCard(ctx, v.withPath, site) : resultCard(ctx, v.withPath, site);
    const { width, height } = v.format === 'story' ? { width: STORY_WIDTH, height: STORY_HEIGHT } : resultCardSize(card);
    preview.classList.toggle('tall', v.format === 'story');
    preview.setAttribute('aria-busy', 'true');
    // The right shape before the image arrives, so the sheet doesn't jump.
    img.width = width;
    img.height = height;
    images
      .get(v)
      .then((blob) => {
        if (variantKey(v) !== variantKey(view) || showingVideo || !dialog.open) return;
        img.src = objectUrl(blob);
        img.alt = cardAlt(card);
        preview.setAttribute('aria-busy', 'false');
      })
      .catch(() => say('Couldn’t draw the image. Copy the text instead.'));
  };

  const showVideo = (blob: Blob) => {
    showingVideo = true;
    preview.classList.add('tall');
    preview.setAttribute('aria-busy', 'false');
    img.hidden = true;
    video.hidden = false;
    video.src = objectUrl(blob);
    void video.play().catch(() => undefined);
  };

  const imageName = () => fileName(ctx, view.format);

  const actions: HTMLElement[] = [];
  if (canShareFiles()) {
    actions.push(action('Share image', 'primary', async () => {
      // No await before share() when the image is ready, so iOS still counts it as the tap's.
      const v = { ...view };
      const blob = images.ready(v) ?? (await images.get(v));
      try {
        await navigator.share({ files: [new File([blob], imageName(), { type: 'image/png' })], text: ctx.text });
      } catch (err) {
        if ((err as Error).name !== 'AbortError') say('Couldn’t open the share sheet. Press and hold the image to save it.');
      }
    }));
  } else {
    actions.push(action('Download image', 'primary', async () => {
      saveFile(await images.get({ ...view }), imageName());
      say('Image saved to your downloads.');
    }));
    if (canCopyImage()) {
      actions.push(action('Copy image', '', async () => {
        try {
          // Safari wants the ClipboardItem made during the tap, holding a promise of the image.
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': images.get({ ...view }) })]);
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

  /*
   * The video takes a few seconds to make, longer than a phone allows between a tap and
   * opening the share sheet, so it's two taps: make it, then share it.
   */
  const videoName = fileName(ctx, 'video');
  const shareVideoFiles = canShareFiles('video/mp4', 'card.mp4');
  const videoBtn = h('button', { type: 'button', class: 'btn video-btn', hidden: true });
  const videoBlobs = new Map<boolean, Blob>();
  const videoReady = () => videoBlobs.has(view.withPath);
  const labelVideo = () => {
    videoBtn.disabled = false;
    videoBtn.textContent = videoReady() ? (shareVideoFiles ? '▶ Share video' : '▶ Download video') : '▶ Make a video';
  };
  videoBtn.addEventListener('click', async () => {
    const withPath = view.withPath;
    const blob = videoBlobs.get(withPath);
    if (blob) {
      if (!showingVideo) showVideo(blob);
      if (shareVideoFiles) {
        try {
          await navigator.share({ files: [new File([blob], videoName, { type: 'video/mp4' })], text: ctx.text });
        } catch (err) {
          if ((err as Error).name !== 'AbortError') say('Couldn’t open the share sheet. Try downloading instead.');
        }
      } else {
        saveFile(blob, videoName);
        say('Video saved to your downloads.');
      }
      return;
    }
    if (videos.has(withPath)) return;
    videoBtn.disabled = true;
    videoBtn.textContent = 'Making video…';
    say('');
    const card = storyCard(ctx, withPath, site);
    const making = cardFonts(card)
      .then(() => import('./video'))
      .then(({ storyVideo }) =>
        storyVideo(card, (done) => {
          if (view.withPath === withPath && dialog.open) videoBtn.textContent = `Making video… ${Math.round(done * 100)}%`;
        }),
      );
    videos.set(withPath, making);
    try {
      const made = await making;
      videoBlobs.set(withPath, made);
      if (!dialog.open || view.withPath !== withPath) return;
      showVideo(made);
      labelVideo();
      say(shareVideoFiles ? 'Video ready. Tap Share video to post it.' : 'Video ready.');
    } catch {
      videos.delete(withPath);
      if (dialog.open) {
        labelVideo();
        say('Couldn’t make the video on this device. Share the image instead.');
      }
    }
  });
  // Videos made earlier this visit (the sheet can be closed and reopened) are kept.
  for (const [withPath, made] of videos) void made.then((b) => videoBlobs.set(withPath, b)).catch(() => undefined);
  void canMakeVideo().then((ok) => {
    if (!ok || !dialog.open) return;
    labelVideo();
    videoBtn.hidden = false;
  });

  const changed = () => {
    showingVideo = false;
    say('');
    if (!videoBtn.hidden) labelVideo();
    show();
  };

  const dialog = h(
    'dialog',
    { class: 'share-dialog', 'aria-labelledby': 'share-title' },
    h(
      'div',
      { class: 'share-sheet' },
      h('div', { class: 'share-head' }, h('h2', { id: 'share-title' }, 'Share your countdown'), close),
      formats,
      preview,
      h(
        'label',
        { class: 'share-toggle', for: 'share-path' },
        toggle,
        h('span', null, h('span', { class: 'share-toggle-label' }, 'Show my path'), h('span', { class: 'share-toggle-sub' }, 'Adds the films and co-stars. Spoilers!')),
      ),
      h('div', { class: 'share-buttons' }, ...actions),
      videoBtn,
      status,
    ),
  );

  toggle.addEventListener('change', () => {
    view.withPath = toggle.checked;
    changed();
  });
  close.addEventListener('click', () => dialog.close());
  // A tap on the backdrop (outside the sheet) closes it, like a phone's share sheet.
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => {
    video.pause();
    for (const url of urls) URL.revokeObjectURL(url);
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
