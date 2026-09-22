import type { Clock } from '../clock';
import { prisma, type Tx } from '../db';
import type { DeliverableKind } from '../generated/prisma/enums';
import type { Facts } from './facts';
import { ContentRefused } from './pipeline';
import { evaluate, type RuleResult } from './rules';

/**
 * Show-file lock (D-016). `ShowFileLock` is an append-only pointer: the
 * highest-numbered row names the version that is the show file. Lock 1 is an
 * approve, every later one an override with a reason that re-validates the
 * version against the event's current rules. Portal uploads after lock are
 * kept as versions but never move the pointer — only a producer's override does.
 */

/** Serialise every lock write on the deliverable row, then read what it points at. */
async function lockDeliverable(tx: Tx, versionId: string) {
  const v = await tx.contentVersion.findUnique({ where: { id: versionId }, select: { number: true, deliverableId: true, facts: true } });
  if (!v) throw new ContentRefused('No such version');
  const [d] = await tx.$queryRaw<{ eventId: string; kind: DeliverableKind; label: string }[]>`
    SELECT "eventId", kind, label FROM "Deliverable" WHERE id = ${v.deliverableId} FOR UPDATE`;
  const current = await tx.showFileLock.findFirst({ where: { deliverableId: v.deliverableId }, orderBy: { number: 'desc' }, include: { version: { select: { number: true } } } });
  return { v, d: d!, current };
}

const fixes = (results: unknown) => (results as RuleResult[]).filter((r) => r.status === 'fail').map((r) => r.fix).join('; ');

/** Approve the latest version as the show file. Refused if already locked, superseded, or its validation failed. */
export async function approve(versionId: string, clock: Clock) {
  return prisma.$transaction(async (tx) => {
    const { v, d, current } = await lockDeliverable(tx, versionId);
    if (current) throw new ContentRefused(`${d.label} is already locked to v${current.version.number} — another version needs an override with a reason`);
    const latest = await tx.contentVersion.aggregate({ where: { deliverableId: v.deliverableId }, _max: { number: true } });
    if (v.number !== latest._max.number) throw new ContentRefused(`v${v.number} is superseded by v${latest._max.number} — approve the latest version`);
    const run = await tx.validationRun.findFirst({ where: { versionId }, orderBy: { at: 'desc' } });
    if (run?.outcome === 'failed') throw new ContentRefused(`v${v.number} failed validation: ${fixes(run.results)}`);
    return tx.showFileLock.create({ data: { deliverableId: v.deliverableId, versionId, number: 1, kind: 'approve', at: clock.now() } });
  });
}

/**
 * Move a locked deliverable's show file to another version, with a reason.
 * Re-validates against the current rules as a new run, which is kept whether
 * or not the override lands; a failed run refuses it (Shane's pick).
 */
export async function override(versionId: string, reason: string, clock: Clock) {
  if (!reason.trim()) throw new ContentRefused('An override needs a reason');
  const result = await prisma.$transaction(async (tx) => {
    const { v, d, current } = await lockDeliverable(tx, versionId);
    if (!current) throw new ContentRefused(`${d.label} is not locked yet — approve it instead`);
    if (current.versionId === versionId) throw new ContentRefused(`v${v.number} is already the show file`);
    const rules = await tx.validationRule.findMany({ where: { eventId: d.eventId, kind: d.kind }, orderBy: { id: 'asc' } });
    const { outcome, results } = evaluate(v.facts as Facts, rules);
    const at = clock.now();
    await tx.validationRun.create({ data: { versionId, outcome, results, at } });
    if (outcome === 'failed') return { refused: `Override refused — v${v.number} fails validation: ${fixes(results)}` };
    return { lock: await tx.showFileLock.create({ data: { deliverableId: v.deliverableId, versionId, number: current.number + 1, kind: 'override', reason: reason.trim(), at } }) };
  });
  if ('refused' in result) throw new ContentRefused(result.refused);
  return result.lock;
}
