import { describe, expect, it } from 'vitest';
import { addDays, archiveDays, daysBetween, formatDay, isDayKey } from './days';
import { EPOCH } from './logic';

describe('isDayKey', () => {
  it('accepts real dates only', () => {
    for (const ok of ['2026-10-08', '2028-02-29', '1999-12-31']) expect(isDayKey(ok)).toBe(true);
    for (const bad of ['2026-02-30', '2027-02-29', '2026-13-01', '2026-1-8', '20261008', '', 'today', null, 8, '2026-10-08T00:00']) expect(isDayKey(bad)).toBe(false);
  });
});

describe('addDays and daysBetween', () => {
  it('cross months, years and leap days', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(addDays('2026-10-08', 0)).toBe('2026-10-08');
    expect(daysBetween('2026-10-08', '2027-10-08')).toBe(365);
    expect(daysBetween('2026-10-09', '2026-10-08')).toBe(-1);
  });

  it('ignore daylight saving changes', () => {
    // Clocks change in Europe on 25 Oct 2026, in the US on 1 Nov, in Sydney on 4 Oct.
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26');
    expect(addDays('2026-11-01', -1)).toBe('2026-10-31');
    expect(addDays('2027-03-28', 1)).toBe('2027-03-29');
    expect(daysBetween('2026-10-01', '2026-11-30')).toBe(60);
  });
});

describe('archiveDays', () => {
  it('lists every day from today back to Daily #1', () => {
    expect(archiveDays(EPOCH)).toEqual([EPOCH]);
    expect(archiveDays('2026-10-11')).toEqual(['2026-10-11', '2026-10-10', '2026-10-09', '2026-10-08']);
    expect(archiveDays('2027-10-08')).toHaveLength(366);
  });

  it('is empty when the clock is before the first daily', () => {
    expect(archiveDays('2026-10-07')).toEqual([]);
    expect(archiveDays('not a day')).toEqual([]);
  });
});

describe('formatDay', () => {
  it('reads like "Thu 8 Oct"', () => {
    expect(formatDay('2026-10-08', '2026-10-20')).toBe('Thu 8 Oct');
    expect(formatDay('2026-11-01', '2026-11-01')).toBe('Sun 1 Nov');
  });

  it('adds the year when it differs from today', () => {
    expect(formatDay('2026-12-31', '2027-01-02')).toBe('Thu 31 Dec 2026');
  });
});
