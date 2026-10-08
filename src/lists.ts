/**
 * Long cast and film lists fold their obscure tail behind a "+N more" button. Folding is
 * visual only: callers still filter and search the whole list.
 */

export interface FoldOptions {
  /** Wikipedia sitelinks that count as well known. */
  minFame?: number;
  /** Always show at least this many, well known or not. */
  atLeast?: number;
  /** Never show more than this many before folding (pinned entries aside). */
  atMost?: number;
  /** Don't fold away this few entries or fewer: a "+2 more" button is just noise. */
  slack?: number;
}

export interface Folded<T> {
  shown: T[];
  hidden: number;
}

/**
 * Show every well-known entry, but at least `atLeast` and at most `atMost`, plus any
 * pinned entry (JT, the hinted one) wherever it sits. Expects best-known-first order.
 */
export function foldList<T>(items: T[], fame: (item: T) => number, pinned: (item: T) => boolean = () => false, opts: FoldOptions = {}): Folded<T> {
  const { minFame = 3, atLeast = 12, atMost = 30, slack = 3 } = opts;
  const known = items.filter((it) => fame(it) >= minFame).length;
  const cut = Math.min(Math.max(known, atLeast), atMost);
  if (items.length - cut <= slack) return { shown: items, hidden: 0 };
  const shown = items.filter((it, i) => i < cut || pinned(it));
  return { shown, hidden: items.length - shown.length };
}
