import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { beforeEach, describe, expect, it } from 'vitest';
import { fixedClock } from '../clock';
import { prisma } from '../db';
import { makeEvent, makeSpeaker, resetDb } from '../test/harness';
import {
  addDeliverable, addRule, addSponsor, ContentRefused, issuePortalToken, MAX_UPLOAD_BYTES, producerComment,
  resolvePortal, submitterComment, submitVersion,
} from './pipeline';

const clock = fixedClock('2026-10-01T15:00:00Z');
const pdf = async (w: number, h: number) => { const d = await PDFDocument.create(); d.addPage([w, h]); return d.save(); };
const upload = (bytes: Uint8Array, filename = 'deck.pdf') => ({ filename, mimeType: 'application/pdf', bytes });

beforeEach(resetDb);

async function setup() {
  const event = await makeEvent();
  const [a, b] = [await makeSpeaker(event.id, { name: 'Dana Reyes' }), await makeSpeaker(event.id, { name: 'Marcus Oyelaran' })];
  const sponsor = await addSponsor(event.id, 'Contoso Health');
  const deckA = await addDeliverable(event.id, { speakerId: a.id }, 'deck', 'Keynote deck');
  const deckB = await addDeliverable(event.id, { speakerId: b.id }, 'deck', 'Panel deck');
  const logo = await addDeliverable(event.id, { sponsorId: sponsor.id }, 'logo', 'Logo');
  await addRule(event.id, 'deck', 'aspect_ratio', { ratio: 16 / 9, tolerance: 0.01 }, 'Set the slide size to 16:9 widescreen');
  return { event, a, b, sponsor, deckA, deckB, logo };
}

describe('portal tokens', () => {
  it('stores only the hash, and resolves to the owner', async () => {
    const { a } = await setup();
    const token = await issuePortalToken({ speakerId: a.id });
    const row = await prisma.speaker.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.portalTokenHash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(JSON.stringify(row)).not.toContain(token);
    expect(await resolvePortal(token, clock)).toMatchObject({ kind: 'speaker', id: a.id, deliverables: [{ label: 'Keynote deck' }] });
    expect(await resolvePortal('not-a-token', clock)).toBeNull();
    expect(await resolvePortal('', clock)).toBeNull();
  });

  it('reissue kills the old link', async () => {
    const { a, deckA } = await setup();
    const old = await issuePortalToken({ speakerId: a.id });
    const fresh = await issuePortalToken({ speakerId: a.id });
    expect(await resolvePortal(old, clock)).toBeNull();
    await expect(submitVersion(old, deckA.id, upload(await pdf(1920, 1080)), clock)).rejects.toThrow(ContentRefused);
    await expect(submitVersion(fresh, deckA.id, upload(await pdf(1920, 1080)), clock)).resolves.toMatchObject({ number: 1 });
  });

  it('dies a week after the event ends: the page is gone and writes are refused (SEC-05)', async () => {
    const { a, deckA } = await setup(); // the event ends 2026-10-14, America/Chicago
    const token = await issuePortalToken({ speakerId: a.id });
    const lastNight = fixedClock('2026-10-22T04:59:00Z'); // 23:59 on the 21st in Chicago
    const nextMorning = fixedClock('2026-10-22T05:00:00Z');
    expect(await resolvePortal(token, lastNight)).not.toBeNull();
    expect(await resolvePortal(token, nextMorning)).toBeNull();
    await expect(submitVersion(token, deckA.id, upload(await pdf(1920, 1080)), nextMorning)).rejects.toThrow('This link is not valid');
    await expect(submitVersion(token, deckA.id, upload(await pdf(1920, 1080)), lastNight)).resolves.toMatchObject({ number: 1 });
  });
});

describe('submitVersion — the trust boundary', () => {
  it("speaker A's token cannot submit to B's deliverable or a sponsor's, and nothing is written", async () => {
    const { a, sponsor, deckB, logo } = await setup();
    const tokenA = await issuePortalToken({ speakerId: a.id });
    const tokenSponsor = await issuePortalToken({ sponsorId: sponsor.id });
    const file = upload(await pdf(1920, 1080));
    await expect(submitVersion(tokenA, deckB.id, file, clock)).rejects.toThrow('That deliverable is not on this link');
    await expect(submitVersion(tokenA, logo.id, file, clock)).rejects.toThrow('That deliverable is not on this link');
    await expect(submitVersion(tokenSponsor, deckB.id, file, clock)).rejects.toThrow('That deliverable is not on this link');
    await expect(submitVersion(tokenA, 'no-such-id', file, clock)).rejects.toThrow('That deliverable is not on this link');
    expect(await prisma.contentVersion.count()).toBe(0);
  });

  it('keeps v1…v3 with dense numbers, validating each against the event rules for its kind', async () => {
    const { a, deckA } = await setup();
    const token = await issuePortalToken({ speakerId: a.id });
    const v1 = await submitVersion(token, deckA.id, upload(await pdf(1024, 768)), clock);
    const v2 = await submitVersion(token, deckA.id, upload(await pdf(1920, 1080)), clock);
    const v3 = await submitVersion(token, deckA.id, upload(await pdf(1920, 1080)), clock);
    expect([v1, v2, v3].map((v) => [v.number, v.runs[0]!.outcome])).toEqual([[1, 'failed'], [2, 'passed'], [3, 'passed']]);
    expect(v1.runs[0]!.results).toEqual([expect.objectContaining({ status: 'fail', fix: 'Set the slide size to 16:9 widescreen' })]);
    expect(v2.sha256).toBe(createHash('sha256').update(Buffer.from(v2.bytes)).digest('hex'));
    expect(await prisma.contentVersion.count({ where: { deliverableId: deckA.id } })).toBe(3);
  });

  it('numbers stay dense under concurrent uploads', async () => {
    const { a, deckA } = await setup();
    const token = await issuePortalToken({ speakerId: a.id });
    const bytes = await pdf(1920, 1080);
    await Promise.all([1, 2, 3, 4].map(() => submitVersion(token, deckA.id, upload(bytes), clock)));
    const numbers = (await prisma.contentVersion.findMany({ where: { deliverableId: deckA.id }, orderBy: { number: 'asc' } })).map((v) => v.number);
    expect(numbers).toEqual([1, 2, 3, 4]);
  });

  it('refuses over the hard ceiling, and an empty file, with nothing written', async () => {
    const { a, deckA } = await setup();
    const token = await issuePortalToken({ speakerId: a.id });
    await expect(submitVersion(token, deckA.id, upload(new Uint8Array(MAX_UPLOAD_BYTES + 1)), clock)).rejects.toThrow(/upload limit/);
    await expect(submitVersion(token, deckA.id, upload(new Uint8Array(0)), clock)).rejects.toThrow(/empty/);
    expect(await prisma.contentVersion.count()).toBe(0);
  });
});

describe('comments', () => {
  it('submitters comment only on their own versions; bodies must be non-empty', async () => {
    const { a, b, deckA } = await setup();
    const tokenA = await issuePortalToken({ speakerId: a.id });
    const tokenB = await issuePortalToken({ speakerId: b.id });
    const v = await submitVersion(tokenA, deckA.id, upload(await pdf(1920, 1080)), clock);
    await producerComment(v.id, 'Use the new logo on slide 2', true, clock);
    await submitterComment(tokenA, v.id, 'Will do', clock);
    await expect(submitterComment(tokenB, v.id, 'Hijack', clock)).rejects.toThrow('That version is not on this link');
    await expect(producerComment(v.id, '   ', false, clock)).rejects.toThrow(ContentRefused);
    expect(await prisma.versionComment.findMany({ where: { versionId: v.id }, orderBy: { at: 'asc' } })).toMatchObject([
      { side: 'producer', requestsChanges: true }, { side: 'submitter', requestsChanges: false, body: 'Will do' },
    ]);
  });
});

describe('addRule', () => {
  it('refuses params the check cannot read, so a bad rule never breaks an upload', async () => {
    const { event } = await setup();
    await expect(addRule(event.id, 'deck', 'file_type', { types: 'pdf' }, 'Send a PDF')).rejects.toThrow(/types \(list\)/);
    await expect(addRule(event.id, 'deck', 'max_bytes', 5, 'Too big')).rejects.toThrow(ContentRefused);
    await expect(addRule(event.id, 'deck', 'max_bytes', { max: 100 }, '  ')).rejects.toThrow(/fix/);
    await expect(addRule(event.id, 'logo', 'min_pixels', { width: 1000 }, 'Wider')).resolves.toMatchObject({ check: 'min_pixels' });
  });
});

describe('append-only', () => {
  it('refuses UPDATE and DELETE on versions, runs and comments', async () => {
    const { a, deckA } = await setup();
    const token = await issuePortalToken({ speakerId: a.id });
    const v = await submitVersion(token, deckA.id, upload(await pdf(1920, 1080)), clock);
    const c = await producerComment(v.id, 'Looks good', false, clock);
    await expect(prisma.contentVersion.update({ where: { id: v.id }, data: { filename: 'x' } })).rejects.toThrow(/append-only/);
    await expect(prisma.contentVersion.delete({ where: { id: v.id } })).rejects.toThrow(/append-only/);
    await expect(prisma.validationRun.update({ where: { id: v.runs[0]!.id }, data: { outcome: 'passed' } })).rejects.toThrow(/append-only/);
    await expect(prisma.validationRun.delete({ where: { id: v.runs[0]!.id } })).rejects.toThrow(/append-only/);
    await expect(prisma.versionComment.update({ where: { id: c.id }, data: { body: 'edited' } })).rejects.toThrow(/append-only/);
    await expect(prisma.versionComment.delete({ where: { id: c.id } })).rejects.toThrow(/append-only/);
  });

  it('a deliverable has exactly one owner', async () => {
    const { event, a, sponsor } = await setup();
    await expect(prisma.deliverable.create({ data: { eventId: event.id, kind: 'logo', label: 'x', speakerId: a.id, sponsorId: sponsor.id } })).rejects.toThrow(/one_owner/);
    await expect(prisma.deliverable.create({ data: { eventId: event.id, kind: 'logo', label: 'x' } })).rejects.toThrow(/one_owner/);
  });
});
