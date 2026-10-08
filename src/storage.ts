import type { MoveSummary } from './logic';
import type { Mode, Qid } from './types';

/**
 * A finished daily, kept in localStorage under one key per day and mode. Only the first
 * finish of a day and mode is kept, like Wordle: replays don't overwrite it.
 */
export interface DailyRecord {
  v: 2;
  /** The daily's date, YYYY-MM-DD. */
  day: string;
  mode: Mode;
  /** Who was played, so a data rebuild that changes the pick can't pair a new name with an old score. */
  start: Qid;
  par: number;
  moves: MoveSummary[];
  /** [film, person] for each move the player made (not the revealed rest after giving up). */
  path: [Qid, Qid][];
  gaveUp: boolean;
  /** Finished on a later date than `day` (from the archive). Doesn't count toward streaks. */
  late: boolean;
  /** When it was finished, ISO 8601. */
  at: string;
}

const PREFIX = 'sixdeg:v2:daily:';
const keyFor = (day: string, mode: Mode) => `${PREFIX}${day}:${mode}`;

/** localStorage, or null when it's blocked (private mode, storage disabled, sandboxed preview). */
function store(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isRecord(x: unknown): x is DailyRecord {
  const r = x as DailyRecord;
  return !!r && r.v === 2 && typeof r.day === 'string' && (r.mode === 'normal' || r.mode === 'hard') && Array.isArray(r.moves);
}

export function loadDaily(day: string, mode: Mode): DailyRecord | null {
  try {
    const raw = store()?.getItem(keyFor(day, mode));
    const rec: unknown = raw ? JSON.parse(raw) : null;
    return isRecord(rec) ? rec : null;
  } catch {
    return null;
  }
}

/** Saves the first finish of a day and mode for that start; later replays are ignored. */
export function saveDaily(rec: DailyRecord): void {
  if (loadDaily(rec.day, rec.mode)?.start === rec.start) return;
  try {
    store()?.setItem(keyFor(rec.day, rec.mode), JSON.stringify(rec));
  } catch {
    // Storage full or blocked: the result just isn't remembered.
  }
}

const NAME_KEY = 'sixdeg:name';

/** The name the player last gave (for challenges and groups), as typed; callers clean it. */
export function loadPlayerName(): string {
  try {
    return store()?.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function savePlayerName(name: string): void {
  try {
    if (name) store()?.setItem(NAME_KEY, name);
    else store()?.removeItem(NAME_KEY);
  } catch {
    // Blocked storage: the name just isn't remembered.
  }
}

/** Every saved daily, oldest first. */
export function listDailies(): DailyRecord[] {
  const s = store();
  if (!s) return [];
  const out: DailyRecord[] = [];
  try {
    for (let i = 0; i < s.length; i++) {
      const key = s.key(i);
      if (!key?.startsWith(PREFIX)) continue;
      try {
        const rec: unknown = JSON.parse(s.getItem(key) ?? 'null');
        if (isRecord(rec)) out.push(rec);
      } catch {
        // Skip a corrupt entry rather than losing the rest.
      }
    }
  } catch {
    return out;
  }
  return out.sort((a, b) => (a.day === b.day ? a.mode.localeCompare(b.mode) : a.day.localeCompare(b.day)));
}

/**
 * Version 1 kept `{start, moves, par, gaveUp}` under `sixdeg:daily:<day>`, normal mode only.
 * Convert those once, then remove them.
 */
export function migrateV1(): void {
  const s = store();
  if (!s) return;
  try {
    const old: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const key = s.key(i);
      if (key && /^sixdeg:daily:\d{4}-\d{2}-\d{2}$/.test(key)) old.push(key);
    }
    for (const key of old) {
      const day = key.slice('sixdeg:daily:'.length);
      try {
        const v1 = JSON.parse(s.getItem(key) ?? 'null') as { start?: Qid; moves?: MoveSummary[]; par?: number; gaveUp?: boolean } | null;
        if (v1 && typeof v1.start === 'number' && Array.isArray(v1.moves) && typeof v1.par === 'number') {
          saveDaily({ v: 2, day, mode: 'normal', start: v1.start, par: v1.par, moves: v1.moves, path: [], gaveUp: !!v1.gaveUp, late: false, at: `${day}T12:00:00.000Z` });
        }
      } catch {
        // Unreadable: drop it.
      }
      s.removeItem(key);
    }
  } catch {
    // Storage blocked part-way: try again next visit.
  }
}
