import type { Clock } from '../clock';
import { prisma, type Tx } from '../db';
import type { BudgetCategory } from '../generated/prisma/enums';
import { hashToken, linkLive, newToken } from '../portal';
import type { FrozenLine } from './budget';

/**
 * Client approval (P1-6, D-028). The producer sends a budget snapshot; the
 * client approves or declines it through a link. The latest approved snapshot
 * is the baseline. Lines still post as they always have — a rain call cannot
 * wait on a client — but billable spend above the baseline is unapproved, line
 * by line, and the close is refused until the client has approved it.
 */
export class ApprovalRefused extends Error {}

type Billable = { id: string; description: string; committedCents: number; actualCents: number; clientBillable: boolean };

/** What the client can be billed for a line: its commitment, or its invoice if that ran over. */
export const exposure = (l: Billable) => (l.clientBillable ? Math.max(l.committedCents, l.actualCents) : 0);

/**
 * Each billable line that now exceeds what the client approved for it. Per
 * line, not the total, so moving money from one line to a new one is still a
 * change the client has not seen. No baseline: every billable cent is unapproved.
 */
export function unapproved(lines: Billable[], baseline: Billable[] | null) {
  const was = new Map((baseline ?? []).map((l) => [l.id, exposure(l)]));
  return lines
    .map((l) => ({ id: l.id, description: l.description, cents: exposure(l) - (was.get(l.id) ?? 0), isNew: !was.has(l.id) }))
    .filter((l) => l.cents > 0);
}

/** The baseline, the latest sent snapshot and its answer, and what is unapproved against the live lines. */
export async function approvalState(eventId: string, db: Tx = prisma) {
  const [lines, baseline, sent] = await Promise.all([
    db.budgetLine.findMany({ where: { eventId }, orderBy: [{ category: 'asc' }, { description: 'asc' }] }),
    db.budgetSnapshot.findFirst({ where: { eventId, approval: { approved: true } }, orderBy: { number: 'desc' }, include: { approval: true } }),
    db.budgetSnapshot.findFirst({ where: { eventId, forClient: true }, orderBy: { number: 'desc' }, include: { approval: true } }),
  ]);
  const gaps = unapproved(lines, baseline && (baseline.lines as FrozenLine[]));
  return { baseline, sent, unapproved: gaps, unapprovedCents: gaps.reduce((s, g) => s + g.cents, 0) };
}

export async function issueClientLink(eventId: string) {
  const { token, hash } = newToken();
  const { count } = await prisma.event.updateMany({ where: { id: eventId }, data: { clientTokenHash: hash } });
  if (!count) throw new ApprovalRefused('No such event');
  return token;
}

async function eventOf(token: string, clock: Clock) {
  if (!token) return null;
  const event = await prisma.event.findUnique({ where: { clientTokenHash: hashToken(token) }, include: { client: { select: { name: true } } } });
  return event && linkLive(event, clock) ? event : null;
}

/** One line as the client sees it: billable lines only, no vendor, no house cost. `wasCents` is what they last approved for it. */
export type ClientLine = { category: BudgetCategory; description: string; cents: number; wasCents: number | null };

/** The client's page: the latest snapshot sent to them, projected, against their baseline. Null for a bad or expired link. */
export async function resolveClientPortal(token: string, clock: Clock) {
  const event = await eventOf(token, clock);
  if (!event) return null;
  const { baseline, sent } = await approvalState(event.id);
  const was = new Map(((baseline?.lines ?? []) as FrozenLine[]).map((l) => [l.id, exposure(l)]));
  const lines: ClientLine[] | null = sent && (sent.lines as FrozenLine[]).filter((l) => l.clientBillable).map((l) => ({
    category: l.category, description: l.description, cents: exposure(l), wasCents: baseline ? was.get(l.id) ?? 0 : null,
  }));
  return {
    event: event.name, client: event.client.name,
    baseline: baseline && { number: baseline.number, label: baseline.label, cents: (baseline.lines as FrozenLine[]).reduce((s, l) => s + exposure(l), 0) },
    sent: sent && {
      id: sent.id, number: sent.number, label: sent.label, takenAt: sent.takenAt, lines: lines!,
      cents: lines!.reduce((s, l) => s + l.cents, 0), approval: sent.approval,
    },
  };
}

/** The client's answer on the latest sent snapshot. An older one is refused; the same answer twice is a no-op. */
export async function decideBudget(token: string, snapshotId: string, answer: { approved: boolean; signedBy: string; note?: string }, clock: Clock) {
  const event = await eventOf(token, clock);
  if (!event) throw new ApprovalRefused('This link is not valid');
  const signedBy = answer.signedBy.trim();
  const note = answer.note?.trim() || null;
  if (!signedBy) throw new ApprovalRefused('Type your name to sign');
  if (!answer.approved && !note) throw new ApprovalRefused('Say what needs to change, so the producer can send a revised budget');
  const latest = await prisma.budgetSnapshot.findFirst({ where: { eventId: event.id, forClient: true }, orderBy: { number: 'desc' }, include: { approval: true } });
  if (!latest || latest.id !== snapshotId) throw new ApprovalRefused('That is not the latest budget sent to you; reload the page');
  // ON CONFLICT DO NOTHING: a double-click keeps the first answer and never touches the append-only row.
  if (!latest.approval) await prisma.budgetApproval.createMany({ data: { snapshotId, approved: answer.approved, signedBy, note, decidedAt: clock.now() }, skipDuplicates: true });
  const decided = await prisma.budgetApproval.findUniqueOrThrow({ where: { snapshotId } });
  if (decided.approved !== answer.approved) throw new ApprovalRefused(`This budget was already ${decided.approved ? 'approved' : 'declined'}; ask the producer to send a new one`);
  return decided;
}
