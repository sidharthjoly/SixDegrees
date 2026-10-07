import { beforeEach, describe, expect, it } from 'vitest';
import { listDailies, loadDaily, migrateV1, saveDaily, type DailyRecord } from './storage';

class MemoryStorage {
  private data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  key(i: number) {
    return [...this.data.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

const rec = (over: Partial<DailyRecord> = {}): DailyRecord => ({
  v: 2,
  day: '2026-10-08',
  mode: 'normal',
  start: 11571,
  par: 3,
  moves: [{ grade: 'closer', hinted: false }],
  path: [[3, 10]],
  gaveUp: false,
  late: false,
  at: '2026-10-08T20:00:00.000Z',
  ...over,
});

let storage: MemoryStorage;
beforeEach(() => {
  storage = new MemoryStorage();
  (globalThis as { window?: unknown }).window = { localStorage: storage };
});

describe('daily records', () => {
  it('keeps normal and hard results apart', () => {
    saveDaily(rec());
    saveDaily(rec({ mode: 'hard', par: 4 }));
    expect(loadDaily('2026-10-08', 'normal')?.par).toBe(3);
    expect(loadDaily('2026-10-08', 'hard')?.par).toBe(4);
  });

  it('keeps the first finish and ignores replays', () => {
    saveDaily(rec());
    saveDaily(rec({ moves: [] }));
    expect(loadDaily('2026-10-08', 'normal')?.moves).toHaveLength(1);
  });

  it('replaces a record for a different start (the day was re-picked by a data rebuild)', () => {
    saveDaily(rec());
    saveDaily(rec({ start: 99 }));
    expect(loadDaily('2026-10-08', 'normal')?.start).toBe(99);
  });

  it('lists records oldest first and skips junk', () => {
    saveDaily(rec({ day: '2026-10-10' }));
    saveDaily(rec({ day: '2026-10-09', mode: 'hard' }));
    storage.setItem('sixdeg:v2:daily:2026-10-11:normal', '{not json');
    storage.setItem('unrelated', '1');
    expect(listDailies().map((r) => `${r.day}:${r.mode}`)).toEqual(['2026-10-09:hard', '2026-10-10:normal']);
  });

  it('survives storage being unavailable', () => {
    (globalThis as { window?: unknown }).window = {
      get localStorage(): Storage {
        throw new Error('blocked');
      },
    };
    expect(() => saveDaily(rec())).not.toThrow();
    expect(loadDaily('2026-10-08', 'normal')).toBeNull();
    expect(listDailies()).toEqual([]);
  });
});

describe('migrateV1', () => {
  it('converts version-1 results to normal-mode records and removes the old keys', () => {
    storage.setItem('sixdeg:daily:2026-10-08', JSON.stringify({ start: 2080040, moves: [{ grade: 'same', hinted: true }], par: 4, gaveUp: false }));
    storage.setItem('sixdeg:daily:2026-10-09', 'garbage');
    migrateV1();
    const r = loadDaily('2026-10-08', 'normal');
    expect(r).toMatchObject({ v: 2, start: 2080040, par: 4, mode: 'normal', path: [], late: false });
    expect(storage.getItem('sixdeg:daily:2026-10-08')).toBeNull();
    expect(storage.getItem('sixdeg:daily:2026-10-09')).toBeNull();
  });
});
