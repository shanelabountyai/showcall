import { PDFDocument } from 'pdf-lib';
import { beforeEach, describe, expect, it } from 'vitest';
import { fixedClock } from '../clock';
import { prisma } from '../db';
import { makeEvent, makeSpeaker, resetDb } from '../test/harness';
import { approve, override } from './lock';
import { addDeliverable, addRule, ContentRefused, issuePortalToken, submitVersion } from './pipeline';

const clock = fixedClock('2026-10-01T15:00:00Z');
const pdf = async (w: number, h: number) => { const d = await PDFDocument.create(); d.addPage([w, h]); return d.save(); };
const upload = async (w = 1920, h = 1080) => ({ filename: 'deck.pdf', mimeType: 'application/pdf', bytes: await pdf(w, h) });

beforeEach(resetDb);

async function setup() {
  const event = await makeEvent();
  const speaker = await makeSpeaker(event.id, { name: 'Dana Reyes' });
  const deck = await addDeliverable(event.id, { speakerId: speaker.id }, 'deck', 'Keynote deck');
  await addRule(event.id, 'deck', 'aspect_ratio', { ratio: 16 / 9, tolerance: 0.01 }, 'Set the slide size to 16:9 widescreen');
  const token = await issuePortalToken({ speakerId: speaker.id });
  const submit = async (w?: number, h?: number) => submitVersion(token, deck.id, await upload(w, h), clock);
  const lockedTo = async () => (await prisma.showFileLock.findFirst({ where: { deliverableId: deck.id }, orderBy: { number: 'desc' }, include: { version: true } }))?.version.number;
  return { event, deck, submit, lockedTo };
}

describe('approve', () => {
  it('locks the latest version only, never a failed one, and only once', async () => {
    const { submit, lockedTo } = await setup();
    const v1 = await submit(1024, 768);
    await expect(approve(v1.id, clock)).rejects.toThrow('v1 failed validation: Set the slide size to 16:9 widescreen');
    const v2 = await submit();
    await expect(approve(v1.id, clock)).rejects.toThrow('v1 is superseded by v2');
    await expect(approve(v2.id, clock)).resolves.toMatchObject({ number: 1, kind: 'approve' });
    expect(await lockedTo()).toBe(2);
    await expect(approve(v2.id, clock)).rejects.toThrow('already locked to v2');
  });

  it('resolves needs review: a manual-check deck can be approved', async () => {
    const { event, submit, lockedTo } = await setup();
    await addRule(event.id, 'deck', 'manual', {}, 'Production checks the deck against the brand template.');
    const v1 = await submit();
    expect(v1.runs[0]!.outcome).toBe('needs_review');
    await approve(v1.id, clock);
    expect(await lockedTo()).toBe(1);
  });
});

describe('late revision (the 11pm v7)', () => {
  it('a portal upload after lock is kept but does not move the show file', async () => {
    const { submit, lockedTo } = await setup();
    await approve((await submit()).id, clock);
    await submit();
    expect(await lockedTo()).toBe(1);
  });

  it('override needs a reason, re-validates against current rules, and a failure refuses it but stays in the log', async () => {
    const { event, submit, lockedTo } = await setup();
    await approve((await submit()).id, clock);
    const v2 = await submit();
    await expect(override(v2.id, '  ', clock)).rejects.toThrow('An override needs a reason');

    // The rules tightened after v2 was uploaded: v2's upload-time run passed, the override's run does not.
    await addRule(event.id, 'deck', 'max_bytes', { max: 10 }, 'Keep the deck under 10 bytes');
    clock.advance(60_000);
    await expect(override(v2.id, 'Speaker fixed a typo at 11pm', clock)).rejects.toThrow('Override refused — v2 fails validation: Keep the deck under 10 bytes');
    expect(await lockedTo()).toBe(1);
    const runs = await prisma.validationRun.findMany({ where: { versionId: v2.id }, orderBy: { at: 'asc' } });
    expect(runs.map((r) => r.outcome)).toEqual(['passed', 'failed']);

    await prisma.validationRule.deleteMany({ where: { check: 'max_bytes' } });
    await expect(override(v2.id, 'Speaker fixed a typo at 11pm', clock)).resolves.toMatchObject({ number: 2, kind: 'override', reason: 'Speaker fixed a typo at 11pm' });
    expect(await lockedTo()).toBe(2);
    expect(await prisma.validationRun.count({ where: { versionId: v2.id } })).toBe(3);
    await expect(override(v2.id, 'again', clock)).rejects.toThrow('v2 is already the show file');
  });

  it('an unlocked deliverable is approved, not overridden', async () => {
    const { submit } = await setup();
    await expect(override((await submit()).id, 'why not', clock)).rejects.toThrow('not locked yet — approve it instead');
  });

  it('can roll back to an earlier version', async () => {
    const { submit, lockedTo } = await setup();
    const v1 = await submit();
    await approve(v1.id, clock);
    await override((await submit()).id, 'New version', clock);
    await override(v1.id, 'v2 broke playback — back to v1', clock);
    expect(await lockedTo()).toBe(1);
  });
});

describe('lock immutability, below the API', () => {
  it('locks cannot be edited or deleted, and cannot skip the approve or point at another deliverable', async () => {
    const { event, deck, submit } = await setup();
    const v1 = await submit();
    const lock = await approve(v1.id, clock);
    await expect(prisma.showFileLock.update({ where: { id: lock.id }, data: { reason: 'x' } })).rejects.toThrow();
    await expect(prisma.showFileLock.delete({ where: { id: lock.id } })).rejects.toThrow();
    await expect(prisma.showFileLock.create({ data: { deliverableId: deck.id, versionId: v1.id, number: 2, kind: 'override', reason: '', at: clock.now() } })).rejects.toThrow();
    await expect(prisma.showFileLock.create({ data: { deliverableId: deck.id, versionId: v1.id, number: 2, kind: 'approve', at: clock.now() } })).rejects.toThrow();

    const other = await addDeliverable(event.id, { speakerId: (await makeSpeaker(event.id)).id }, 'deck', 'Other deck');
    await expect(prisma.showFileLock.create({ data: { deliverableId: other.id, versionId: v1.id, number: 1, kind: 'approve', at: clock.now() } })).rejects.toThrow(/is not on deliverable/);
  });

  it('refusals are ContentRefused, for the UI', async () => {
    const { submit } = await setup();
    await expect(override((await submit()).id, '', clock)).rejects.toBeInstanceOf(ContentRefused);
  });
});
