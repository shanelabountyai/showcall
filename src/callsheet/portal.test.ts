import { beforeEach, describe, expect, it } from 'vitest';
import { publishAgenda } from '../agenda/publish';
import { addVendor, ComplianceRefused, papersOutstanding } from '../budget/compliance';
import { fixedClock } from '../clock';
import { prisma } from '../db';
import { addCue, commitCascade, previewCascade } from '../runsheet/cascade';
import { makeEvent, makeSession, resetDb } from '../test/harness';
import { callSheetStatus, issueCallSheets } from './callsheet';
import { acceptCoi, confirmReceipt, issueCrewLink, pendingCoi, PortalRefused, resolveCrewPortal, setRoleVendor, submitCoi } from './portal';

const D1 = '2026-10-13';
const clock = fixedClock('2026-10-01T15:00:00Z');
const blank = { durationMin: 0, day: null, startMin: null, anchorId: null, anchorEdge: null, offsetMin: 0, endById: null, endByEdge: null, endByOffsetMin: 0 } as const;
const pdf = { filename: 'coi.pdf', mimeType: 'application/pdf', bytes: new Uint8Array([37, 80, 68, 70]) };

beforeEach(resetDb);

const rebase = async (eventId: string) => {
  const p = await previewCascade(eventId, { rebase: true });
  await commitCascade(eventId, { rebase: true }, p.moved);
};

/** One room, a keynote, a florist cue and an audio cue, each tagged to its own role. The event ends 2026-10-14. */
async function show() {
  const event = await makeEvent();
  const room = await prisma.room.create({ data: { eventId: event.id, name: 'Ballroom A' } });
  const keynote = await makeSession(event.id, room.id, D1, 540, 600);
  await publishAgenda(event.id, clock);
  await rebase(event.id);
  const centerpieces = await addCue(event.id, room.id, { ...blank, label: 'Centerpieces in', anchorId: keynote.id, anchorEdge: 'start', offsetMin: -60, durationMin: 30 });
  const toast = await addCue(event.id, room.id, { ...blank, label: 'Toast order: chair, then treasurer', anchorId: keynote.id, anchorEdge: 'end', durationMin: 10 });
  const florist = await prisma.callRole.create({ data: { eventId: event.id, name: 'Florist', reportTo: 'Dock B' } });
  const audio = await prisma.callRole.create({ data: { eventId: event.id, name: 'A1 Audio', reportTo: 'FOH' } });
  await prisma.cueRole.createMany({ data: [{ roleId: florist.id, cueId: centerpieces.id }, { roleId: audio.id, cueId: toast.id }] });
  await issueCallSheets(event.id, clock);
  const moveKeynote = async (by: number) => {
    await prisma.session.update({ where: { id: keynote.id }, data: { startMin: { increment: by }, endMin: { increment: by } } });
    await publishAgenda(event.id, clock);
    await rebase(event.id);
    return issueCallSheets(event.id, clock);
  };
  return { event, florist, audio, moveKeynote };
}

const flag = async (eventId: string, role: string) => (await callSheetStatus(eventId)).find((s) => s.role === role)!.awaitingReceipt;

describe('crew links', () => {
  it('shows the role its own issued sheet and nothing of any other role (hard rule 7)', async () => {
    const { event, florist } = await show();
    const token = await issueCrewLink(event.id, florist.id);
    const page = await resolveCrewPortal(token, clock);
    expect(page).toMatchObject({ role: 'Florist', vendor: null, coi: null, issue: { number: 1, changes: null, confirmedAt: null } });
    expect(page!.issue!.sheet.rows.map((r) => r.label)).toEqual(['Centerpieces in']);
    expect(JSON.stringify(page)).not.toMatch(/Toast|A1 Audio|FOH/);
  });

  it('a bad, replaced or expired link is null, and a role cannot be linked from another event', async () => {
    const { event, florist } = await show();
    const old = await issueCrewLink(event.id, florist.id);
    const token = await issueCrewLink(event.id, florist.id);
    expect(await resolveCrewPortal(old, clock)).toBeNull();
    expect(await resolveCrewPortal('nope', clock)).toBeNull();
    expect(await resolveCrewPortal(token, fixedClock('2026-10-22T04:59:00Z'))).not.toBeNull();
    expect(await resolveCrewPortal(token, fixedClock('2026-10-22T05:00:00Z'))).toBeNull();
    await expect(confirmReceipt(token, 'x', fixedClock('2026-10-22T05:00:00Z'))).rejects.toThrow('This link is not valid');
    const other = await makeEvent();
    await expect(issueCrewLink(other.id, florist.id)).rejects.toThrow(PortalRefused);
  });
});

describe('receipt clears the re-issue flag (P1-3 → P0-2)', () => {
  it('each issue awaits its own receipt; confirming an older issue is refused', async () => {
    const { event, florist, moveKeynote } = await show();
    const token = await issueCrewLink(event.id, florist.id);
    expect(await flag(event.id, 'Florist')).toBe(true);
    const first = (await resolveCrewPortal(token, clock))!.issue!;
    await confirmReceipt(token, first.id, clock);
    await confirmReceipt(token, first.id, clock); // a double-click is not an error
    expect(await prisma.callSheetReceipt.count()).toBe(1);
    expect(await flag(event.id, 'Florist')).toBe(false);
    expect(await flag(event.id, 'A1 Audio')).toBe(true);

    expect((await moveKeynote(15)).map((i) => i.role).sort()).toEqual(['A1 Audio', 'Florist']);
    expect(await flag(event.id, 'Florist')).toBe(true);
    await expect(confirmReceipt(token, first.id, clock)).rejects.toThrow('not your latest');
    const second = (await resolveCrewPortal(token, clock))!.issue!;
    expect(second).toMatchObject({ number: 2, confirmedAt: null });
    expect(second.changes!.changed).toHaveLength(1);
    await confirmReceipt(token, second.id, clock);
    expect(await flag(event.id, 'Florist')).toBe(false);
  });

  it('cannot confirm another role\'s issue', async () => {
    const { event, florist, audio } = await show();
    const token = await issueCrewLink(event.id, florist.id);
    const audioIssue = await prisma.callSheetIssue.findFirstOrThrow({ where: { roleId: audio.id } });
    await expect(confirmReceipt(token, audioIssue.id, clock)).rejects.toThrow(PortalRefused);
    expect(await prisma.callSheetReceipt.count()).toBe(0);
  });

  it('a receipt is append-only in the database', async () => {
    const { event, florist } = await show();
    const token = await issueCrewLink(event.id, florist.id);
    const r = await confirmReceipt(token, (await resolveCrewPortal(token, clock))!.issue!.id, clock);
    await expect(prisma.callSheetReceipt.delete({ where: { id: r.id } })).rejects.toThrow(/append-only/);
  });
});

describe('COI through the portal (D-026)', () => {
  async function vendorShow() {
    const s = await show();
    const vendor = await addVendor('Petal & Stem');
    await setRoleVendor(s.event.id, s.florist.id, vendor.id);
    return { ...s, vendor, token: await issueCrewLink(s.event.id, s.florist.id) };
  }

  it('a role with no vendor cannot upload one', async () => {
    const { event, audio } = await show();
    const token = await issueCrewLink(event.id, audio.id);
    await expect(submitCoi(token, pdf, '2027-06-30', clock)).rejects.toThrow('does not take insurance certificates');
  });

  it('an upload is pending and clears nothing until a producer accepts it', async () => {
    const { event, vendor, token } = await vendorShow();
    await expect(submitCoi(token, pdf, '2026-10-01', clock)).rejects.toThrow('already expired');
    await expect(submitCoi(token, { ...pdf, bytes: new Uint8Array() }, '2027-06-30', clock)).rejects.toThrow('empty');
    const sub = await submitCoi(token, pdf, '2027-06-30', clock);
    expect(await papersOutstanding(vendor.id, event.id)).toContain('no certificate of insurance on file');
    expect((await pendingCoi(event.id)).map((p) => p.vendor.name)).toEqual(['Petal & Stem']);

    const other = await makeEvent();
    await expect(acceptCoi(other.id, sub.id, '2027-06-30')).rejects.toThrow('No such submission');
    await expect(acceptCoi(event.id, sub.id, '2026-09-01')).rejects.toThrow(ComplianceRefused); // the paper says it expired before it arrived
    const doc = await acceptCoi(event.id, sub.id, '2027-05-31'); // the producer corrects the typed date
    expect(doc).toMatchObject({ kind: 'coi', vendorId: vendor.id });
    expect(doc.expiresOn!.toISOString().slice(0, 10)).toBe('2027-05-31');
    expect(await papersOutstanding(vendor.id, event.id)).not.toContain('no certificate of insurance on file');
    expect(await pendingCoi(event.id)).toEqual([]);
    await expect(acceptCoi(event.id, sub.id, '2027-05-31')).rejects.toThrow('already accepted');
    expect((await resolveCrewPortal(token, clock))!.coi).toMatchObject([{ id: sub.id, docId: doc.id }]);
  });

  it('the database allows only the one accept on a submission', async () => {
    const { event, token } = await vendorShow();
    const sub = await submitCoi(token, pdf, '2027-06-30', clock);
    await expect(prisma.coiSubmission.update({ where: { id: sub.id }, data: { filename: 'other.pdf' } })).rejects.toThrow(/append-only/);
    await expect(prisma.coiSubmission.delete({ where: { id: sub.id } })).rejects.toThrow(/append-only/);
    const doc = await acceptCoi(event.id, sub.id, '2027-06-30');
    await expect(prisma.coiSubmission.update({ where: { id: sub.id }, data: { docId: null } })).rejects.toThrow(/append-only/);
    expect((await prisma.coiSubmission.findUniqueOrThrow({ where: { id: sub.id } })).docId).toBe(doc.id);
  });
});
