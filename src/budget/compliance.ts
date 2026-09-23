import { cadenceStep, WARN_DAYS } from '../chase/chase';
import type { Clock } from '../clock';
import { prisma, type Tx } from '../db';
import type { ComplianceKind } from '../generated/prisma/enums';
import { daysUntil, fromDbDate, localNow, shortDay, toDbDate, type LocalDate } from '../time';

/**
 * Vendor compliance (P0-8). A vendor needs its papers for an event because it
 * has a budget line on that event — nothing else puts a vendor on the list.
 * A W-9 must be on file; a COI must be on file and in force through the
 * event's last day. Like the chase, every due day is derived, never stored:
 * a missing doc is due at the event's first day, a COI that lapses before
 * the show is due on its own expiry. The cadence is the chase's (D-019).
 */
export class ComplianceRefused extends Error {}

export const KINDS: ComplianceKind[] = ['coi', 'w9'];
export const KIND_LABEL: Record<ComplianceKind, string> = { coi: 'certificate of insurance', w9: 'W-9' };

export async function addVendor(name: string) {
  const n = name.trim();
  if (!n) throw new ComplianceRefused('A vendor needs a name');
  if (await prisma.vendor.findUnique({ where: { name: n } })) throw new ComplianceRefused(`${n} is already a vendor`);
  return prisma.vendor.create({ data: { name: n } });
}

/** A document received. A renewal is another call — the latest received is the one in force. */
export async function recordDoc(vendorId: string, kind: ComplianceKind, receivedOn: LocalDate, expiresOn: LocalDate | null, db: Tx = prisma) {
  if (kind === 'coi' && !expiresOn) throw new ComplianceRefused('A certificate of insurance needs its expiry date');
  if (kind === 'w9' && expiresOn) throw new ComplianceRefused('A W-9 does not expire');
  if (expiresOn && expiresOn <= receivedOn) throw new ComplianceRefused('That certificate expired before it was received');
  return db.complianceDoc.create({ data: { vendorId, kind, receivedOn: toDbDate(receivedOn), expiresOn: expiresOn && toDbDate(expiresOn) } });
}

/** One kind of paper against an event ending `end`. `docs` newest first: the latest received is the one in force. */
function standing(docs: { kind: ComplianceKind; expiresOn: Date | null }[], kind: ComplianceKind, end: LocalDate) {
  const doc = docs.find((d) => d.kind === kind);
  const expiresOn = doc?.expiresOn ? fromDbDate(doc.expiresOn) : null;
  // LocalDate is 'YYYY-MM-DD', so string order is date order. In force through the last show day is covered.
  const reason = !doc ? 'missing' as const : expiresOn && expiresOn < end ? 'lapses' as const : null;
  return { doc, expiresOn, reason };
}

/** What a vendor still owes in papers for this event, in words; empty when covered. The RFP award records this (D-018). */
export async function papersOutstanding(vendorId: string, eventId: string, db: Tx = prisma) {
  const event = await db.event.findUniqueOrThrow({ where: { id: eventId } });
  const docs = await db.complianceDoc.findMany({ where: { vendorId }, orderBy: [{ receivedOn: 'desc' }, { id: 'desc' }] });
  return KINDS.flatMap((kind) => {
    const { expiresOn, reason } = standing(docs, kind, fromDbDate(event.endDate));
    return reason === 'missing' ? [`no ${KIND_LABEL[kind]} on file`]
      : reason === 'lapses' ? [`${KIND_LABEL[kind]} expires ${shortDay(expiresOn!)}, before the show ends`] : [];
  });
}

export type ComplianceState = 'ok' | 'overdue' | 'due' | 'open';

export type ComplianceRow = {
  vendorId: string; vendor: string; kind: ComplianceKind;
  /** Null when nothing is on file. */
  expiresOn: LocalDate | null; onFile: boolean;
  /** Why it is on the worklist; null when it is not. */
  reason: 'missing' | 'lapses' | null;
  dueDay: LocalDate | null; daysLeft: number | null;
  state: ComplianceState;
  owed: number | null;
  lastSent: { step: number; sentAt: Date } | null;
};

const RANK: Record<ComplianceState, number> = { overdue: 0, due: 1, open: 2, ok: 3 };

/** Every vendor on this event's budget × each kind, worst first. */
export async function complianceBoard(eventId: string, clock: Clock) {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) throw new ComplianceRefused('No such event');
  const [vendors, sent] = await Promise.all([
    prisma.vendor.findMany({
      where: { lines: { some: { eventId } } }, orderBy: { name: 'asc' },
      include: { docs: { orderBy: [{ receivedOn: 'desc' }, { id: 'desc' }] } },
    }),
    prisma.complianceReminder.findMany({ where: { eventId }, orderBy: { step: 'asc' } }),
  ]);
  const today = localNow(clock.now(), event.timezone).day;
  const start = fromDbDate(event.startDate);
  const end = fromDbDate(event.endDate);

  const rows = vendors.flatMap((v) => KINDS.map((kind): ComplianceRow => {
    const { doc, expiresOn, reason } = standing(v.docs, kind, end);
    const dueDay = reason === 'missing' ? start : reason === 'lapses' ? expiresOn : null;
    const daysLeft = dueDay ? daysUntil(today, dueDay) : null;
    const state: ComplianceState = daysLeft == null ? 'ok' : daysLeft < 0 ? 'overdue' : daysLeft <= WARN_DAYS ? 'due' : 'open';
    // A cadence is per due day: a renewal that still lapses before the show starts a new one.
    const lastSent = sent.find((s) => s.vendorId === v.id && s.kind === kind && dueDay && fromDbDate(s.dueOn) === dueDay) ?? null;
    const step = daysLeft == null ? null : cadenceStep(daysLeft);
    return {
      vendorId: v.id, vendor: v.name, kind, expiresOn, onFile: !!doc, reason, dueDay, daysLeft, state,
      owed: step != null && (!lastSent || lastSent.step > step) ? step : null,
      lastSent: lastSent && { step: lastSent.step, sentAt: lastSent.sentAt },
    };
  })).sort((a, b) => RANK[a.state] - RANK[b.state] || (a.daysLeft ?? 0) - (b.daysLeft ?? 0) || a.vendor.localeCompare(b.vendor));

  return { event, today, rows };
}

function body(row: ComplianceRow, eventName: string) {
  const what = KIND_LABEL[row.kind];
  const left = row.daysLeft!;
  const when = left < 0 ? `${-left} day${-left === 1 ? '' : 's'} ago` : left === 0 ? 'today' : `in ${left} day${left === 1 ? '' : 's'}`;
  return row.reason === 'missing'
    ? `${eventName}: we have no ${what} on file for ${row.vendor}. It is needed by ${shortDay(row.dueDay!)} (${when}).`
    : `${eventName}: ${row.vendor}'s ${what} ${left < 0 ? 'expired' : 'expires'} ${shortDay(row.dueDay!)} (${when}), before the show ends. Please send the renewal.`;
}

/** Send every nag the cadence owes. As with the chase, the outbox row is the send. */
export async function sendComplianceNags(eventId: string, clock: Clock) {
  const board = await complianceBoard(eventId, clock);
  const due = board.rows.filter((r) => r.owed != null);
  if (!due.length) throw new ComplianceRefused('No compliance nag is owed right now');
  const sentAt = clock.now();
  const { count } = await prisma.complianceReminder.createMany({
    data: due.map((r) => ({ eventId, vendorId: r.vendorId, kind: r.kind, dueOn: toDbDate(r.dueDay!), step: r.owed!, body: body(r, board.event.name), sentAt })),
    skipDuplicates: true,
  });
  return count;
}

export function complianceOutbox(eventId: string, take = 50) {
  return prisma.complianceReminder.findMany({ where: { eventId }, orderBy: { sentAt: 'desc' }, take, include: { vendor: { select: { name: true } } } });
}
