import { assess, blockInclude, contractOf, type Contract } from '../attrition/attrition';
import { approvalState } from '../budget/approval';
import { budgetToActuals, snapshot } from '../budget/budget';
import type { Clock } from '../clock';
import { prisma, type Tx } from '../db';
import type { Mark } from '../live/live';
import { usd } from '../money';
import { loadRunSheet, type RunSheetRow } from '../runsheet/cascade';
import { fromDbDate, localNow, shortDay, type LocalDate } from '../time';

/**
 * Post-event reconciliation (P1-5, D-025): where the show slipped, what the
 * hotel is owed in the end, and the budget close. Everything but the close is
 * read-only and derived. The GO log is the record of what actually happened
 * (D-010), the attrition figures come from `assess()`, and the close is a
 * final snapshot that the database treats as a freeze on the budget.
 */
export class CloseRefused extends Error {}

// ── Planned vs. actual ──────────────────────────────────────────────────────

export type SlipRow = {
  id: string; label: string; plannedMin: number;
  /** null: the row never got a GO. */
  actualMin: number | null;
  /** actual − planned; negative is early. */
  slipMin: number | null;
  /** How much of the slip this row added over the previous called row in the room. */
  addedMin: number | null;
};
export type SlipRoom = { day: LocalDate; room: string; rows: SlipRow[]; called: number; finalSlipMin: number | null; worst: SlipRow | null };

/**
 * Planned vs. actual per room and day. A row's actual is its latest GO,
 * because a later GO on the same row corrects an earlier one (D-010). Planned
 * is the start the row had when GO was called. A plan that moved afterwards
 * (a rebase, a rain call) does not turn an on-time cue into a late one. A GO
 * on a row that is no longer on the run sheet is still something that
 * happened, so it stays in the report.
 */
export function cueSlip(rows: RunSheetRow[], marks: (Mark & { room: string; day: LocalDate })[]): SlipRoom[] {
  const groups = new Map<string, { day: LocalDate; room: string; rows: RunSheetRow[]; marks: Map<string, Mark> }>();
  const group = (day: LocalDate, room: string) => {
    const key = `${day}\u0000${room}`;
    if (!groups.has(key)) groups.set(key, { day, room, rows: [], marks: new Map() });
    return groups.get(key)!;
  };
  for (const r of rows) group(r.day, r.room).rows.push(r);
  for (const m of marks) group(m.day, m.room).marks.set(m.rowId, m); // oldest first, so the latest wins

  return [...groups.values()].sort((a, b) => a.day.localeCompare(b.day) || a.room.localeCompare(b.room)).map((g) => {
    const known = new Set(g.rows.map((r) => r.id));
    const all = [
      ...g.rows.map((r) => ({ id: r.id, label: r.label, mark: g.marks.get(r.id), plannedMin: g.marks.get(r.id)?.plannedMin ?? r.startMin })),
      ...[...g.marks.values()].filter((m) => !known.has(m.rowId)).map((m) => ({ id: m.rowId, label: '(no longer on the run sheet)', mark: m, plannedMin: m.plannedMin })),
    ].sort((a, b) => a.plannedMin - b.plannedMin);

    let prev: number | null = null;
    const out = all.map(({ id, label, mark, plannedMin }): SlipRow => {
      if (!mark) return { id, label, plannedMin, actualMin: null, slipMin: null, addedMin: null };
      const slipMin = mark.actualMin - plannedMin;
      const addedMin = slipMin - (prev ?? 0);
      prev = slipMin;
      return { id, label, plannedMin, actualMin: mark.actualMin, slipMin, addedMin };
    });
    const called = out.filter((r) => r.slipMin != null);
    const worst = called.reduce<SlipRow | null>((w, r) => (r.addedMin! > (w?.addedMin ?? 0) ? r : w), null);
    return { day: g.day, room: g.room, rows: out, called: called.length, finalSlipMin: called.at(-1)?.slipMin ?? null, worst };
  });
}

// ── Final attrition ─────────────────────────────────────────────────────────

/**
 * What the block owes at the end. The thresholds net (D-020), so the hotel is
 * owed the worst shortfall, not the sum. The budget holds what was accepted.
 * A positive gap is owed but not yet on the budget. A negative gap means an
 * accept was made on a projection that pickup later beat, so the budget line
 * is over-accrued and the invoice settles the difference.
 */
export function finalAttrition(c: Contract, today: LocalDate) {
  const thresholds = assess(c, today);
  const shortfall = Math.max(0, ...thresholds.map((a) => a.shortfall));
  const owedCents = shortfall * c.rateCents;
  const postedCents = c.acceptedRoomNights * c.rateCents;
  return { thresholds, ahead: thresholds.filter((a) => a.daysLeft >= 0), shortfall, owedCents, postedCents, gapCents: owedCents - postedCents };
}

// ── The report and the close ────────────────────────────────────────────────

async function blockers(db: Tx, eventId: string, today: LocalDate) {
  const event = await db.event.findUniqueOrThrow({ where: { id: eventId } });
  const [lines, blocks, closed, approval] = await Promise.all([
    db.budgetLine.findMany({ where: { eventId }, orderBy: [{ category: 'asc' }, { description: 'asc' }], include: { vendor: { select: { name: true } } } }),
    db.roomBlock.findMany({ where: { eventId }, orderBy: { contractedOn: 'asc' }, include: blockInclude }),
    db.budgetSnapshot.findFirst({ where: { eventId, final: true } }),
    approvalState(eventId, db),
  ]);
  const endDate = fromDbDate(event.endDate);
  const attrition = blocks.map((b) => ({ hotel: b.hotel.name, rateCents: b.rateCents, ...finalAttrition(contractOf(b), today) }));
  const issues: string[] = [];
  if (closed) issues.push(`The budget was closed on ${closed.takenAt.toISOString().slice(0, 10)}`);
  if (today <= endDate) issues.push(`The show runs through ${shortDay(endDate)}; close the budget after it`);
  for (const l of lines) {
    if (l.committedCents > 0 && l.actualCents === 0) {
      issues.push(`Awaiting invoice: ${l.description}${l.vendor ? ` (${l.vendor.name})` : ''}. Enter its actual, or set committed to $0 if it was cancelled`);
    }
  }
  for (const a of attrition) {
    for (const t of a.ahead) issues.push(`${a.hotel}: the ${t.percent}% threshold on ${shortDay(t.dueOn)} has not passed yet`);
    if (a.gapCents > 0) issues.push(`${a.hotel}: ${usd(a.gapCents)} of attrition is owed and not on the budget. Accept it on the rooms page`);
  }
  // D-028: the client is billed only what they approved. Send them the budget from the budget page.
  for (const g of approval.unapproved) issues.push(`Not approved by the client: ${g.description}, ${g.isNew ? usd(g.cents) : `+${usd(g.cents)}`}`);
  return { event, lines, attrition, closed, issues };
}

/** Everything the reconciliation page shows, as of the clock. Reads only. */
export async function reconciliation(eventId: string, clock: Clock) {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) throw new CloseRefused('No such event');
  const today = localNow(clock.now(), event.timezone).day;
  const [sheet, marks, check, budget] = await Promise.all([
    loadRunSheet(eventId),
    prisma.liveMark.findMany({ where: { eventId }, orderBy: [{ markedAt: 'asc' }, { id: 'asc' }], include: { room: { select: { name: true } } } }),
    prisma.$transaction((tx) => blockers(tx, eventId, today)),
    budgetToActuals(eventId),
  ]);
  const cues = cueSlip(sheet.rows, marks.map((m) => ({ ...m, room: m.room.name, day: fromDbDate(m.day) })));
  return { event, today, cues, attrition: check.attrition, budget, closed: check.closed, issues: check.issues };
}

/**
 * Close the budget: a final snapshot, after which the database refuses every
 * write to the event's lines. It is refused while anything is outstanding, and
 * every outstanding item is named, the same way publish handles conflicts. It
 * is also refused if the actual total differs from the one the producer saw.
 */
export async function closeBudget(eventId: string, expectedActualCents: number, clock: Clock) {
  return prisma.$transaction(async (tx) => {
    // Held to commit: line writes take FOR SHARE on the event (trigger), so none lands beside the close.
    await tx.$executeRaw`SELECT 1 FROM "Event" WHERE id = ${eventId} FOR UPDATE`;
    const tz = (await tx.event.findUnique({ where: { id: eventId }, select: { timezone: true } }))?.timezone;
    if (!tz) throw new CloseRefused('No such event');
    const { lines, issues } = await blockers(tx, eventId, localNow(clock.now(), tz).day);
    if (issues.length) throw new CloseRefused(`Cannot close yet: ${issues.join('; ')}`);
    const actual = lines.reduce((s, l) => s + l.actualCents, 0);
    if (actual !== expectedActualCents) throw new CloseRefused(`The numbers moved: actuals now total ${usd(actual)}, not ${usd(expectedActualCents)}. Look again.`);
    return snapshot(tx, eventId, 'Close', clock, { final: true });
  });
}
