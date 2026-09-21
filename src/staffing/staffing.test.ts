import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../db';
import { makeEvent, makeStaff, resetDb } from '../test/harness';
import { assign, StaffingRefused, stageManagersOnDuty } from './staffing';

const D1 = '2026-10-13';

describe('staffing', () => {
  beforeEach(resetDb);

  const shift = (staffId: string, eventId: string, startMin: number, endMin: number, day = D1) =>
    ({ staffId, eventId, roomId: null, day, startMin, endMin, role: 'crew' as const });

  it('refuses an overlap, naming the clash, even on another event', async () => {
    const [a, b] = await Promise.all([makeEvent(), makeEvent()]);
    const tech = await makeStaff();
    await assign(shift(tech.id, a.id, 480, 720));
    await expect(assign(shift(tech.id, b.id, 700, 900))).rejects.toThrow(new RegExp(`already on ${a.name} 8:00–12:00`));
    expect(await assign(shift(tech.id, b.id, 720, 900))).toMatchObject({ eventId: b.id }); // back-to-back is fine
  });

  it('refuses past the daily cap, counted across events, and only that day', async () => {
    const [a, b] = await Promise.all([makeEvent(), makeEvent()]);
    const tech = await makeStaff(600);
    await assign(shift(tech.id, a.id, 420, 780)); // 360
    await expect(assign(shift(tech.id, b.id, 800, 1100))).rejects.toThrow(/would work 660 min.*cap is 600/);
    await assign(shift(tech.id, b.id, 800, 1040)); // exactly 600
    await assign(shift(tech.id, b.id, 420, 1020, '2026-10-14'));
    expect(await prisma.assignment.count()).toBe(3);
  });

  it('refuses a day outside the event and a room from another event', async () => {
    const [a, b] = await Promise.all([makeEvent(), makeEvent()]);
    const tech = await makeStaff();
    await expect(assign(shift(tech.id, a.id, 480, 600, '2026-10-15'))).rejects.toThrow(StaffingRefused);
    const foreign = await prisma.room.create({ data: { eventId: b.id, name: 'Elsewhere' } });
    await expect(assign({ ...shift(tech.id, a.id, 480, 600), roomId: foreign.id })).rejects.toThrow();
    expect(await prisma.assignment.count()).toBe(0);
  });

  it('two concurrent bookings of the same person cannot both land past the cap', async () => {
    const [a, b] = await Promise.all([makeEvent(), makeEvent()]);
    const tech = await makeStaff(480);
    const results = await Promise.allSettled([assign(shift(tech.id, a.id, 420, 720)), assign(shift(tech.id, b.id, 780, 1080))]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('stage managers on duty: the room’s, plus event-wide', async () => {
    const event = await makeEvent();
    const [ballroom, salon] = await Promise.all(['Ballroom A', 'Salon B'].map((name) => prisma.room.create({ data: { eventId: event.id, name } })));
    const [smA, smB, lead] = await Promise.all([makeStaff(), makeStaff(), makeStaff()]);
    const sm = (staffId: string, roomId: string | null) => assign({ staffId, eventId: event.id, roomId, day: D1, startMin: 420, endMin: 1080, role: 'stage_manager' });
    await sm(smA.id, ballroom!.id);
    await sm(smB.id, salon!.id);
    await sm(lead.id, null);
    const ids = (await stageManagersOnDuty(event.id, D1, ballroom!.id)).map((a) => a.staffId).sort();
    expect(ids).toEqual([smA.id, lead.id].sort());
    expect(await stageManagersOnDuty(event.id, D1)).toHaveLength(3);
  });
});
