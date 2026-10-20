import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, daysUntil, fromDbDate, fromHhmm, hhmm, inputTime, localNow, shortDay, toDbDate } from './time';

describe('minute-of-day', () => {
  it('formats for people and for <input type="time">', () => {
    expect([0, 5, 545, 720, 1439].map(hhmm)).toEqual(['0:00', '0:05', '9:05', '12:00', '23:59']);
    expect(hhmm(1500)).toBe('25:00'); // a shift past midnight stays on its own day
    expect([0, 545, 1439].map(inputTime)).toEqual(['00:00', '09:05', '23:59']);
  });

  it('parses what a time input sends, and round-trips', () => {
    expect(['00:00', '9:05', '09:05', '12:30', '23:59'].map(fromHhmm)).toEqual([0, 545, 545, 750, 1439]);
    for (let m = 0; m < 1440; m += 7) expect(fromHhmm(inputTime(m))).toBe(m);
  });

  it('refuses anything that is not a wall-clock time', () => {
    for (const s of ['', '9', '9:5', '24:00', '25:00', '9:60', '10:75', '-1:00', '09:05:00', ' 09:05', '9.05', 'noon']) {
      expect(() => fromHhmm(s), s).toThrow('Not a time');
    }
  });
});

describe('LocalDate', () => {
  it('round-trips a Postgres date column (UTC midnight) whatever the process TZ', () => {
    expect(toDbDate('2026-10-13').toISOString()).toBe('2026-10-13T00:00:00.000Z');
    expect(fromDbDate(toDbDate('2028-02-29'))).toBe('2028-02-29');
  });

  it('adds whole days across month, year and leap-day edges, and across DST', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
    expect(addDays('2026-11-01', -1)).toBe('2026-10-31'); // US fall-back day
    expect(addDays('2026-03-08', 30)).toBe('2026-04-07'); // US spring-forward day
    expect(addDays('2026-10-13', 0)).toBe('2026-10-13');
  });

  it('counts days between dates, negative once past', () => {
    expect(daysUntil('2026-10-01', '2026-10-13')).toBe(12);
    expect(daysUntil('2026-10-13', '2026-10-01')).toBe(-12);
    expect(daysUntil('2026-10-13', '2026-10-13')).toBe(0);
    expect(daysUntil('2026-02-28', '2026-03-01')).toBe(1);
    expect(daysUntil('2028-02-28', '2028-03-01')).toBe(2);
  });

  it('lists every day inclusive', () => {
    expect(daysBetween('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
    expect(daysBetween('2026-10-13', '2026-10-13')).toEqual(['2026-10-13']);
    expect(daysBetween('2026-10-14', '2026-10-13')).toEqual([]);
  });

  it('formats a day for people without shifting it', () => {
    expect(shortDay('2026-10-13')).toBe('Tue, Oct 13');
    expect(shortDay('2027-01-01')).toBe('Fri, Jan 1');
  });
});

describe('localNow', () => {
  it('reads an instant as the venue wall clock', () => {
    expect(localNow(new Date('2026-10-13T14:00:00Z'), 'America/Chicago')).toEqual({ day: '2026-10-13', min: 540 });
    expect(localNow(new Date('2026-10-13T03:30:00Z'), 'America/Chicago')).toEqual({ day: '2026-10-12', min: 1350 });
    expect(localNow(new Date('2026-10-13T23:30:00Z'), 'Asia/Tokyo')).toEqual({ day: '2026-10-14', min: 510 });
    expect(localNow(new Date('2026-10-13T00:00:00Z'), 'UTC')).toEqual({ day: '2026-10-13', min: 0 });
  });

  it('midnight is minute 0 of the new day, never 24:00', () => {
    expect(localNow(new Date('2026-10-14T05:00:00Z'), 'America/Chicago')).toEqual({ day: '2026-10-14', min: 0 });
  });

  it('follows the fall-back hour: the same wall minute twice, an hour apart', () => {
    expect(localNow(new Date('2026-11-01T06:30:00Z'), 'America/Chicago')).toEqual({ day: '2026-11-01', min: 90 }); // 1:30 CDT
    expect(localNow(new Date('2026-11-01T07:30:00Z'), 'America/Chicago')).toEqual({ day: '2026-11-01', min: 90 }); // 1:30 CST
  });

  it('skips the spring-forward hour', () => {
    expect(localNow(new Date('2026-03-08T07:59:00Z'), 'America/Chicago')).toEqual({ day: '2026-03-08', min: 119 }); // 1:59 CST
    expect(localNow(new Date('2026-03-08T08:00:00Z'), 'America/Chicago')).toEqual({ day: '2026-03-08', min: 180 }); // 3:00 CDT
  });
});
