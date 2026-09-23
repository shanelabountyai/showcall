import { beforeEach, describe, expect, it } from 'vitest';
import { addThreshold, assess, createBlock, decide, reserve, type Contract } from '../attrition/attrition';
import { addLine, BudgetRefused, takeSnapshot, updateLine } from '../budget/budget';
import { fixedClock } from '../clock';
import { prisma } from '../db';
import type { RunSheetRow } from '../runsheet/cascade';
import { makeEvent, resetDb } from '../test/harness';
import { closeBudget, CloseRefused, cueSlip, finalAttrition, reconciliation } from './reconcile';

const D1 = '2026-10-13', D2 = '2026-10-14';
const row = (id: string, room: string, startMin: number, day = D1): RunSheetRow => ({ id, kind: 'cue', label: id, room, day, startMin, endMin: startMin + 30 });
const go = (rowId: string, room: string, plannedMin: number, actualMin: number, day = D1) => ({ rowId, room, plannedMin, actualMin, day });

describe('planned vs. actual', () => {
  const rows = [row('a', 'A', 540), row('b', 'A', 570), row('c', 'A', 600), row('d', 'A', 630), row('x', 'B', 540), row('y', 'A', 540, D2)];

  it('slip per row, what each row added, and the row that added the most', () => {
    const [a] = cueSlip(rows, [go('a', 'A', 540, 542), go('b', 'A', 570, 573), go('c', 'A', 600, 611)]);
    expect(a!.rows.map((r) => [r.id, r.slipMin, r.addedMin])).toEqual([['a', 2, 2], ['b', 3, 1], ['c', 11, 8], ['d', null, null]]);
    expect(a).toMatchObject({ day: D1, room: 'A', called: 3, finalSlipMin: 11, worst: { id: 'c' } });
  });

  it('the latest GO on a row wins; an early row adds negative slip', () => {
    const [a] = cueSlip(rows, [go('a', 'A', 540, 550), go('a', 'A', 540, 545), go('b', 'A', 570, 568)]);
    expect(a!.rows.slice(0, 2).map((r) => [r.actualMin, r.slipMin, r.addedMin])).toEqual([[545, 5, 5], [568, -2, -7]]);
    expect(a!.worst!.id).toBe('a');
  });

  it('planned is the start when GO was called, not where a later rebase put the row', () => {
    const moved = [row('a', 'A', 555), row('b', 'A', 585)];
    const [a] = cueSlip(moved, [go('a', 'A', 540, 540)]);
    expect(a!.rows[0]).toMatchObject({ plannedMin: 540, slipMin: 0 });
    expect(a!.rows[1]).toMatchObject({ plannedMin: 585, actualMin: null });
  });

  it('keeps a GO on a row no longer on the run sheet, and splits rooms and days', () => {
    const out = cueSlip(rows, [go('gone', 'A', 560, 566)]);
    expect(out.map((g) => [g.day, g.room])).toEqual([[D1, 'A'], [D1, 'B'], [D2, 'A']]);
    expect(out[0]!.rows.map((r) => r.id)).toEqual(['a', 'gone', 'b', 'c', 'd']);
    expect(out[0]!.rows[1]).toMatchObject({ label: '(no longer on the run sheet)', slipMin: 6 });
    expect(out[1]).toMatchObject({ called: 0, finalSlipMin: null, worst: null });
  });
});

// 200 room-nights at $240; 50 picked up; 50% by Aug 14 and 80% by Sep 13 (as in attrition.test).
const contract = (acceptedRoomNights: number): Contract => ({
  rateCents: 24_000, contractedOn: '2026-06-15', cutoffOn: '2026-09-21',
  nights: [{ night: '2026-10-12', rooms: 40 }, { night: '2026-10-13', rooms: 80 }, { night: '2026-10-14', rooms: 80 }], releases: [],
  stays: [{ rooms: 25, arriveOn: '2026-10-12', departOn: '2026-10-14', bookedOn: '2026-07-01' }],
  thresholds: [{ id: 'd60', dueOn: '2026-08-14', percent: 50 }, { id: 'd30', dueOn: '2026-09-13', percent: 80 }],
  acceptedRoomNights,
});

describe('final attrition', () => {
  it('owes the worst shortfall, never the sum, to the cent', () => {
    expect(assess(contract(0), '2026-10-20').map((a) => a.shortfall)).toEqual([50, 110]);
    expect(finalAttrition(contract(0), '2026-10-20')).toMatchObject({ shortfall: 110, owedCents: 2_640_000, postedCents: 0, gapCents: 2_640_000, ahead: [] });
  });
  it('nets what is already on the budget; over-accrual shows as a negative gap', () => {
    expect(finalAttrition(contract(40), '2026-10-20').gapCents).toBe(1_680_000);
    expect(finalAttrition(contract(110), '2026-10-20').gapCents).toBe(0);
    expect(finalAttrition(contract(120), '2026-10-20').gapCents).toBe(-240_000);
  });
  it('names thresholds that have not passed', () => {
    expect(finalAttrition(contract(0), '2026-09-01').ahead.map((a) => a.id)).toEqual(['d30']);
  });
});

describe('budget close', () => {
  beforeEach(resetDb);
  const after = fixedClock('2026-10-20T15:00:00Z');

  it('is refused during the show and while an invoice is outstanding, naming each', async () => {
    const event = await makeEvent();
    await addLine(event.id, { category: 'av', description: 'LED wall', committedCents: 1_800_000 });
    await expect(closeBudget(event.id, 0, fixedClock('2026-10-14T15:00:00Z'))).rejects.toThrow(/show runs through Wed, Oct 14.*Awaiting invoice: LED wall/);
    await expect(closeBudget(event.id, 0, after)).rejects.toThrow(CloseRefused);
  });

  it('refuses a figure the producer did not see, then closes and freezes every line', async () => {
    const event = await makeEvent();
    const line = await addLine(event.id, { category: 'av', description: 'LED wall', committedCents: 1_800_000 });
    await addLine(event.id, { category: 'other', description: 'Cancelled shuttle', committedCents: 0 });
    await updateLine(line.id, { actualCents: 1_950_000 });
    await takeSnapshot(event.id, 'client v1', after);
    await expect(closeBudget(event.id, 1_800_000, after)).rejects.toThrow(/actuals now total \$19,500\.00/);

    const close = await closeBudget(event.id, 1_950_000, after);
    expect(close).toMatchObject({ number: 2, label: 'Close', final: true, committedCents: 1_800_000, actualCents: 1_950_000 });
    await expect(addLine(event.id, { category: 'av', description: 'Late add', committedCents: 1 })).rejects.toThrow(BudgetRefused);
    await expect(updateLine(line.id, { actualCents: 1 })).rejects.toThrow(BudgetRefused);
    // The database holds the freeze even past the module.
    await expect(prisma.budgetLine.update({ where: { id: line.id }, data: { actualCents: 1 } })).rejects.toThrow(/is closed/);
    await expect(prisma.budgetLine.delete({ where: { id: line.id } })).rejects.toThrow(/is closed/);
    await expect(closeBudget(event.id, 1_950_000, after)).rejects.toThrow(/was closed on 2026-10-20/);
    // Another event's budget is untouched by this one's close.
    const other = await makeEvent();
    await expect(addLine(other.id, { category: 'av', description: 'Fine', committedCents: 1 })).resolves.toBeTruthy();
  });

  it('owed attrition blocks the close until it is accepted onto the budget', async () => {
    const event = await makeEvent();
    const hotel = await prisma.vendor.create({ data: { name: 'Lakeview Grand' } });
    const block = await createBlock(event.id, { hotelId: hotel.id, rateCents: 24_000, contractedOn: '2026-06-15', cutoffOn: '2026-09-21', nights: contract(0).nights });
    await addThreshold(block.id, '2026-08-14', 50);
    const d30 = await addThreshold(block.id, '2026-09-13', 80);
    await reserve(block.id, { kind: 'attendee', guest: 'Group A', rooms: 25, arriveOn: '2026-10-12', departOn: '2026-10-14' }, fixedClock('2026-07-01T15:00:00Z'));

    await expect(closeBudget(event.id, 0, after)).rejects.toThrow(/Lakeview Grand: \$26,400\.00 of attrition is owed/);
    const view = await reconciliation(event.id, after);
    expect(view.attrition[0]).toMatchObject({ hotel: 'Lakeview Grand', shortfall: 110, gapCents: 2_640_000 });

    const accepted = await decide(d30.id, 'accept', 2_640_000, after);
    await updateLine(accepted.budgetLineId!, { actualCents: 2_640_000 });
    await expect(closeBudget(event.id, 2_640_000, after)).resolves.toMatchObject({ final: true });
  });
});
