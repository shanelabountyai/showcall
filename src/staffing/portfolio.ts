import { prisma } from '../db';
import { fromDbDate, hhmm, instantOf, shortDay, type LocalDate } from '../time';

/** Rest owed between shifts on two different events (D-030). Less is a warning, never a refusal. */
export const MIN_REST_MIN = 600;

export type Shift = { id: string; staffId: string; eventId: string; eventName: string; timezone: string; day: LocalDate; startMin: number; endMin: number };
export type StaffConflict = { kind: 'overlap' | 'turnaround'; staffId: string; a: Shift; b: Shift; restMin: number };

/** A shift as epoch minutes, in its own event's timezone. */
export const span = (s: Pick<Shift, 'day' | 'startMin' | 'endMin' | 'timezone'>) =>
  [instantOf(s.day, s.startMin, s.timezone).getTime() / 60_000, instantOf(s.day, s.endMin, s.timezone).getTime() / 60_000] as const;

/** Minutes between two shifts; negative is an overlap. */
export function restBetween(a: Parameters<typeof span>[0], b: Parameters<typeof span>[0]) {
  const [as, ae] = span(a), [bs, be] = span(b);
  return Math.max(bs - ae, as - be);
}

/**
 * Every pair of one person's shifts that overlap in real time, or that move
 * them between events with less than MIN_REST_MIN between. Two shifts on the
 * same event never raise a turnaround: that is a split call (D-027).
 */
export function staffConflicts(shifts: Shift[]): StaffConflict[] {
  const out: StaffConflict[] = [];
  const sorted = [...shifts].sort((x, y) => span(x)[0] - span(y)[0]);
  // ponytail: O(n²) per person; fine for a portfolio of a few events, window it by date if it grows
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i]!, b = sorted[j]!;
      if (a.staffId !== b.staffId) continue;
      const restMin = restBetween(a, b);
      if (restMin < 0) out.push({ kind: 'overlap', staffId: a.staffId, a, b, restMin });
      else if (a.eventId !== b.eventId && restMin < MIN_REST_MIN) out.push({ kind: 'turnaround', staffId: a.staffId, a, b, restMin });
    }
  }
  return out;
}

/** Every assignment as a Shift, optionally only for these people. */
export async function loadShifts(staffIds?: string[]): Promise<Shift[]> {
  const rows = await prisma.assignment.findMany({ where: staffIds && { staffId: { in: staffIds } }, include: { event: { select: { name: true, timezone: true } } } });
  return rows.map((a) => ({ id: a.id, staffId: a.staffId, eventId: a.eventId, eventName: a.event.name, timezone: a.event.timezone, day: fromDbDate(a.day), startMin: a.startMin, endMin: a.endMin }));
}

/** 'Tue, Oct 13 15:00–23:00 America/Chicago' */
export const describeShift = (s: Shift) => `${shortDay(s.day)} ${hhmm(s.startMin)}–${hhmm(s.endMin)} ${s.timezone}`;
