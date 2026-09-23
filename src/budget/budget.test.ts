import { beforeEach, describe, expect, it } from 'vitest';
import { fixedClock } from '../clock';
import { prisma } from '../db';
import { parseCents } from '../money';
import { makeEvent, resetDb } from '../test/harness';
import { addLine, budgetToActuals, BudgetRefused, takeSnapshot, updateLine } from './budget';

const clock = fixedClock('2026-09-01T15:00:00Z');

beforeEach(resetDb);

describe('parseCents', () => {
  it('reads dollars as typed into integer cents, with no float in between', () => {
    expect(['80', '$80', '1,234.5', '0.07', '19.99', '1234567.89'].map(parseCents)).toEqual([8000, 8000, 123450, 7, 1999, 123456789]);
  });
  it('refuses what is not an amount', () => {
    expect(['', '-5', '1.234', '12,34', 'abc', '1e3'].map(parseCents)).toEqual([null, null, null, null, null, null]);
  });
});

describe('budget lines', () => {
  it('refuses negative, fractional and overflowing cents, and an empty description', async () => {
    const { id } = await makeEvent();
    for (const committedCents of [-1, 1.5, 2 ** 31]) {
      await expect(addLine(id, { category: 'av', description: 'LED wall', committedCents })).rejects.toThrow(BudgetRefused);
    }
    await expect(addLine(id, { category: 'av', description: '  ', committedCents: 100 })).rejects.toThrow(BudgetRefused);
  });

  it('the database refuses a negative line even past the module', async () => {
    const { id } = await makeEvent();
    await expect(prisma.budgetLine.create({ data: { eventId: id, category: 'av', description: 'x', committedCents: -1 } })).rejects.toThrow(/BudgetLine_cents_check/);
  });
});

describe('budget-to-actuals', () => {
  async function setup() {
    const event = await makeEvent();
    const av = await addLine(event.id, { category: 'av', description: 'LED wall', committedCents: 1_800_000 });
    await addLine(event.id, { category: 'catering', description: 'Lunch day 1', committedCents: 2_400_000 });
    await addLine(event.id, { category: 'catering', description: 'Crew meals', committedCents: 150_000, clientBillable: false });
    return { event, av };
  }

  it('totals by category, with variance and the client-billable split', async () => {
    const { event, av } = await setup();
    await updateLine(av.id, { actualCents: 1_950_000 }); // the invoice came in over
    const view = await budgetToActuals(event.id);
    expect(view.categories.map((c) => [c.category, c.committed, c.actual, c.variance])).toEqual([
      ['av', 1_800_000, 1_950_000, 150_000],
      ['catering', 2_550_000, 0, -2_550_000],
    ]);
    expect(view.total).toEqual({ committed: 4_350_000, actual: 1_950_000, variance: -2_400_000, billableCommitted: 4_200_000, billableActual: 1_950_000 });
    expect(view.sinceSnapshot).toBeNull();
  });

  it('snapshots freeze the budget, number per event, and the view shows drift since the latest', async () => {
    const { event, av } = await setup();
    const s1 = await takeSnapshot(event.id, 'client v1', clock);
    expect([s1.number, s1.committedCents, s1.billableCents]).toEqual([1, 4_350_000, 4_200_000]);

    await updateLine(av.id, { committedCents: 2_100_000 }); // change order
    await addLine(event.id, { category: 'decor', description: 'Stage florals', committedCents: 60_000 });
    const view = await budgetToActuals(event.id);
    expect(view.sinceSnapshot).toBe(360_000);
    expect(view.categories.map((c) => [c.category, c.sinceSnapshot])).toEqual([['av', 300_000], ['catering', 0], ['decor', 60_000]]);

    // The snapshot still says what it said.
    const frozen = await prisma.budgetSnapshot.findUniqueOrThrow({ where: { id: s1.id } });
    expect((frozen.lines as { description: string; committedCents: number }[]).find((l) => l.description === 'LED wall')!.committedCents).toBe(1_800_000);
    expect((await takeSnapshot(event.id, 'post change order', clock)).number).toBe(2);
  });

  it('a snapshot is append-only in the database', async () => {
    const { event } = await setup();
    const s = await takeSnapshot(event.id, 'client v1', clock);
    await expect(prisma.budgetSnapshot.update({ where: { id: s.id }, data: { label: 'rewritten' } })).rejects.toThrow(/append-only/);
    await expect(prisma.budgetSnapshot.delete({ where: { id: s.id } })).rejects.toThrow(/append-only/);
  });

  it('refuses a snapshot with no label', async () => {
    const { event } = await setup();
    await expect(takeSnapshot(event.id, ' ', clock)).rejects.toThrow(BudgetRefused);
  });
});
