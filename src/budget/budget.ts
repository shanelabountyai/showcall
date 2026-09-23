import type { Clock } from '../clock';
import { prisma } from '../db';
import type { BudgetCategory } from '../generated/prisma/enums';
import { usd } from '../money';

/**
 * The budget spine (P0-8, D-018). Every later money feature — accepted
 * attrition exposure, RFP awards, contingency deltas — posts a line here, so
 * this is the one ledger they share. Lines are working state; history is the
 * append-only snapshots, and the view compares against the latest one.
 */
export class BudgetRefused extends Error {}

/** Postgres INTEGER. A line past $21.4M is a data-entry mistake at this scale, not a budget. */
const MAX_CENTS = 2_147_483_647;

function cents(n: number, what: string) {
  if (!Number.isSafeInteger(n) || n < 0 || n > MAX_CENTS) throw new BudgetRefused(`${what} must be a whole number of cents from $0 to ${usd(MAX_CENTS)}`);
  return n;
}

export type LineInput = { category: BudgetCategory; description: string; committedCents: number; clientBillable?: boolean; vendorId?: string | null };

export async function addLine(eventId: string, input: LineInput) {
  const description = input.description.trim();
  if (!description) throw new BudgetRefused('A budget line needs a description');
  return prisma.budgetLine.create({
    data: {
      eventId, category: input.category, description, committedCents: cents(input.committedCents, 'Committed'),
      clientBillable: input.clientBillable ?? true, vendorId: input.vendorId || null,
    },
  });
}

/** Actuals arrive as invoices do; a change order moves the commitment. Either way the old figure lives in the snapshots. */
export async function updateLine(lineId: string, change: { committedCents?: number; actualCents?: number }) {
  return prisma.budgetLine.update({
    where: { id: lineId },
    data: {
      ...(change.committedCents != null && { committedCents: cents(change.committedCents, 'Committed') }),
      ...(change.actualCents != null && { actualCents: cents(change.actualCents, 'Actual') }),
    },
  });
}

type Money = { category: BudgetCategory; committedCents: number; actualCents: number; clientBillable: boolean };
export type Totals = { committed: number; actual: number; variance: number; billableCommitted: number; billableActual: number };

const zero = (): Totals => ({ committed: 0, actual: 0, variance: 0, billableCommitted: 0, billableActual: 0 });

function add(t: Totals, l: Money) {
  t.committed += l.committedCents;
  t.actual += l.actualCents;
  t.variance = t.actual - t.committed;
  if (l.clientBillable) { t.billableCommitted += l.committedCents; t.billableActual += l.actualCents; }
}

/** Per-category and overall totals. The same function reads live lines and a snapshot's frozen ones, so they cannot be summed two ways. */
export function summarize(lines: Money[]) {
  const total = zero();
  const byCategory = new Map<BudgetCategory, Totals>();
  for (const l of lines) {
    if (!byCategory.has(l.category)) byCategory.set(l.category, zero());
    add(byCategory.get(l.category)!, l);
    add(total, l);
  }
  return { total, byCategory };
}

/** The line as it is frozen into a snapshot. */
type FrozenLine = Money & { id: string; description: string; vendor: string | null };

/** Budget-to-actuals: every line, the totals, and the drift since the latest snapshot. */
export async function budgetToActuals(eventId: string) {
  const [lines, snapshots] = await Promise.all([
    prisma.budgetLine.findMany({ where: { eventId }, orderBy: [{ category: 'asc' }, { description: 'asc' }], include: { vendor: { select: { name: true } } } }),
    prisma.budgetSnapshot.findMany({ where: { eventId }, orderBy: { number: 'desc' } }),
  ]);
  const now = summarize(lines);
  const latest = snapshots[0] ?? null;
  const then = latest ? summarize(latest.lines as FrozenLine[]) : null;
  const categories = [...new Set([...now.byCategory.keys(), ...(then?.byCategory.keys() ?? [])])].sort().map((category) => {
    const t = now.byCategory.get(category) ?? zero();
    return { category, ...t, sinceSnapshot: then ? t.committed - (then.byCategory.get(category)?.committed ?? 0) : null };
  });
  return {
    lines, categories, total: now.total, snapshots, latest,
    sinceSnapshot: then ? now.total.committed - then.total.committed : null,
  };
}

/** Freeze the budget as it stands. Numbered per event; the unique key refuses a racing duplicate. */
export async function takeSnapshot(eventId: string, label: string, clock: Clock) {
  const name = label.trim();
  if (!name) throw new BudgetRefused('A snapshot needs a label — "client v2", "post-RFP", whatever it will be looked up by');
  return prisma.$transaction(async (tx) => {
    const lines = await tx.budgetLine.findMany({ where: { eventId }, orderBy: [{ category: 'asc' }, { description: 'asc' }], include: { vendor: { select: { name: true } } } });
    const frozen: FrozenLine[] = lines.map((l) => ({
      id: l.id, category: l.category, description: l.description, vendor: l.vendor?.name ?? null,
      committedCents: l.committedCents, actualCents: l.actualCents, clientBillable: l.clientBillable,
    }));
    const { total } = summarize(frozen);
    const number = (await tx.budgetSnapshot.count({ where: { eventId } })) + 1;
    return tx.budgetSnapshot.create({
      data: {
        eventId, number, label: name, takenAt: clock.now(), lines: frozen,
        committedCents: total.committed, actualCents: total.actual, billableCents: total.billableCommitted,
      },
    });
  });
}
