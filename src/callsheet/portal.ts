import { recordDoc } from '../budget/compliance';
import type { Clock } from '../clock';
import { MAX_UPLOAD_BYTES, type Upload } from '../content/pipeline';
import { prisma } from '../db';
import { hashToken, linkLive, newToken } from '../portal';
import { cateringRollup } from '../rfp/needs';
import { fromDbDate, localNow, toDbDate, type LocalDate } from '../time';
import { diffCallSheets, type CallSheet } from './callsheet';

/**
 * The crew/vendor portal (P1-3, D-026). A call role holds a link; the page
 * shows that role's latest issued sheet — the stored issue, so it is exactly
 * what was sent — and a button confirming receipt, which clears the
 * "awaiting receipt" flag a re-issue raises. A role tied to a vendor can also
 * upload a COI, which waits for a producer to accept it: the link is not an
 * identity, so an upload never clears compliance by itself.
 */
export class PortalRefused extends Error {}

export async function issueCrewLink(eventId: string, roleId: string) {
  const { token, hash } = newToken();
  const { count } = await prisma.callRole.updateMany({ where: { id: roleId, eventId }, data: { portalTokenHash: hash } });
  if (!count) throw new PortalRefused('No such role on this event');
  return token;
}

export async function setRoleVendor(eventId: string, roleId: string, vendorId: string | null) {
  if (vendorId && !(await prisma.vendor.findUnique({ where: { id: vendorId } }))) throw new PortalRefused('No such vendor');
  const { count } = await prisma.callRole.updateMany({ where: { id: roleId, eventId }, data: { vendorId } });
  if (!count) throw new PortalRefused('No such role on this event');
}

/** The live link's role, or null — a bad, replaced or expired link all look the same. */
async function roleOf(token: string, clock: Clock) {
  if (!token) return null;
  const role = await prisma.callRole.findUnique({
    where: { portalTokenHash: hashToken(token) },
    include: { event: { select: { name: true, endDate: true, timezone: true } }, vendor: { select: { id: true, name: true } } },
  });
  return role && linkLive(role.event, clock) ? role : null;
}

/** What the portal page shows. Never the live projection: only what was issued. */
export async function resolveCrewPortal(token: string, clock: Clock) {
  const role = await roleOf(token, clock);
  if (!role) return null;
  const [last, prev] = await prisma.callSheetIssue.findMany({
    where: { roleId: role.id }, orderBy: { number: 'desc' }, take: 2, include: { receipt: true },
  });
  const coi = role.vendor && await prisma.coiSubmission.findMany({
    where: { roleId: role.id }, orderBy: { submittedAt: 'desc' },
    select: { id: true, filename: true, statedExpiresOn: true, submittedAt: true, docId: true },
  });
  return {
    event: role.event.name, role: role.name, vendor: role.vendor?.name ?? null,
    issue: last && {
      id: last.id, number: last.number, issuedAt: last.issuedAt, sheet: last.content as CallSheet,
      confirmedAt: last.receipt?.confirmedAt ?? null,
      changes: prev ? diffCallSheets(prev.content as CallSheet, last.content as CallSheet) : null,
    },
    coi,
    /** Counts only (P1-7): shown when this role's vendor caters the event. */
    catering: await cateringRollup(role.eventId, role.vendor?.id ?? null),
  };
}

/** Receipt of the role's latest issue. An older issue is refused — it is not what they should be working from. Idempotent. */
export async function confirmReceipt(token: string, issueId: string, clock: Clock) {
  const role = await roleOf(token, clock);
  if (!role) throw new PortalRefused('This link is not valid');
  const latest = await prisma.callSheetIssue.findFirst({ where: { roleId: role.id }, orderBy: { number: 'desc' }, include: { receipt: true } });
  if (!latest || latest.id !== issueId) throw new PortalRefused('That is not your latest call sheet; reload the page');
  if (latest.receipt) return latest.receipt;
  // ON CONFLICT DO NOTHING: a double-click race keeps the first confirmation and never touches the append-only row.
  await prisma.callSheetReceipt.createMany({ data: { issueId, confirmedAt: clock.now() }, skipDuplicates: true });
  return prisma.callSheetReceipt.findUniqueOrThrow({ where: { issueId } });
}

/** A COI from the vendor's side. Held for a producer; nothing about compliance changes yet. */
export async function submitCoi(token: string, file: Upload, statedExpiresOn: LocalDate, clock: Clock) {
  const role = await roleOf(token, clock);
  if (!role) throw new PortalRefused('This link is not valid');
  if (!role.vendorId) throw new PortalRefused('This link does not take insurance certificates');
  if (file.bytes.length === 0) throw new PortalRefused('The file is empty');
  if (file.bytes.length > MAX_UPLOAD_BYTES) throw new PortalRefused(`The file is over the ${MAX_UPLOAD_BYTES / 1024 / 1024} MB upload limit`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(statedExpiresOn)) throw new PortalRefused('Enter the date the certificate expires');
  if (statedExpiresOn <= localNow(clock.now(), role.event.timezone).day) throw new PortalRefused('That certificate has already expired');
  return prisma.coiSubmission.create({
    data: {
      vendorId: role.vendorId, roleId: role.id,
      filename: file.filename.slice(0, 255), mimeType: file.mimeType || 'application/octet-stream',
      bytes: Uint8Array.from(file.bytes), byteSize: file.bytes.length,
      statedExpiresOn: toDbDate(statedExpiresOn), submittedAt: clock.now(),
    },
  });
}

/** Submissions on this event not yet accepted, oldest first. */
export const pendingCoi = (eventId: string) => prisma.coiSubmission.findMany({
  where: { docId: null, role: { eventId } }, orderBy: { submittedAt: 'asc' },
  select: { id: true, filename: true, byteSize: true, statedExpiresOn: true, submittedAt: true, vendor: { select: { name: true } }, role: { select: { name: true } } },
});

/**
 * The producer has read the certificate: record it as received the day it was
 * uploaded, expiring `expiresOn` (what the paper says, not what was typed).
 * The trigger lets `docId` be set once, so a second accept cannot record twice.
 */
export async function acceptCoi(eventId: string, submissionId: string, expiresOn: LocalDate) {
  return prisma.$transaction(async (tx) => {
    const sub = await tx.coiSubmission.findFirst({ where: { id: submissionId, role: { eventId } }, include: { role: { select: { event: { select: { timezone: true } } } } } });
    if (!sub) throw new PortalRefused('No such submission on this event');
    if (sub.docId) throw new PortalRefused('That certificate was already accepted');
    const receivedOn = localNow(sub.submittedAt, sub.role.event.timezone).day;
    const doc = await recordDoc(sub.vendorId, 'coi', receivedOn, expiresOn || fromDbDate(sub.statedExpiresOn), tx);
    await tx.coiSubmission.update({ where: { id: sub.id }, data: { docId: doc.id } });
    return doc;
  });
}
