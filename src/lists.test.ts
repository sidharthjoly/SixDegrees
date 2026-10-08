import { describe, expect, it } from 'vitest';
import { foldList } from './lists';

interface Item {
  id: number;
  fame: number;
}
/** Best-known-first items with the given fames. */
const items = (...fames: number[]): Item[] => fames.map((fame, id) => ({ id, fame }));
const fameOf = (it: Item) => it.fame;
const ids = (xs: Item[]) => xs.map((x) => x.id);

describe('foldList', () => {
  it('shows short lists in full', () => {
    expect(foldList(items(1, 0, 0), fameOf)).toEqual({ shown: items(1, 0, 0), hidden: 0 });
  });

  it('shows everyone well known, folding the obscure tail', () => {
    const list = items(...Array(15).fill(10), ...Array(20).fill(1));
    const { shown, hidden } = foldList(list, fameOf);
    expect(shown).toHaveLength(15);
    expect(hidden).toBe(20);
  });

  it('shows at least the top 12 even when nobody is well known', () => {
    const { shown, hidden } = foldList(items(...Array(40).fill(0)), fameOf);
    expect(shown).toHaveLength(12);
    expect(hidden).toBe(28);
  });

  it('caps a long list of well-known entries', () => {
    const { shown, hidden } = foldList(items(...Array(150).fill(50)), fameOf);
    expect(shown).toHaveLength(30);
    expect(hidden).toBe(120);
  });

  it('does not fold away just a few entries', () => {
    expect(foldList(items(...Array(12).fill(9), 1, 1, 1), fameOf).hidden).toBe(0);
    expect(foldList(items(...Array(12).fill(9), 1, 1, 1, 1), fameOf).hidden).toBe(4);
  });

  it('never folds pinned entries', () => {
    const list = items(...Array(40).fill(0));
    const { shown, hidden } = foldList(list, fameOf, (it) => it.id === 33);
    expect(ids(shown)).toEqual([...Array(12).keys(), 33]);
    expect(hidden).toBe(27);
  });

  it('takes custom thresholds', () => {
    const { shown } = foldList(items(...Array(20).fill(2)), fameOf, undefined, { minFame: 2, atLeast: 1, atMost: 5, slack: 0 });
    expect(shown).toHaveLength(5);
  });
});
