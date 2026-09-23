import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../db';
import { addCue, commitCascade, loadRunSheet, previewCascade } from '../runsheet/cascade';
import type { Timing } from '../runsheet/cues';
import { makeEvent, resetDb } from '../test/harness';
import { crewWarnings, type CrewRules } from './workrules';

const D1 = '2026-10-13';
const RULES: CrewRules = { overtimeAfterMin: 600, mealWithinMin: 360, mealBreakMin: 30, mealPenaltyCents: 25_00, mealPenaltyStepMin: 30 };
const blank = { day: null, startMin: null, anchorId: null, anchorEdge: null, offsetMin: 0, endById: null, endByEdge: null, endByOffsetMin: 0 } as const;

beforeEach(resetDb);

describe('crew work rules (pure)', () => {
  const at = (startMin: number, endMin: number, day = D1): Timing => ({ day, startMin, endMin });
  const run = (spans: Timing[], rules: CrewRules | null = RULES) =>
    crewWarnings(rules, [{ id: 'r', name: 'Doors', cueIds: spans.map((_, i) => `c${i}`) }], new Map(spans.map((t, i) => [`c${i}`, t])));

  it('no rules, no warnings', () => expect(run([at(0, 1439)], null)).toEqual([]));

  it('overtime is call to wrap past the straight-time day; exactly ten hours is not', () => {
    expect(run([at(510, 540), at(1020, 1110)])).toEqual([]);
    expect(run([at(510, 540), at(1050, 1140)]).map((w) => w.message)).toEqual(['Doors Tue, Oct 13: on the clock 8:30–19:00, 30 min past the 10:00 straight-time day']);
  });

  it('a meal penalty is billed per started step past the limit, and a qualifying gap resets the clock', () => {
    // 8:00–14:01 back to back (overlapping cues merge): 1 min past six hours is one full step.
    expect(run([at(480, 700), at(690, 841)]).map((w) => [w.kind, w.cents])).toEqual([['meal_penalty', 25_00]]);
    // 8:00–15:00 is 60 min over: two steps.
    expect(run([at(480, 900)])[0]!.cents).toBe(50_00);
    // A 29-min gap is not a meal; a 30-min gap is.
    expect(run([at(480, 700), at(729, 900)])[0]!.cents).toBe(50_00);
    expect(run([at(480, 700), at(730, 900)])).toEqual([]);
  });

  it('each day is its own shift', () => {
    expect(run([at(480, 700), at(730, 900, '2026-10-14')])).toEqual([]);
  });
});

describe('crew work rules in the cascade', () => {
  it('a move that causes overtime is a new warning on the preview, and the commit still lands', async () => {
    const event = await makeEvent();
    const room = await prisma.room.create({ data: { eventId: event.id, name: 'Terrace' } });
    await prisma.crewRules.create({ data: { eventId: event.id, ...RULES } });
    const role = await prisma.callRole.create({ data: { eventId: event.id, name: 'Doors' } });
    const doors = await addCue(event.id, room.id, { ...blank, label: 'Doors', durationMin: 30, day: D1, startMin: 510 });
    const reception = await addCue(event.id, room.id, { ...blank, label: 'Reception', durationMin: 90, day: D1, startMin: 1020 });
    await prisma.cueRole.createMany({ data: [doors, reception].map((c) => ({ cueId: c.id, roleId: role.id })) });
    expect((await loadRunSheet(event.id)).warnings).toEqual([]);

    const change = { edits: [{ cueId: reception.id, startMin: 1050 }] };
    const preview = await previewCascade(event.id, change);
    expect(preview.problems).toEqual([]);
    expect(preview.warnings).toMatchObject([{ kind: 'overtime', roleId: role.id, isNew: true }]);

    await commitCascade(event.id, change, preview.moved);
    expect((await loadRunSheet(event.id)).warnings).toMatchObject([{ kind: 'overtime' }]);
    // Already there: the next preview does not call it new.
    expect((await previewCascade(event.id, { edits: [] })).warnings).toMatchObject([{ isNew: false }]);
  });

  it('the database refuses a zero step', async () => {
    const event = await makeEvent();
    await expect(prisma.crewRules.create({ data: { eventId: event.id, ...RULES, mealPenaltyStepMin: 0 } })).rejects.toThrow(/CrewRules_positive/);
  });
});
