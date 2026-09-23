import { beforeEach, describe, expect, it } from 'vitest';
import { fixedClock } from '../clock';
import { prisma } from '../db';
import { makeEvent, resetDb } from '../test/harness';
import { addLine } from './budget';
import { addVendor, complianceBoard, complianceOutbox, ComplianceRefused, recordDoc, sendComplianceNags } from './compliance';

// The event runs 2026-10-13/14 (harness default).
const at = (iso: string) => fixedClock(`${iso}T15:00:00Z`);

beforeEach(resetDb);

async function setup() {
  const event = await makeEvent();
  const vendor = await addVendor('Lakeshore Catering');
  await addLine(event.id, { category: 'catering', description: 'Lunch', committedCents: 2_400_000, vendorId: vendor.id });
  return { event, vendor };
}

const row = async (eventId: string, kind: 'coi' | 'w9', day: string) =>
  (await complianceBoard(eventId, at(day))).rows.find((r) => r.kind === kind)!;

describe('who is on the list', () => {
  it('only vendors with a line on this event', async () => {
    const { event } = await setup();
    await addVendor('Idle Rentals'); // no line, so nothing is asked of it
    const { rows } = await complianceBoard(event.id, at('2026-09-01'));
    expect(new Set(rows.map((r) => r.vendor))).toEqual(new Set(['Lakeshore Catering']));
  });
});

describe('derived due days', () => {
  it('a missing doc is due at the event start', async () => {
    const { event } = await setup();
    const r = await row(event.id, 'w9', '2026-09-01');
    expect([r.reason, r.dueDay, r.state]).toEqual(['missing', '2026-10-13', 'open']);
  });

  it('a COI that lapses before the last show day is due on its expiry; one in force through it is fine', async () => {
    const { event, vendor } = await setup();
    await recordDoc(vendor.id, 'coi', '2025-10-01', '2026-10-13'); // lapses on day 1 of 2
    let r = await row(event.id, 'coi', '2026-10-11');
    expect([r.reason, r.dueDay, r.daysLeft, r.state]).toEqual(['lapses', '2026-10-13', 2, 'due']);

    await recordDoc(vendor.id, 'coi', '2026-10-12', '2027-10-12'); // the renewal
    r = await row(event.id, 'coi', '2026-10-11');
    expect([r.reason, r.state, r.expiresOn]).toEqual([null, 'ok', '2027-10-12']);
  });

  it('a COI already lapsed is overdue', async () => {
    const { event, vendor } = await setup();
    await recordDoc(vendor.id, 'coi', '2025-09-01', '2026-09-01');
    expect((await row(event.id, 'coi', '2026-09-10')).state).toBe('overdue');
  });

  it('a W-9 on file is done', async () => {
    const { event, vendor } = await setup();
    await recordDoc(vendor.id, 'w9', '2026-01-05', null);
    expect((await row(event.id, 'w9', '2026-09-01')).state).toBe('ok');
  });
});

describe('recording docs', () => {
  it('refuses a COI with no expiry, a W-9 with one, and an expiry before receipt', async () => {
    const { vendor } = await setup();
    await expect(recordDoc(vendor.id, 'coi', '2026-01-01', null)).rejects.toThrow(ComplianceRefused);
    await expect(recordDoc(vendor.id, 'w9', '2026-01-01', '2027-01-01')).rejects.toThrow(ComplianceRefused);
    await expect(recordDoc(vendor.id, 'coi', '2026-01-01', '2026-01-01')).rejects.toThrow(ComplianceRefused);
  });

  it('the database backs the rule, and a doc on file is append-only', async () => {
    const { vendor } = await setup();
    await expect(prisma.complianceDoc.create({ data: { vendorId: vendor.id, kind: 'coi', receivedOn: new Date('2026-01-01') } })).rejects.toThrow(/ComplianceDoc_expiry_check/);
    const doc = await recordDoc(vendor.id, 'w9', '2026-01-01', null);
    await expect(prisma.complianceDoc.delete({ where: { id: doc.id } })).rejects.toThrow(/append-only/);
  });

  it('refuses a duplicate vendor name', async () => {
    await setup();
    await expect(addVendor(' Lakeshore Catering ')).rejects.toThrow(ComplianceRefused);
  });
});

describe('nag cadence', () => {
  it('sends each step once per due day, and a renewal that still lapses starts a new cadence', async () => {
    const { event, vendor } = await setup();
    await recordDoc(vendor.id, 'w9', '2026-01-05', null);
    await recordDoc(vendor.id, 'coi', '2025-10-01', '2026-10-01');

    expect(await sendComplianceNags(event.id, at('2026-09-20'))).toBe(1); // 11 days out: step 14
    await expect(sendComplianceNags(event.id, at('2026-09-21'))).rejects.toThrow(ComplianceRefused);
    expect(await sendComplianceNags(event.id, at('2026-09-25'))).toBe(1); // 6 days: step 7

    // A renewal that still ends before the show: new due day, fresh cadence.
    await recordDoc(vendor.id, 'coi', '2026-09-26', '2026-10-12');
    const r = await row(event.id, 'coi', '2026-09-28');
    expect([r.dueDay, r.lastSent, r.owed]).toEqual(['2026-10-12', null, 14]);

    const sent = await complianceOutbox(event.id);
    expect(sent.map((s) => s.step)).toEqual([7, 14]);
    expect(sent[0]!.body).toContain("Lakeshore Catering's certificate of insurance expires");
  });
});
