import { beforeEach, describe, expect, it } from 'vitest';
import { budgetToActuals } from '../budget/budget';
import { addVendor, complianceBoard, recordDoc } from '../budget/compliance';
import { fixedClock } from '../clock';
import { prisma } from '../db';
import { makeEvent, resetDb } from '../test/harness';
import { addSchemaLine, advanceContract, award, compare, createRfp, enterQuote, rfpBoard, RfpRefused, setQuantity, setRegistration, type Item } from './rfp';

beforeEach(resetDb);

const clock = fixedClock('2026-09-01T15:00:00Z');

describe('comparison math', () => {
  const items: Item[] = [
    { id: 'lunch', label: 'Lunch', basis: 'per_head', quantity: null },
    { id: 'break', label: 'Afternoon break', basis: 'per_head', quantity: null },
    { id: 'staff', label: 'Service staff', basis: 'each', quantity: 12 },
    { id: 'linens', label: 'Linens', basis: 'flat', quantity: null },
  ];
  const q = (id: string, baseCents: number, basePerHead: boolean, answers: [string, 'included' | 'excluded' | 'extra', number?][]) => ({
    id, vendor: id, baseCents, basePerHead, lines: answers.map(([itemId, inclusion, unitCents]) => ({ itemId, inclusion, unitCents: unitCents ?? null })),
  });
  const quotes = [
    // $72 a head "all-inclusive" — except staff at $300 each.
    q('A', 7_200, true, [['lunch', 'included'], ['break', 'included'], ['staff', 'extra', 30_000], ['linens', 'included']]),
    // Cheapest on paper, because it leaves the break out.
    q('B', 6_800, true, [['lunch', 'included'], ['break', 'excluded'], ['staff', 'included'], ['linens', 'extra', 45_000]]),
    // A flat package, with the break at $6 a head on top.
    q('C', 2_000_000, false, [['lunch', 'included'], ['break', 'extra', 600], ['staff', 'included'], ['linens', 'included']]),
  ];

  it('normalizes base × headcount plus extras at unit × quantity, and flags gaps', () => {
    const c = compare(items, quotes, 260);
    const [a, b, cc] = c.quotes;
    expect(a).toMatchObject({ baseTotalCents: 1_872_000, totalCents: 1_872_000 + 360_000, perHeadCents: 8_585, gaps: [] });
    expect(b).toMatchObject({ totalCents: 1_768_000 + 45_000, gaps: ['Afternoon break'] });
    expect(cc).toMatchObject({ baseTotalCents: 2_000_000, totalCents: 2_000_000 + 156_000, gaps: [] });
    expect(c.rows.map((r) => [r.item.label, r.quantity, r.gap])).toEqual([['Lunch', 260, false], ['Afternoon break', 260, true], ['Service staff', 12, false], ['Linens', 1, false]]);
    // B is cheapest but incomplete; C is the lowest quote that covers every line.
    expect(c.lowestComplete).toBe('C');
  });

  it('per-head lines follow the headcount: at 300, the flat package wins by more', () => {
    const c = compare(items, quotes, 300);
    expect(c.quotes.map((x) => x.totalCents)).toEqual([2_160_000 + 360_000, 2_040_000 + 45_000, 2_000_000 + 180_000]);
    expect(c.lowestComplete).toBe('C');
  });

  it('with no complete quote there is no lowest, and no headcount means no per-head figure', () => {
    const c = compare(items, [quotes[1]!], 0);
    expect(c.lowestComplete).toBeNull();
    expect(c.quotes[0]!.perHeadCents).toBeNull();
  });
});

async function fixture() {
  const event = await makeEvent();
  await setRegistration(event.id, 'Sales', 220, 250);
  await setRegistration(event.id, 'Leadership', 40, 40);
  for (const [label, basis] of [['Lunch', 'per_head'], ['Service staff', 'each'], ['Linens', 'flat']] as const) await addSchemaLine('catering', label, basis);
  const rfp = await createRfp(event.id, 'catering', 'Day 1 catering', clock);
  const items = await prisma.rfpItem.findMany({ where: { rfpId: rfp.id }, orderBy: { position: 'asc' } });
  await setQuantity(items[1]!.id, 12);
  const good = await addVendor('Good Catering');
  await recordDoc(good.id, 'coi', '2026-01-01', '2027-01-01');
  await recordDoc(good.id, 'w9', '2026-01-01', null);
  const lapsed = await addVendor('Lapsed Catering');
  await recordDoc(lapsed.id, 'coi', '2026-01-01', '2026-10-13'); // lapses on day 1 of 2
  const answer = (inclusions: ('included' | 'excluded' | 'extra')[], unit = 30_000) => items.map((it, i) => ({ itemId: it.id, inclusion: inclusions[i]!, unitCents: inclusions[i] === 'extra' ? unit : null }));
  return { event, rfp, items, good, lapsed, answer };
}

describe('quotes and the award', () => {
  it('refuses a quote that leaves a line unanswered, or an extra with no price', async () => {
    const { rfp, items, good } = await fixture();
    await expect(enterQuote(rfp.id, { vendorId: good.id, baseCents: 7_000, basePerHead: true, receivedOn: '2026-09-01', lines: [{ itemId: items[0]!.id, inclusion: 'included' }] }))
      .rejects.toThrow('"Service staff" is not answered');
    await expect(enterQuote(rfp.id, { vendorId: good.id, baseCents: 7_000, basePerHead: true, receivedOn: '2026-09-01', lines: items.map((it) => ({ itemId: it.id, inclusion: 'extra' as const })) }))
      .rejects.toThrow('The extra cost for "Lunch"');
    expect(await prisma.quote.count()).toBe(0);
  });

  it('a revised quote replaces the vendor\'s last one', async () => {
    const { rfp, good, answer } = await fixture();
    await enterQuote(rfp.id, { vendorId: good.id, baseCents: 7_000, basePerHead: true, receivedOn: '2026-09-01', lines: answer(['included', 'extra', 'included']) });
    await enterQuote(rfp.id, { vendorId: good.id, baseCents: 6_500, basePerHead: true, receivedOn: '2026-09-02', lines: answer(['included', 'included', 'included']) });
    const [r] = (await rfpBoard(rfp.eventId, clock)).rfps;
    expect(r!.comparison.quotes.map((q) => q.totalCents)).toEqual([6_500 * 260]);
  });

  it('awards at the figure shown: a budget commitment and a contract, in one transaction', async () => {
    const { event, rfp, good, answer } = await fixture();
    const quote = await enterQuote(rfp.id, { vendorId: good.id, baseCents: 7_200, basePerHead: true, receivedOn: '2026-09-01', lines: answer(['included', 'extra', 'included']) });
    const total = 7_200 * 260 + 30_000 * 12;
    const c = await award(quote.id, total, clock);
    expect(c).toMatchObject({ committedCents: total, headcount: 260, papers: [], gaps: [], status: 'awarded' });

    const budget = await budgetToActuals(event.id);
    expect(budget.lines).toHaveLength(1);
    expect(budget.lines[0]).toMatchObject({ id: c.budgetLineId, category: 'catering', committedCents: total, vendorId: good.id, description: 'Day 1 catering — Good Catering (RFP award, 260 registered)' });

    // Closed: no second award, no revised quote, no quantity change.
    await expect(award(quote.id, total, clock)).rejects.toThrow('is awarded');
    await expect(enterQuote(rfp.id, { vendorId: good.id, baseCents: 1, basePerHead: false, receivedOn: '2026-09-02', lines: answer(['included', 'included', 'included']) })).rejects.toThrow('is awarded');

    await advanceContract(c.id, clock);
    await advanceContract(c.id, clock);
    expect((await prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).status).toBe('signed');
    await expect(advanceContract(c.id, clock)).rejects.toThrow('already signed');
  });

  it('refuses the award when the headcount moved since the page showed the total', async () => {
    const { event, rfp, good, answer } = await fixture();
    const quote = await enterQuote(rfp.id, { vendorId: good.id, baseCents: 7_200, basePerHead: true, receivedOn: '2026-09-01', lines: answer(['included', 'included', 'included']) });
    await setRegistration(event.id, 'Sales', 230, 250);
    await expect(award(quote.id, 7_200 * 260, clock)).rejects.toThrow(`now totals $19,440.00, not $18,720.00`);
    expect(await prisma.budgetLine.count()).toBe(0);
    expect(await prisma.contract.count()).toBe(0);
  });

  it('an award to a vendor with lapsed papers is recorded as flagged, with its gaps, and puts the vendor on the compliance worklist', async () => {
    const { event, rfp, lapsed, answer } = await fixture();
    const quote = await enterQuote(rfp.id, { vendorId: lapsed.id, baseCents: 1_500_000, basePerHead: false, receivedOn: '2026-09-01', lines: answer(['included', 'included', 'excluded']) });
    const c = await award(quote.id, 1_500_000, clock);
    expect(c.papers).toEqual(['certificate of insurance expires Tue, Oct 13, before the show ends', 'no W-9 on file']);
    expect(c.gaps).toEqual(['Linens']);
    const board = await complianceBoard(event.id, clock);
    expect(board.rows.filter((r) => r.vendor === 'Lapsed Catering').map((r) => r.reason)).toEqual(expect.arrayContaining(['lapses', 'missing']));
  });

  it('an RFP needs a schema, and a per-head line has no quantity to set', async () => {
    const { event, items } = await fixture();
    await expect(createRfp(event.id, 'av', 'AV', clock)).rejects.toThrow(RfpRefused);
    await expect(setQuantity(items[0]!.id, 5)).rejects.toThrow('per head');
    await expect(setRegistration(event.id, 'Sales', -1, 10)).rejects.toThrow('Registered');
  });
});
