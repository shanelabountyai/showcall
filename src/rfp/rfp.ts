import { addLine } from '../budget/budget';
import { papersOutstanding } from '../budget/compliance';
import type { Clock } from '../clock';
import { prisma, type Tx } from '../db';
import type { BudgetCategory, ContractStatus, Inclusion, LineBasis } from '../generated/prisma/enums';
import { usd } from '../money';
import { localNow, toDbDate, type LocalDate } from '../time';

/**
 * RFP normalization (P0-6, D-021). Each category has a line-item schema kept
 * as data; an RFP copies it, and every quote answers every line: included in
 * the base price, excluded (a gap), or extra at a unit price. Totals, per-head
 * cost and gaps are derived on read from the quotes and the registration
 * headcount — nothing stored to go stale. The award posts the total the
 * producer saw as a budget commitment, in the same transaction as the
 * contract record.
 */
export class RfpRefused extends Error {}

/** Postgres INTEGER, as in the budget. */
const MAX_CENTS = 2_147_483_647;
const cents = (n: number, what: string, min = 0) => {
  if (!Number.isSafeInteger(n) || n < min || n > MAX_CENTS) throw new RfpRefused(`${what} must be a whole number of cents from ${usd(min)} to ${usd(MAX_CENTS)}`);
  return n;
};
const whole = (n: number, what: string, min: number) => {
  if (!Number.isSafeInteger(n) || n < min) throw new RfpRefused(`${what} must be a whole number of at least ${min}`);
  return n;
};
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export type Item = { id: string; label: string; basis: LineBasis; quantity: number | null };
export type Answer = { itemId: string; inclusion: Inclusion; unitCents: number | null };
export type QuoteIn = { id: string; vendor: string; baseCents: number; basePerHead: boolean; lines: Answer[] };

export const quantityOf = (item: Pick<Item, 'basis' | 'quantity'>, headcount: number) =>
  item.basis === 'per_head' ? headcount : item.basis === 'each' ? item.quantity! : 1;

/**
 * The comparison, pure. A quote's total is its base (× headcount when priced
 * per head) plus every extra line at unit × quantity. An excluded line is a
 * gap: the total leaves it out, so a quote with gaps is cheaper than it is,
 * and is never the "lowest complete" one.
 */
export function compare(items: Item[], quotes: QuoteIn[], headcount: number) {
  const priced = quotes.map((q) => {
    const byItem = new Map(q.lines.map((l) => [l.itemId, l]));
    const cells = items.map((item) => {
      const a = byItem.get(item.id)!;
      return { ...a, lineCents: a.inclusion === 'extra' ? a.unitCents! * quantityOf(item, headcount) : 0 };
    });
    const baseCents = q.baseCents * (q.basePerHead ? headcount : 1);
    const totalCents = baseCents + sum(cells.map((c) => c.lineCents));
    return {
      ...q, cells, baseTotalCents: baseCents, totalCents,
      // Display only; the commitment is the whole-cent total.
      perHeadCents: headcount ? Math.round(totalCents / headcount) : null,
      gaps: items.filter((_, i) => cells[i]!.inclusion === 'excluded').map((i) => i.label),
    };
  });
  const complete = priced.filter((q) => !q.gaps.length);
  const lowest = complete.length ? complete.reduce((a, b) => (b.totalCents < a.totalCents ? b : a)).id : null;
  const rows = items.map((item, i) => ({
    item, quantity: quantityOf(item, headcount),
    /** Some quote leaves this line out, so the totals are not like for like on it. */
    gap: priced.some((q) => q.cells[i]!.inclusion === 'excluded'),
  }));
  return { headcount, quotes: priced, rows, lowestComplete: lowest };
}

// ── Database ────────────────────────────────────────────────────────────────

export async function headcount(eventId: string, db: Tx = prisma) {
  const r = await db.registration.aggregate({ where: { eventId }, _sum: { registered: true } });
  return r._sum.registered ?? 0;
}

/** Set one attendee type's counts; the per-head quantity follows on the next read. */
export async function setRegistration(eventId: string, attendeeType: string, registered: number, capacity: number) {
  const type = attendeeType.trim();
  if (!type) throw new RfpRefused('An attendee type needs a name');
  whole(registered, 'Registered', 0);
  whole(capacity, 'Capacity', 0);
  return prisma.registration.upsert({
    where: { eventId_attendeeType: { eventId, attendeeType: type } },
    create: { eventId, attendeeType: type, registered, capacity },
    update: { registered, capacity },
  });
}

export async function addSchemaLine(category: BudgetCategory, label: string, basis: LineBasis) {
  const l = label.trim();
  if (!l) throw new RfpRefused('A line needs a label');
  if (await prisma.lineSchema.findUnique({ where: { category_label: { category, label: l } } })) throw new RfpRefused(`The ${category} schema already has "${l}"`);
  const position = await prisma.lineSchema.count({ where: { category } });
  return prisma.lineSchema.create({ data: { category, label: l, basis, position } });
}

/** Open an RFP from the category's schema as it stands. `each` lines start at 1; set the real count before quotes arrive. */
export async function createRfp(eventId: string, category: BudgetCategory, title: string, clock: Clock) {
  const t = title.trim();
  if (!t) throw new RfpRefused('An RFP needs a title');
  const schema = await prisma.lineSchema.findMany({ where: { category }, orderBy: { position: 'asc' } });
  if (!schema.length) throw new RfpRefused(`There is no ${category} line-item schema yet — add its lines first`);
  return prisma.rfp.create({
    data: {
      eventId, category, title: t, createdAt: clock.now(),
      items: { create: schema.map((s) => ({ label: s.label, basis: s.basis, position: s.position, quantity: s.basis === 'each' ? 1 : null })) },
    },
  });
}

/** Serialize writes to an RFP: an award reads the quotes it prices. */
const lock = async (tx: Tx, rfpId: string) => {
  await tx.$executeRaw`SELECT 1 FROM "Rfp" WHERE id = ${rfpId} FOR UPDATE`;
  const rfp = await tx.rfp.findUnique({ where: { id: rfpId }, include: { items: { orderBy: { position: 'asc' } }, contract: true } });
  if (!rfp) throw new RfpRefused('No such RFP');
  if (rfp.contract) throw new RfpRefused(`"${rfp.title}" is awarded; its quotes and lines are closed`);
  return rfp;
};

export async function setQuantity(itemId: string, quantity: number) {
  whole(quantity, 'Quantity', 1);
  const item = await prisma.rfpItem.findUnique({ where: { id: itemId } });
  if (!item) throw new RfpRefused('No such line');
  if (item.basis !== 'each') throw new RfpRefused(`"${item.label}" is ${item.basis === 'per_head' ? 'per head — its quantity is the headcount' : 'flat'}`);
  return prisma.$transaction(async (tx) => {
    await lock(tx, item.rfpId);
    return tx.rfpItem.update({ where: { id: itemId }, data: { quantity } });
  });
}

export type QuoteInput = { vendorId: string; baseCents: number; basePerHead: boolean; receivedOn: LocalDate; lines: { itemId: string; inclusion: Inclusion; unitCents?: number | null }[] };

/** Enter a vendor's quote, every line answered. A revised quote from the same vendor replaces the last one until the award. */
export async function enterQuote(rfpId: string, input: QuoteInput) {
  cents(input.baseCents, 'The base price');
  return prisma.$transaction(async (tx) => {
    const rfp = await lock(tx, rfpId);
    const given = new Map(input.lines.map((l) => [l.itemId, l]));
    const lines = rfp.items.map((item) => {
      const l = given.get(item.id);
      if (!l) throw new RfpRefused(`"${item.label}" is not answered: included, excluded or extra`);
      if (l.inclusion !== 'extra') return { itemId: item.id, inclusion: l.inclusion, unitCents: null };
      return { itemId: item.id, inclusion: l.inclusion, unitCents: cents(l.unitCents ?? NaN, `The extra cost for "${item.label}"`, 1) };
    });
    if (given.size !== lines.length) throw new RfpRefused('A line in that quote is not on this RFP');
    await tx.quote.deleteMany({ where: { rfpId, vendorId: input.vendorId } });
    return tx.quote.create({
      data: { rfpId, vendorId: input.vendorId, baseCents: input.baseCents, basePerHead: input.basePerHead, receivedOn: toDbDate(input.receivedOn), lines: { create: lines } },
    });
  });
}

const rfpInclude = {
  items: { orderBy: { position: 'asc' } },
  quotes: { orderBy: { vendor: { name: 'asc' } }, include: { vendor: { select: { name: true } }, lines: true } },
  contract: { include: { quote: { include: { vendor: { select: { name: true } } } } } },
} as const;

async function priced(db: Tx, rfpId: string) {
  const rfp = await db.rfp.findUnique({ where: { id: rfpId }, include: rfpInclude });
  if (!rfp) throw new RfpRefused('No such RFP');
  const heads = await headcount(rfp.eventId, db);
  const comparison = compare(rfp.items, rfp.quotes.map((q) => ({ id: q.id, vendor: q.vendor.name, baseCents: q.baseCents, basePerHead: q.basePerHead, lines: q.lines })), heads);
  return { rfp, comparison };
}

/**
 * Award a quote at the total the producer was shown. Refused if the total has
 * moved since (a headcount change, a revised quote). The commitment posts to
 * the budget in the same transaction as the contract; lapsed papers and the
 * quote's gaps are recorded on the contract rather than refused — the award
 * is the producer's call, and the flag is what makes it an informed one.
 */
export async function award(quoteId: string, expectedCents: number, clock: Clock) {
  const q = await prisma.quote.findUnique({ where: { id: quoteId } });
  if (!q) throw new RfpRefused('No such quote');
  return prisma.$transaction(async (tx) => {
    const rfp = await lock(tx, q.rfpId);
    const { comparison } = await priced(tx, rfp.id);
    const p = comparison.quotes.find((x) => x.id === quoteId);
    if (!p) throw new RfpRefused('That quote was revised while you were looking. Look again.');
    if (p.totalCents !== expectedCents) throw new RfpRefused(`The numbers moved: ${p.vendor}'s quote now totals ${usd(p.totalCents)}, not ${usd(expectedCents)}. Look again.`);
    const line = await addLine(rfp.eventId, {
      category: rfp.category, vendorId: q.vendorId, committedCents: p.totalCents,
      description: `${rfp.title} — ${p.vendor} (RFP award${p.basePerHead ? `, ${comparison.headcount} registered` : ''})`,
    }, tx);
    const now = clock.now();
    return tx.contract.create({
      data: {
        rfpId: rfp.id, quoteId, budgetLineId: line.id, committedCents: p.totalCents, headcount: comparison.headcount,
        papers: await papersOutstanding(q.vendorId, rfp.eventId, tx), gaps: p.gaps, awardedAt: now, statusAt: now,
      },
    });
  });
}

const NEXT: Partial<Record<ContractStatus, ContractStatus>> = { awarded: 'sent', sent: 'signed' };

/** Awarded → sent → signed; forward only. */
export async function advanceContract(contractId: string, clock: Clock) {
  const c = await prisma.contract.findUnique({ where: { id: contractId } });
  if (!c) throw new RfpRefused('No such contract');
  const to = NEXT[c.status];
  if (!to) throw new RfpRefused('That contract is already signed');
  const { count } = await prisma.contract.updateMany({ where: { id: contractId, status: c.status }, data: { status: to, statusAt: clock.now() } });
  if (!count) throw new RfpRefused('That contract moved while you were looking. Look again.');
}

/** Every RFP on the event, compared; plus the registration it prices per head against. */
export async function rfpBoard(eventId: string, clock: Clock) {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) throw new RfpRefused('No such event');
  const [registrations, rfps] = await Promise.all([
    prisma.registration.findMany({ where: { eventId }, orderBy: { attendeeType: 'asc' } }),
    prisma.rfp.findMany({ where: { eventId }, orderBy: { createdAt: 'asc' }, select: { id: true } }),
  ]);
  return {
    event, today: localNow(clock.now(), event.timezone).day, registrations,
    headcount: sum(registrations.map((r) => r.registered)),
    rfps: await Promise.all(rfps.map((r) => priced(prisma, r.id))),
  };
}
