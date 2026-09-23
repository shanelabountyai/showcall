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

const partsFmt = new Map<string, Intl.DateTimeFormat>();
/** An instant (from the injected clock) as the venue's wall clock: day and minute-of-day. */
export function localNow(at: Date, timeZone: string): { day: LocalDate; min: number } {
  let fmt = partsFmt.get(timeZone);
  if (!fmt) partsFmt.set(timeZone, fmt = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }));
  const p = Object.fromEntries(fmt.formatToParts(at).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute) };
}

/** '09:05' (an `<input type="time">` value) → 545. */
export const fromHhmm = (s: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) throw new Error(`Not a time: ${s}`);
  return Number(m[1]) * 60 + Number(m[2]);
};

/** 545 → '09:05', for an `<input type="time">`. */
export const inputTime = (min: number) => hhmm(min).padStart(5, '0');

/** `d` shifted by whole days — the anchor math a derived deadline is built from. */
export const addDays = (d: LocalDate, n: number): LocalDate => fromDbDate(new Date(toDbDate(d).getTime() + n * 86_400_000));

/** Whole days from `from` to `to`; negative once `to` is past. */
export const daysUntil = (from: LocalDate, to: LocalDate) => Math.round((toDbDate(to).getTime() - toDbDate(from).getTime()) / 86_400_000);

/** Every day from `start` to `end` inclusive. */
export function daysBetween(start: LocalDate, end: LocalDate): LocalDate[] {
  const days: LocalDate[] = [];
  for (let t = toDbDate(start).getTime(); t <= toDbDate(end).getTime(); t += 86_400_000) days.push(fromDbDate(new Date(t)));
  return days;
}
