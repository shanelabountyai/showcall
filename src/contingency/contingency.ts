import type { Clock } from '../clock';
import { prisma } from '../db';
import type { BudgetCategory } from '../generated/prisma/enums';
import { insertCue, loadRunSheet, type CueEdit } from '../runsheet/cascade';
import type { CueSpec } from '../runsheet/cues';
import { daysUntil, fromDbDate, hhmm, localNow, shortDay, toDbDate } from '../time';

/**
 * Contingency plans as data (P0-7 part 1, D-022). A plan names its trigger,
 * its owner and a decide-by, and each branch carries the cascade it implies:
 * a run-sheet variant, vendor notices and a cost delta. Executing a branch is
 * S-17; this module stores plans, derives their state and escalates the ones
 * nobody called in time.
 *
 * The decide-by is a real run-sheet cue, so its time is never stored (D-006).
 * State is derived on read from the injected clock; the only write is the
 * escalation outbox, whose unique key is the deadline itself.
 */
export class ContingencyRefused extends Error {}

/** Inside this many minutes of its decide-by, an open plan shows as due. */
export const WARN_MIN = 60;

/** A cue edit as the cascade takes it, plus the room move a rain call needs. S-17 teaches the cascade `roomId`. */
export type BranchEdit = CueEdit & { roomId?: string };

export type BranchInput = {
  label: string; cueEdits: BranchEdit[];
  costDeltaCents?: number; costCategory?: BudgetCategory; costVendorId?: string | null;
  notices?: { vendorId: string; body: string }[];
};

export type PlanInput = {
  title: string; trigger: string; ownerId: string;
  /** Where and when the call is due: a cue spec, fixed ("10:00 day-of") or anchored ("7 h before the reception"). */
  decideBy: { roomId: string } & Pick<CueSpec, 'day' | 'startMin' | 'anchorId' | 'anchorEdge' | 'offsetMin'>;
  branches: BranchInput[];
};

export async function createPlan(eventId: string, input: PlanInput) {
  const title = input.title.trim(), trigger = input.trigger.trim();
  if (!title) throw new ContingencyRefused('A plan needs a title');
  if (!trigger) throw new ContingencyRefused('A plan needs trigger criteria: what would make someone call it');
  const labels = input.branches.map((b) => b.label.trim());
  if (labels.length < 2) throw new ContingencyRefused('A plan needs at least two branches — a call with one outcome is not a decision');
  if (labels.some((l) => !l) || new Set(labels).size !== labels.length) throw new ContingencyRefused('Every branch needs its own label');

  return prisma.$transaction(async (tx) => {
    const [cues, rooms] = await Promise.all([
      tx.cue.findMany({ where: { eventId }, select: { id: true } }),
      tx.room.findMany({ where: { eventId }, select: { id: true } }),
    ]);
    const cueIds = new Set(cues.map((c) => c.id)), roomIds = new Set(rooms.map((r) => r.id));
    for (const [i, b] of input.branches.entries()) {
      const edited = b.cueEdits.map((e) => e.cueId);
      if (edited.some((id) => !cueIds.has(id))) throw new ContingencyRefused(`"${labels[i]}" edits a cue that is not on this run sheet`);
      if (new Set(edited).size !== edited.length) throw new ContingencyRefused(`"${labels[i]}" edits the same cue twice`);
      if (b.cueEdits.some((e) => e.roomId !== undefined && !roomIds.has(e.roomId))) throw new ContingencyRefused(`"${labels[i]}" moves a cue to a room that is not at this event`);
      const cost = b.costDeltaCents ?? 0;
      if (!Number.isSafeInteger(cost) || cost < 0) throw new ContingencyRefused(`"${labels[i]}" cost delta must be a whole number of cents, not negative`);
      if (b.notices?.some((n) => !n.body.trim())) throw new ContingencyRefused(`"${labels[i]}" has a vendor notice with nothing to say`);
    }

    const { roomId, ...when } = input.decideBy;
    const cue = await insertCue(tx, eventId, roomId, {
      ...when, label: `Decide: ${title}`, durationMin: 0, endById: null, endByEdge: null, endByOffsetMin: 0,
    });
    return tx.contingencyPlan.create({
      data: {
        eventId, title, trigger, ownerId: input.ownerId, decideByCueId: cue.id,
        branches: {
          create: input.branches.map((b, i) => ({
            label: labels[i]!, cueEdits: b.cueEdits,
            costDeltaCents: b.costDeltaCents ?? 0, costCategory: b.costCategory ?? 'other', costVendorId: b.costVendorId || null,
            notices: { create: (b.notices ?? []).map((n) => ({ vendorId: n.vendorId, body: n.body.trim() })) },
          })),
        },
      },
    });
  });
}

export type PlanState = 'decided' | 'overdue' | 'due' | 'open';

/** Every plan with its decide-by as the run sheet derives it, soonest first. */
export async function contingencyBoard(eventId: string, clock: Clock) {
  const [event, sheet] = await Promise.all([
    prisma.event.findUnique({
      where: { id: eventId },
      include: {
        plans: {
          include: {
            owner: { select: { name: true } },
            decision: { include: { branch: { select: { label: true } } } },
            branches: { orderBy: { label: 'asc' }, include: { costVendor: { select: { name: true } }, notices: { include: { vendor: { select: { name: true } } } } } },
            escalations: { orderBy: { sentAt: 'desc' } },
          },
        },
      },
    }),
    loadRunSheet(eventId),
  ]);
  if (!event) throw new ContingencyRefused('No such event');

  const now = localNow(clock.now(), event.timezone);
  const row = new Map(sheet.rows.map((r) => [r.id, r]));
  const plans = event.plans.map((p) => {
    // The stored graph always resolves against its pin (cascade.ts), so the decide-by has a row.
    const at = row.get(p.decideByCueId)!;
    const minutesLeft = daysUntil(now.day, at.day) * 1440 + at.startMin - now.min;
    const state: PlanState = p.decision ? 'decided' : minutesLeft <= 0 ? 'overdue' : minutesLeft <= WARN_MIN ? 'due' : 'open';
    const escalated = p.escalations.find((e) => fromDbDate(e.day) === at.day && e.minute === at.startMin) ?? null;
    return {
      ...p, decideBy: { day: at.day, min: at.startMin }, minutesLeft, state, escalated,
      branches: p.branches.map((b) => ({ ...b, cueEdits: b.cueEdits as BranchEdit[] })),
    };
  }).sort((a, b) => a.minutesLeft - b.minutesLeft || a.title.localeCompare(b.title));

  return { event, now, plans, cueLabel: new Map(sheet.rows.map((r) => [r.id, r.label])), runSheetStale: sheet.stale };
}

/**
 * Escalate every plan past its decide-by with no decision, once per deadline
 * (the unique key). To the owner and the event's producers. Safe to run as
 * often as a scheduler likes: it only ever sends what is owed now.
 */
export async function escalateDue(eventId: string, clock: Clock) {
  const board = await contingencyBoard(eventId, clock);
  const owed = board.plans.filter((p) => p.state === 'overdue' && !p.escalated);
  if (!owed.length) return 0;
  const producers = await prisma.assignment.findMany({ where: { eventId, role: 'producer' }, distinct: ['staffId'], select: { staff: { select: { name: true } } } });
  const sentAt = clock.now();
  const { count } = await prisma.contingencyEscalation.createMany({
    data: owed.map((p) => ({
      planId: p.id, day: toDbDate(p.decideBy.day), minute: p.decideBy.min, sentAt,
      to: [...new Set([p.owner.name, ...producers.map((a) => a.staff.name)])].join(', '),
      body: `${board.event.name}: "${p.title}" was to be called by ${hhmm(p.decideBy.min)} ${shortDay(p.decideBy.day)} and has not been. `
        + `Owner: ${p.owner.name}. Trigger: ${p.trigger}. Options: ${p.branches.map((b) => b.label).join(' / ')}.`,
    })),
    skipDuplicates: true,
  });
  return count;
}

/** The scheduler's entry point: every event with an undecided plan. */
export async function escalateAll(clock: Clock) {
  const events = await prisma.event.findMany({ where: { plans: { some: { decision: null } } }, select: { id: true } });
  let sent = 0;
  for (const e of events) sent += await escalateDue(e.id, clock);
  return sent;
}
