/**
 * Calendar days and minute-of-day. A show runs on the venue's wall clock —
 * "doors 8:30 on day 2" — so days are 'YYYY-MM-DD' strings and times are
 * minutes after local midnight. Neither is an instant, so neither can drift.
 */
export type LocalDate = string;

const utcMidnight = (d: LocalDate) => {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, day);
};

/** A LocalDate to and from a Postgres `date` column, which Prisma surfaces as UTC midnight. */
export const toDbDate = (d: LocalDate) => new Date(utcMidnight(d));
export const fromDbDate = (d: Date): LocalDate => d.toISOString().slice(0, 10);

const shortFmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
/** 'Tue, Oct 13' — for people, never for storage. */
export const shortDay = (d: LocalDate) => shortFmt.format(toDbDate(d));

/** 545 → '9:05'. */
export const hhmm = (min: number) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
