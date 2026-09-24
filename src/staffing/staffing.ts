import { prisma } from '../db';
import type { DayRole } from '../generated/prisma/client';
import { addDays, fromDbDate, hhmm, toDbDate, type LocalDate } from '../time';
import { restBetween } from './portfolio';

/** The assignment would double-book the person or run them past their day. Nothing was written. */
export class StaffingRefused extends Error {}

export type AssignInput = {
  staffId: string; eventId: string; roomId: string | null;
  day: LocalDate; startMin: number; endMin: number; role: DayRole;
};

/**
 * Assign a day-of role. Capacity is the person's, not the event's: overlaps
 * are checked in real time against every event (each in its own timezone),
 * and the daily minute cap against every event that day. The
 * staff row is locked so two producers booking the same person serialize.
 */
export async function assign(input: AssignInput) {
  const { staffId, eventId, roomId, day, startMin, endMin } = input;
  return prisma.$transaction(async (tx) => {
    const [staff] = await tx.$queryRaw<{ name: string; maxMinutesPerDay: number }[]>`
      SELECT name, "maxMinutesPerDay" FROM "Staff" WHERE id = ${staffId} FOR UPDATE`;
    if (!staff) throw new StaffingRefused(`No staff ${staffId}`);
    const event = await tx.event.findUniqueOrThrow({ where: { id: eventId } });
    if (day < fromDbDate(event.startDate) || day > fromDbDate(event.endDate)) {
      throw new StaffingRefused(`${day} is outside ${event.name}`);
    }
    if (roomId) await tx.room.findFirstOrThrow({ where: { id: roomId, eventId } });

    // Neighbouring days too: in another timezone, yesterday's shift can overlap today's.
    const near = await tx.assignment.findMany({
      where: { staffId, day: { gte: toDbDate(addDays(day, -1)), lte: toDbDate(addDays(day, 1)) } },
      include: { event: { select: { name: true, timezone: true } } },
    });
    const clash = near.find((a) => restBetween({ ...a, day: fromDbDate(a.day), timezone: a.event.timezone }, { day, startMin, endMin, timezone: event.timezone }) < 0);
    if (clash) {
      const tz = clash.event.timezone === event.timezone ? '' : ` ${clash.event.timezone}`;
      throw new StaffingRefused(`${staff.name} is already on ${clash.event.name} ${hhmm(clash.startMin)}–${hhmm(clash.endMin)}${tz} (${clash.role})`);
    }
    // ponytail: the cap counts the venue-calendar day, so a cross-timezone day can run a few hours over; a rolling 24h if that bites
    const booked = near.filter((a) => fromDbDate(a.day) === day);
    const minutes = booked.reduce((sum, a) => sum + a.endMin - a.startMin, endMin - startMin);
    if (minutes > staff.maxMinutesPerDay) {
      throw new StaffingRefused(`${staff.name} would work ${minutes} min on ${day}; their cap is ${staff.maxMinutesPerDay}`);
    }
    return tx.assignment.create({ data: { ...input, day: toDbDate(day) } });
  });
}

/**
 * The stage managers who may call GO in a room today: assigned stage_manager
 * for this event and day, on that room or event-wide (D-011).
 */
export function stageManagersOnDuty(eventId: string, day: LocalDate, roomId?: string) {
  return prisma.assignment.findMany({
    where: { eventId, day: toDbDate(day), role: 'stage_manager', ...(roomId && { OR: [{ roomId }, { roomId: null }] }) },
    include: { staff: true, room: true },
    orderBy: { staff: { name: 'asc' } },
  });
}
