import { beforeEach, describe, expect, it } from 'vitest';
import { setProfile } from '../bureau/bureau';
import { fixedClock } from '../clock';
import { approve } from '../content/lock';
import { prisma } from '../db';
import { makeDeck, makeEvent, makeSession, makeSpeaker, resetDb } from '../test/harness';
import { cadenceStep, chaseBoard, ChaseRefused, outbox, sendDueReminders, setLeadDays } from './chase';

// Event runs 2026-10-13/14 (the harness default). A 21-day deck lead puts the
// deadline on 2026-09-22, so the clock is what makes a row early or late.
const D1 = '2026-10-13';
const clock = fixedClock('2026-09-01T15:00:00Z');

beforeEach(resetDb);

async function setup(leadDays = 21) {
  const event = await makeEvent();
  const room = await prisma.room.create({ data: { eventId: event.id, name: 'Ballroom A' } });
  const dana = await makeSpeaker(event.id, { name: 'Dana Reyes' });
  await makeSession(event.id, room.id, D1, 540, 600, [dana.id]);
  await setLeadDays(event.id, 'deck', leadDays);
  await makeDeck(dana.id, 'passed'); // creates the deck deliverable with v1
  return { event, room, dana };
}

const rowFor = async (eventId: string, at: string) => (await chaseBoard(eventId, fixedClock(at))).rows[0]!;

describe('derived deadlines', () => {
  it('is the speaker\'s first call minus the lead time, and moves when the session moves', async () => {
    const { event, dana, room } = await setup();
    expect((await rowFor(event.id, '2026-09-01T15:00:00Z')).dueDay).toBe('2026-09-22');

    // A rehearsal on day 1 minus one is now the first call: the deadline follows it.
    await makeSession(event.id, room.id, '2026-10-12', 450, 480, [dana.id], true);
    expect((await rowFor(event.id, '2026-09-01T15:00:00Z')).dueDay).toBe('2026-09-21');
  });

  it('falls back to the event start for an owner with no session', async () => {
    const { event } = await setup();
    const sponsor = await prisma.sponsor.create({ data: { eventId: event.id, name: 'Northwind' } });
    await prisma.deliverable.create({ data: { eventId: event.id, sponsorId: sponsor.id, kind: 'logo', label: 'Logo' } });
    await setLeadDays(event.id, 'logo', 30);
    const logo = (await chaseBoard(event.id, clock)).rows.find((r) => r.kind === 'logo')!;
    expect([logo.callDay, logo.dueDay]).toEqual([D1, '2026-09-13']);
  });

  it('says no_policy rather than inventing a deadline for a kind with no lead time', async () => {
    const { event } = await setup();
    await prisma.deadlinePolicy.deleteMany({ where: { eventId: event.id } });
    const row = await rowFor(event.id, '2026-09-01T15:00:00Z');
    expect([row.state, row.dueDay, row.owed]).toEqual(['no_policy', null, null]);
  });

  it('refuses a negative lead time', async () => {
    const { event } = await setup();
    await expect(setLeadDays(event.id, 'deck', -1)).rejects.toThrow(ChaseRefused);
  });
});

describe('state and ranking', () => {
  it('runs open → due → overdue as the clock crosses the deadline, and locked ends the chase', async () => {
    const { event, dana } = await setup();
    expect((await rowFor(event.id, '2026-09-01T15:00:00Z')).state).toBe('open');   // 21 days out
    expect((await rowFor(event.id, '2026-09-20T15:00:00Z')).state).toBe('due');    // inside the warn band
    expect((await rowFor(event.id, '2026-09-25T15:00:00Z')).state).toBe('overdue');

    const v = await prisma.contentVersion.findFirstOrThrow({ where: { deliverable: { speakerId: dana.id } } });
    await approve(v.id, clock);
    const locked = await rowFor(event.id, '2026-09-25T15:00:00Z');
    expect([locked.state, locked.lockedVersion, locked.owed]).toEqual(['locked', 1, null]);
  });

  it('sorts the worst first', async () => {
    const { event } = await setup();
    const sponsor = await prisma.sponsor.create({ data: { eventId: event.id, name: 'Northwind' } });
    await prisma.deliverable.create({ data: { eventId: event.id, sponsorId: sponsor.id, kind: 'logo', label: 'Logo' } });
    await setLeadDays(event.id, 'logo', 60); // due 2026-08-14 — already overdue
    const { rows } = await chaseBoard(event.id, clock);
    expect(rows.map((r) => [r.kind, r.state])).toEqual([['logo', 'overdue'], ['deck', 'open']]);
  });
});

describe('reminder cadence', () => {
  it('picks the most urgent step reached, and nothing before the first', () => {
    expect(cadenceStep(20)).toBe(null);
    expect(cadenceStep(14)).toBe(14);
    expect(cadenceStep(10)).toBe(14);
    expect(cadenceStep(5)).toBe(7);
    expect(cadenceStep(0)).toBe(0);
    expect(cadenceStep(-40)).toBe(-7); // very late still lands on the last step, not past it
  });

  it('sends one reminder per step and never the same step twice', async () => {
    const { event } = await setup();
    const at = fixedClock('2026-09-10T15:00:00Z'); // 12 days out: step 14
    expect(await sendDueReminders(event.id, at)).toBe(1);
    await expect(sendDueReminders(event.id, at)).rejects.toThrow(ChaseRefused);

    const later = fixedClock('2026-09-17T15:00:00Z'); // 5 days out: step 7
    expect(await sendDueReminders(event.id, later)).toBe(1);
    expect((await outbox(event.id)).map((r) => r.step)).toEqual([7, 14]);
  });

  it('does not fire a skipped step retroactively', async () => {
    const { event } = await setup();
    // First look at the board is already 3 days past due: only step -3 goes out.
    expect(await sendDueReminders(event.id, fixedClock('2026-09-25T15:00:00Z'))).toBe(1);
    expect((await outbox(event.id)).map((r) => r.step)).toEqual([-3]);
  });

  it('writes what was sent, addressed to the owner, and keeps it', async () => {
    const { event } = await setup();
    await sendDueReminders(event.id, fixedClock('2026-09-20T15:00:00Z'));
    const [sent] = await outbox(event.id);
    expect(sent!.to).toBe('Dana Reyes');
    expect(sent!.body).toContain('is due Tue, Sep 22, in 2 days');
    await expect(prisma.$executeRaw`UPDATE "Reminder" SET body = 'edited' WHERE id = ${sent!.id}`).rejects.toThrow();
  });

  it('stops chasing a deliverable once it is locked', async () => {
    const { event, dana } = await setup();
    const v = await prisma.contentVersion.findFirstOrThrow({ where: { deliverable: { speakerId: dana.id } } });
    await approve(v.id, clock);
    await expect(sendDueReminders(event.id, fixedClock('2026-09-20T15:00:00Z'))).rejects.toThrow(ChaseRefused);
  });
});

describe('bureau roll-up', () => {
  it('names every missing item and counts the funnel', async () => {
    const { event, dana } = await setup();
    const bare = (await chaseBoard(event.id, clock)).speakers[0]!;
    expect(bare.missing).toEqual(['a headshot', 'a signed contract', 'an honorarium', 'a bio', 'an approved deck', 'consent on file']);

    await setProfile(dana.id, { bio: 'Dana runs ops.', headshotUrl: '/h.png', honorariumCents: 500_00, contractSignedAt: new Date('2026-08-15') });
    const filled = (await chaseBoard(event.id, clock)).speakers[0]!;
    expect(filled.missing).toEqual(['an approved deck', 'consent on file']);

    // The blocker is the lifecycle guard's own message, not a second opinion
    // about the same gap — so it names the deck the missing list just named.
    await prisma.speaker.update({ where: { id: dana.id }, data: { state: 'contracted' } });
    const { speakers, funnel } = await chaseBoard(event.id, clock);
    expect(speakers[0]!.blocked).toEqual({ to: 'content_complete', reason: 'needs an approved deck' });
    expect(funnel.find((f) => f.state === 'contracted')!.count).toBe(1);
  });
});
