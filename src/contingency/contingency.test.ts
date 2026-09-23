import { beforeEach, describe, expect, it } from 'vitest';
import { publishAgenda } from '../agenda/publish';
import { fixedClock } from '../clock';
import { prisma } from '../db';
import { addCue, CascadeBlocked, commitCascade, loadRunSheet, previewCascade } from '../runsheet/cascade';
import { makeEvent, makeSession, makeStaff, resetDb } from '../test/harness';
import { toDbDate } from '../time';
import { contingencyBoard, ContingencyRefused, createPlan, escalateAll, escalateDue, type PlanInput } from './contingency';

const D1 = '2026-10-13';
const blank = { day: null, startMin: null, anchorId: null, anchorEdge: null, offsetMin: 0, endById: null, endByEdge: null, endByOffsetMin: 0 } as const;
/** Oct 13 in Chicago is CDT, UTC−5: 10:00 local is 15:00Z. */
const local = (hh: number, mm = 0) => fixedClock(`${D1}T${String(hh + 5).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00Z`);

beforeEach(resetDb);

/** A terrace reception at 17:00 and a rain call on it, due 7 h before — 10:00. */
async function show() {
  const event = await makeEvent();
  const ballroom = await prisma.room.create({ data: { eventId: event.id, name: 'Ballroom' } });
  const terrace = await prisma.room.create({ data: { eventId: event.id, name: 'Terrace' } });
  await makeSession(event.id, ballroom.id, D1, 540, 600);
  await publishAgenda(event.id, local(8));
  const built = await previewCascade(event.id, { rebase: true });
  await commitCascade(event.id, { rebase: true }, built.moved);
  const reception = await addCue(event.id, terrace.id, { ...blank, label: 'Reception', durationMin: 90, day: D1, startMin: 1020 });
  const owner = await makeStaff(), producer = await makeStaff();
  await prisma.assignment.create({ data: { eventId: event.id, staffId: producer.id, day: toDbDate(D1), startMin: 420, endMin: 1080, role: 'producer' } });
  const tents = await prisma.vendor.create({ data: { name: 'Tent Co' } });
  const input: PlanInput = {
    title: 'Rain call', trigger: 'NWS ≥ 40% rain 17:00–19:00', ownerId: owner.id,
    decideBy: { roomId: terrace.id, day: null, startMin: null, anchorId: reception.id, anchorEdge: 'start', offsetMin: -420 },
    branches: [
      { label: 'Dry: hold on the terrace', cueEdits: [] },
      {
        label: 'Rain: move to the ballroom', cueEdits: [{ cueId: reception.id, roomId: ballroom.id, startMin: 1050 }],
        costDeltaCents: 250_000, costCategory: 'production', costVendorId: tents.id,
        notices: [{ vendorId: tents.id, body: 'Strike the terrace tent; reception moves indoors.' }],
      },
    ],
  };
  return { event, ballroom, terrace, reception, owner, producer, tents, input };
}

describe('contingency plans', () => {
  it('the decide-by is a run-sheet cue, anchored: moving the reception moves the deadline', async () => {
    const { event, reception, input } = await show();
    const plan = await createPlan(event.id, input);
    const sheet = await loadRunSheet(event.id);
    expect(sheet.rows.find((r) => r.id === plan.decideByCueId)).toMatchObject({ label: 'Decide: Rain call', startMin: 600, endMin: 600 });

    let [p] = (await contingencyBoard(event.id, local(8))).plans;
    expect(p).toMatchObject({ decideBy: { day: D1, min: 600 }, minutesLeft: 120, state: 'open' });
    expect(p!.branches.map((b) => b.label)).toEqual(['Dry: hold on the terrace', 'Rain: move to the ballroom']);

    const edit = { edits: [{ cueId: reception.id, startMin: 1080 }] };
    await commitCascade(event.id, edit, (await previewCascade(event.id, edit)).moved);
    [p] = (await contingencyBoard(event.id, local(8))).plans;
    expect(p).toMatchObject({ decideBy: { min: 660 }, minutesLeft: 180 });
  });

  it('refuses a malformed plan and writes nothing — not even the cue', async () => {
    const { event, reception, input } = await show();
    const refused = (patch: Partial<PlanInput>) => expect(createPlan(event.id, { ...input, ...patch })).rejects.toThrow(ContingencyRefused);
    await refused({ branches: [input.branches[0]!] });
    await refused({ branches: [input.branches[0]!, { ...input.branches[1]!, label: ' Dry: hold on the terrace ' }] });
    await refused({ trigger: '  ' });
    await refused({ branches: [input.branches[0]!, { label: 'Rain', cueEdits: [{ cueId: 'elsewhere' }] }] });
    await refused({ branches: [input.branches[0]!, { label: 'Rain', cueEdits: [{ cueId: reception.id }, { cueId: reception.id }] }] });
    await refused({ branches: [input.branches[0]!, { label: 'Rain', cueEdits: [], costDeltaCents: -1 }] });
    await refused({ branches: [input.branches[0]!, { label: 'Rain', cueEdits: [], costDeltaCents: 12.5 }] });
    // A decide-by before midnight is a run-sheet problem: the cascade refuses it, and the plan with it.
    await expect(createPlan(event.id, { ...input, decideBy: { ...input.decideBy, offsetMin: -1100 } })).rejects.toThrow(CascadeBlocked);
    expect(await prisma.contingencyPlan.count()).toBe(0);
    expect(await prisma.cue.count()).toBe(1);
  });

  it('escalates an unmade call at its decide-by, once, to the owner and the producer', async () => {
    const { event, owner, producer, input } = await show();
    const plan = await createPlan(event.id, input);

    expect((await contingencyBoard(event.id, local(9, 0))).plans[0]!.state).toBe('due');
    expect(await escalateDue(event.id, local(9, 59))).toBe(0);

    const board = await contingencyBoard(event.id, local(10, 0));
    expect(board.plans[0]).toMatchObject({ state: 'overdue', minutesLeft: 0, escalated: null });
    expect(await escalateDue(event.id, local(10, 0))).toBe(1);
    expect(await escalateAll(local(10, 5))).toBe(0); // the deadline is the key: never twice

    const [sent] = await prisma.contingencyEscalation.findMany();
    expect(sent).toMatchObject({ planId: plan.id, minute: 600, to: `${owner.name}, ${producer.name}` });
    expect(sent!.body).toContain('"Rain call" was to be called by 10:00');
    expect(sent!.body).toContain('Dry: hold on the terrace / Rain: move to the ballroom');
    await expect(prisma.contingencyEscalation.update({ where: { id: sent!.id }, data: { body: 'x' } })).rejects.toThrow();
    expect((await contingencyBoard(event.id, local(10, 5))).plans[0]!.escalated?.id).toBe(sent!.id);
  });

  it('a decide-by moved later owes a fresh escalation at the new deadline', async () => {
    const { event, reception, input } = await show();
    await createPlan(event.id, input);
    expect(await escalateDue(event.id, local(10))).toBe(1);

    const edit = { edits: [{ cueId: reception.id, startMin: 1080 }] }; // decide-by 11:00 now
    await commitCascade(event.id, edit, (await previewCascade(event.id, edit)).moved);
    expect((await contingencyBoard(event.id, local(10, 30))).plans[0]).toMatchObject({ state: 'due', escalated: null });
    expect(await escalateDue(event.id, local(11))).toBe(1);
    expect(await prisma.contingencyEscalation.count()).toBe(2);
  });

  it('a decided plan never escalates; a decision takes one of its own branches, once', async () => {
    const { event, input } = await show();
    const plan = await createPlan(event.id, input);
    const other = await createPlan(event.id, { ...input, title: 'Second call' });
    const [own] = await prisma.contingencyBranch.findMany({ where: { planId: plan.id } });
    const [foreign] = await prisma.contingencyBranch.findMany({ where: { planId: other.id } });
    const at = local(9).now();

    await expect(prisma.contingencyDecision.create({ data: { planId: plan.id, branchId: foreign!.id, decidedAt: at } })).rejects.toThrow();
    await prisma.contingencyDecision.create({ data: { planId: plan.id, branchId: own!.id, decidedAt: at } });
    await expect(prisma.contingencyDecision.create({ data: { planId: plan.id, branchId: own!.id, decidedAt: at } })).rejects.toThrow();

    const board = await contingencyBoard(event.id, local(12));
    expect(board.plans.map((p) => [p.title, p.state])).toEqual([['Rain call', 'decided'], ['Second call', 'overdue']]);
    expect(await escalateDue(event.id, local(12))).toBe(1);
    expect((await prisma.contingencyEscalation.findFirstOrThrow()).planId).toBe(other.id);
  });
});
