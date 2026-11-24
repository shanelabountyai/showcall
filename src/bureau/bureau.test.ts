import { beforeEach, describe, expect, it } from 'vitest';
import { fixedClock } from '../clock';
import { prisma } from '../db';
import { approve } from '../content/lock';
import { makeDeck, makeEvent, makeSession, makeSpeaker, resetDb } from '../test/harness';
import { advance, LIFECYCLE, revert, setConsent, setProfile, SpeakerRefused } from './bureau';

const D1 = '2026-10-13';
const clock = fixedClock('2026-10-01T15:00:00Z');

beforeEach(resetDb);

describe('advance', () => {
  it('walks the chain one step at a time, refusing a state that is not earned yet', async () => {
    const event = await makeEvent();
    const speaker = await makeSpeaker(event.id, { name: 'Dana Reyes' });

    await expect(advance(event.id, speaker.id, clock)).resolves.toMatchObject({ from: 'invited', to: 'confirmed' });
    expect((await prisma.speaker.findUniqueOrThrow({ where: { id: speaker.id } })).state).toBe('confirmed');

    await expect(advance(event.id, speaker.id, clock)).rejects.toThrow(/Dana Reyes cannot become contracted: needs an honorarium and a signed contract/);

    await setProfile(event.id, speaker.id, { honorariumCents: 50000, contractSignedOn: '2026-09-01' });
    await advance(event.id, speaker.id, clock);
    expect((await prisma.speaker.findUniqueOrThrow({ where: { id: speaker.id } })).state).toBe('contracted');

    await expect(advance(event.id, speaker.id, clock)).rejects.toThrow(/cannot become content_complete: needs a bio and an approved deck$/);
    await setProfile(event.id, speaker.id, { bio: 'A keynote speaker.' });
    await expect(advance(event.id, speaker.id, clock)).rejects.toThrow(/needs an approved deck$/);
    await approve(event.id, (await makeDeck(speaker.id, 'passed')).id, clock);
    await advance(event.id, speaker.id, clock);
    expect((await prisma.speaker.findUniqueOrThrow({ where: { id: speaker.id } })).state).toBe('content_complete');
  });

  it('rehearsed needs a booked rehearsal slot; showed needs a real session', async () => {
    const event = await makeEvent();
    const room = await prisma.room.create({ data: { eventId: event.id, name: 'Ballroom A' } });
    const speaker = await makeSpeaker(event.id, { state: 'content_complete' });

    await expect(advance(event.id, speaker.id, clock)).rejects.toThrow(/needs a booked rehearsal slot/);
    await makeSession(event.id, room.id, D1, 480, 520, [speaker.id], true);
    await advance(event.id, speaker.id, clock);
    expect((await prisma.speaker.findUniqueOrThrow({ where: { id: speaker.id } })).state).toBe('rehearsed');

    await expect(advance(event.id, speaker.id, clock)).rejects.toThrow(/is not on the agenda/);
    await makeSession(event.id, room.id, D1, 540, 600, [speaker.id]);
    await advance(event.id, speaker.id, clock);
    expect((await prisma.speaker.findUniqueOrThrow({ where: { id: speaker.id } })).state).toBe('showed');
  });

  it('released needs consent recorded, whatever the flags say', async () => {
    const event = await makeEvent();
    const speaker = await makeSpeaker(event.id, { state: 'showed' });
    await expect(advance(event.id, speaker.id, clock)).rejects.toThrow(/needs consent recorded/);
    await setConsent(event.id, speaker.id, { recordSession: false, distributeDeck: false, publishVideo: false }, clock);
    await advance(event.id, speaker.id, clock);
    expect((await prisma.speaker.findUniqueOrThrow({ where: { id: speaker.id } })).state).toBe('released');
  });

  it('refuses past released', async () => {
    const event = await makeEvent();
    const speaker = await makeSpeaker(event.id, { state: 'released' });
    await expect(advance(event.id, speaker.id, clock)).rejects.toThrow(/already released/);
  });

  it('writes an append-only transition row for every move, and nothing on refusal', async () => {
    const event = await makeEvent();
    const speaker = await makeSpeaker(event.id);
    await advance(event.id, speaker.id, clock);
    await expect(advance(event.id, speaker.id, clock)).rejects.toThrow(SpeakerRefused);
    const rows = await prisma.speakerTransition.findMany({ where: { speakerId: speaker.id } });
    expect(rows).toMatchObject([{ from: 'invited', to: 'confirmed' }]);
    await expect(prisma.speakerTransition.update({ where: { id: rows[0]!.id }, data: { reason: 'edited' } })).rejects.toThrow(/append-only/);
    await expect(prisma.speakerTransition.delete({ where: { id: rows[0]!.id } })).rejects.toThrow(/append-only/);
  });
});

describe('content_complete and the deck (D-016)', () => {
  it('a passing deck is not enough until it is approved and locked — and every deck needs it', async () => {
    const event = await makeEvent();
    const speaker = await makeSpeaker(event.id, { state: 'contracted' });
    await setProfile(event.id, speaker.id, { bio: 'A keynote speaker.' });
    const v1 = await makeDeck(speaker.id, 'passed');
    await expect(advance(event.id, speaker.id, clock)).rejects.toThrow(/needs an approved deck$/);
    await approve(event.id, v1.id, clock);
    const second = await prisma.deliverable.create({ data: { eventId: event.id, speakerId: speaker.id, kind: 'deck', label: 'Breakout deck' } });
    await expect(advance(event.id, speaker.id, clock)).rejects.toThrow(/needs an approved deck$/);
    const v = await prisma.contentVersion.create({
      data: { deliverableId: second.id, number: 1, filename: 'b.pdf', mimeType: 'application/pdf', bytes: new Uint8Array([1]), byteSize: 1, sha256: '', facts: {}, uploadedAt: clock.now(), runs: { create: { outcome: 'needs_review', results: [], at: clock.now() } } },
    });
    await approve(event.id, v.id, clock);
    await expect(advance(event.id, speaker.id, clock)).resolves.toMatchObject({ to: 'content_complete' });
  });
});

describe('revert', () => {
  it('steps back with a reason, ignoring the guard that would otherwise block it', async () => {
    const event = await makeEvent();
    const speaker = await makeSpeaker(event.id, { name: 'Dana Reyes', state: 'contracted' });
    await revert(event.id, speaker.id, 'invited', 'wrong honorarium entered', clock);
    expect((await prisma.speaker.findUniqueOrThrow({ where: { id: speaker.id } })).state).toBe('invited');
    const [row] = await prisma.speakerTransition.findMany({ where: { speakerId: speaker.id } });
    expect(row).toMatchObject({ from: 'contracted', to: 'invited', reason: 'wrong honorarium entered' });
  });

  it('refuses without a reason, and refuses a step that is not actually backwards', async () => {
    const event = await makeEvent();
    const speaker = await makeSpeaker(event.id, { state: 'contracted' });
    await expect(revert(event.id, speaker.id, 'invited', '', clock)).rejects.toThrow(/needs a reason/);
    await expect(revert(event.id, speaker.id, 'contracted', 'no-op', clock)).rejects.toThrow(/already at or before/);
    await expect(revert(event.id, speaker.id, 'released', 'not backwards', clock)).rejects.toThrow(/already at or before/);
  });
});

describe('LIFECYCLE', () => {
  it('is the PRD order', () => {
    expect(LIFECYCLE).toEqual(['invited', 'confirmed', 'contracted', 'content_complete', 'rehearsed', 'showed', 'released']);
  });
});

describe('event scoping (SEC-02)', () => {
  it('another event\'s speaker reads as not found for every write, and nothing changes', async () => {
    const event = await makeEvent(), other = await makeEvent();
    const speaker = await makeSpeaker(event.id, { state: 'confirmed' });
    await expect(advance(other.id, speaker.id, clock)).rejects.toThrow(/not found|on this event/);
    await expect(revert(other.id, speaker.id, 'invited', 'cross-event', clock)).rejects.toThrow(SpeakerRefused);
    await expect(setProfile(other.id, speaker.id, { bio: 'hijacked' })).rejects.toThrow(SpeakerRefused);
    await expect(setConsent(other.id, speaker.id, { recordSession: true, distributeDeck: true, publishVideo: true }, clock)).rejects.toThrow(SpeakerRefused);
    expect(await prisma.speaker.findUniqueOrThrow({ where: { id: speaker.id } })).toMatchObject({ state: 'confirmed', bio: '', consentRecordedAt: null });
    expect(await prisma.speakerTransition.count()).toBe(0);
  });
});
