import { prisma } from '../db';
import type { NeedKind } from '../generated/prisma/enums';
import { headcount, RfpRefused } from './rfp';

/**
 * Dietary and accessibility rollups (P1-7, D-029). Attendees carry names and
 * needs; the producer's roster shows both. Anything that leaves for catering
 * is `rollup`: counts per need from a fixed vocabulary, event-wide, never
 * split by attendee type (a small type turns a count into a person). The
 * select below is the whole projection — add a field there deliberately.
 */

export async function addNeed(kind: NeedKind, label: string) {
  const l = label.trim();
  if (!l) throw new RfpRefused('A need needs a label');
  if (await prisma.need.findUnique({ where: { label: l } })) throw new RfpRefused(`"${l}" is already a need`);
  return prisma.need.create({ data: { kind, label: l, position: await prisma.need.count({ where: { kind } }) } });
}

export const needList = () => prisma.need.findMany({ orderBy: [{ kind: 'asc' }, { position: 'asc' }] });

export async function addAttendee(eventId: string, a: { attendeeType: string; name: string; email: string; needIds: string[] }) {
  const [name, email, attendeeType] = [a.name.trim(), a.email.trim().toLowerCase(), a.attendeeType.trim()];
  if (!name || !email) throw new RfpRefused('An attendee needs a name and an email');
  if (!(await prisma.registration.findUnique({ where: { eventId_attendeeType: { eventId, attendeeType } } }))) throw new RfpRefused(`There is no "${attendeeType}" registration on this event`);
  if (await prisma.attendee.findUnique({ where: { eventId_email: { eventId, email } } })) throw new RfpRefused(`${email} is already registered`);
  const needIds = [...new Set(a.needIds)];
  if ((await prisma.need.count({ where: { id: { in: needIds } } })) !== needIds.length) throw new RfpRefused('No such need');
  return prisma.attendee.create({ data: { eventId, attendeeType, name, email, needs: { create: needIds.map((needId) => ({ needId })) } } });
}

/** Producer only: names and needs. Never pass this to a portal. */
export const roster = (eventId: string) => prisma.attendee.findMany({
  where: { eventId }, orderBy: [{ attendeeType: 'asc' }, { name: 'asc' }],
  include: { needs: { include: { need: true }, orderBy: { need: { position: 'asc' } } } },
});

export type Rollup = { registered: number; records: number; needs: { kind: NeedKind; label: string; count: number }[] };

/** Counts, never names. `registered - records` people have no record, so their needs are unknown. */
export async function rollup(eventId: string): Promise<Rollup> {
  const [registered, records, needs] = await Promise.all([
    headcount(eventId),
    prisma.attendee.count({ where: { eventId } }),
    prisma.need.findMany({
      orderBy: [{ kind: 'asc' }, { position: 'asc' }],
      select: { kind: true, label: true, _count: { select: { attendees: { where: { attendee: { eventId } } } } } },
    }),
  ]);
  return { registered, records, needs: needs.map((n) => ({ kind: n.kind, label: n.label, count: n._count.attendees })) };
}

/** The rollup for a portal role whose vendor holds this event's catering contract; otherwise null. */
export async function cateringRollup(eventId: string, vendorId: string | null) {
  if (!vendorId) return null;
  const caters = await prisma.contract.findFirst({ where: { rfp: { eventId, category: 'catering' }, quote: { vendorId } }, select: { id: true } });
  return caters ? rollup(eventId) : null;
}
