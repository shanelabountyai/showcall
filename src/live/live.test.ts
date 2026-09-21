import { beforeEach, describe, expect, it } from 'vitest';
import { publishAgenda } from '../agenda/publish';
import { fixedClock } from '../clock';
import { prisma } from '../db';
import { addCue, commitCascade, loadRunSheet, previewCascade, type RunSheetRow } from '../runsheet/cascade';
import { assign } from '../staffing/staffing';
import { makeEvent, makeSession, makeStaff, resetDb } from '../test/harness';
import { GoRefused, liveShow, markGo, projectLive } from './live';

const D1 = '2026-10-13';
const row = (id: string, room: string, startMin: number, endMin = startMin + 30): RunSheetRow =>
  ({ id, kind: 'cue', label: id, room, day: D1, startMin, endMin });

describe('projectLive', () => {
  const rows = [row('a', 'A', 540), row('b', 'A', 570), row('c', 'A', 600), row('x', 'B', 540)];
  const at = (room: string, live: ReturnType<typeof projectLive>) => live.find((r) => r.room === room)!;

  it('before anything goes, next is the first row and nothing moves', () => {
    const a = at('A', projectLive(rows, [], 530));
    expect(a).toMatchObject({ offsetMin: 0, current: null, next: { id: 'a', projectedMin: 540 } });
  });

  it('an overdue first row makes the room late by the clock', () => {
    const a = at('A', projectLive(rows, [], 544));
    expect(a.offsetMin).toBe(4);
    expect(a.rows.map((r) => r.projectedMin)).toEqual([544, 574, 604]);
  });

  it('a late GO carries its offset to every later row, and only in its room', () => {
    const live = projectLive(rows, [{ room: 'A', rowId: 'a', plannedMin: 540, actualMin: 547 }], 550);
    const a = at('A', live);
    expect(a).toMatchObject({ offsetMin: 7, current: { id: 'a', projectedMin: 547, state: 'current' }, next: { id: 'b', projectedMin: 577 } });
    expect(a.rows.map((r) => r.state)).toEqual(['current', 'next', 'upcoming']);
    expect(at('B', live).offsetMin).toBe(10); // B's first row is overdue on its own clock
  });

  it('an early GO runs early until the next row becomes overdue', () => {
    const marks = [{ room: 'A', rowId: 'a', plannedMin: 540, actualMin: 536 }];
    expect(at('A', projectLive(rows, marks, 560)).offsetMin).toBe(-4);
    expect(at('A', projectLive(rows, marks, 568)).offsetMin).toBe(-2);
  });

  it('the latest GO wins, so a mistaken GO is corrected by the next one', () => {
    const marks = [
      { room: 'A', rowId: 'c', plannedMin: 600, actualMin: 545 },
      { room: 'A', rowId: 'a', plannedMin: 540, actualMin: 545 },
    ];
    expect(at('A', projectLive(rows, marks, 546))).toMatchObject({ offsetMin: 5, current: { id: 'a' }, next: { id: 'b' } });
  });

  it('a GO on a row a rebase removed resumes after its planned time', () => {
    const a = at('A', projectLive(rows, [{ room: 'A', rowId: 'gone', plannedMin: 560, actualMin: 562 }], 563));
    expect(a).toMatchObject({ offsetMin: 2, current: null, next: { id: 'b', projectedMin: 572 } });
  });
});

describe('live mode against the database', () => {
  beforeEach(resetDb);

  async function show() {
    const event = await makeEvent(); // America/Chicago; Oct 13 is CDT, UTC−5
    const ballroom = await prisma.room.create({ data: { eventId: event.id, name: 'Ballroom A' } });
    const keynote = await makeSession(event.id, ballroom.id, D1, 540, 600);
    await publishAgenda(event.id, fixedClock('2026-10-01T15:00:00Z'));
    const p = await previewCascade(event.id, { rebase: true });
    await commitCascade(event.id, { rebase: true }, p.moved);
    const blank = { durationMin: 5, day: null, startMin: null, anchorEdge: null, offsetMin: 0, endById: null, endByEdge: null, endByOffsetMin: 0 } as const;
    const lectern = await addCue(event.id, ballroom.id, { ...blank, label: 'Lectern mic swap', anchorId: keynote.id, anchorEdge: 'end' });
    const sm = await makeStaff();
    await assign({ staffId: sm.id, eventId: event.id, roomId: ballroom.id, day: D1, startMin: 420, endMin: 1080, role: 'stage_manager' });
    return { event, ballroom, keynote, lectern, sm };
  }

  it('stamps GO from the clock on the venue wall clock and projects from it', async () => {
    const { event, keynote, lectern, sm } = await show();
    const clock = fixedClock('2026-10-13T14:06:30Z'); // 9:06 in Chicago
    const mark = await markGo(event.id, keynote.id, sm.id, clock);
    expect(mark).toMatchObject({ plannedMin: 540, actualMin: 546 });

    clock.advance(10 * 60_000);
    const live = await liveShow(event.id, clock);
    expect(live).toMatchObject({ day: D1, nowMin: 556, stale: false });
    expect(live.rooms[0]).toMatchObject({ offsetMin: 6, current: { id: keynote.id }, next: { id: lectern.id, projectedMin: 606 } });
  });

  it('writes no cue: the run sheet is identical before and after a GO', async () => {
    const { event, keynote, sm } = await show();
    const before = await loadRunSheet(event.id);
    const cues = await prisma.cue.findMany({ where: { eventId: event.id } });
    await markGo(event.id, keynote.id, sm.id, fixedClock('2026-10-13T14:20:00Z'));
    expect(await loadRunSheet(event.id)).toEqual(before);
    expect(await prisma.cue.findMany({ where: { eventId: event.id } })).toEqual(cues);
  });

  it('refuses GO on a row that is not on today’s run sheet', async () => {
    const { event, keynote, sm } = await show();
    await expect(markGo(event.id, keynote.id, sm.id, fixedClock('2026-10-14T14:00:00Z'))).rejects.toThrow(/today's run sheet/);
    await expect(markGo(event.id, 'nope', sm.id, fixedClock('2026-10-13T14:00:00Z'))).rejects.toThrow(/today's run sheet/);
  });

  it('the GO log is append-only', async () => {
    const { event, keynote, sm } = await show();
    const mark = await markGo(event.id, keynote.id, sm.id, fixedClock('2026-10-13T14:00:00Z'));
    await expect(prisma.liveMark.update({ where: { id: mark.id }, data: { actualMin: 540 } })).rejects.toThrow();
    await expect(prisma.liveMark.delete({ where: { id: mark.id } })).rejects.toThrow();
  });

  it('only the stage manager on duty for the room that day can call GO', async () => {
    const { event, ballroom, keynote, sm } = await show();
    const at9 = fixedClock('2026-10-13T14:00:00Z');
    const salon = await prisma.room.create({ data: { eventId: event.id, name: 'Salon B' } });
    const [crew, otherSm, tomorrowSm, showCaller] = await Promise.all([makeStaff(), makeStaff(), makeStaff(), makeStaff()]);
    const shift = { eventId: event.id, startMin: 420, endMin: 1080 };
    await assign({ ...shift, staffId: crew.id, roomId: ballroom.id, day: D1, role: 'crew' });
    await assign({ ...shift, staffId: otherSm.id, roomId: salon.id, day: D1, role: 'stage_manager' });
    await assign({ ...shift, staffId: tomorrowSm.id, roomId: ballroom.id, day: '2026-10-14', role: 'stage_manager' });
    await assign({ ...shift, staffId: showCaller.id, roomId: null, day: D1, role: 'stage_manager' });

    for (const who of [crew, otherSm, tomorrowSm]) {
      await expect(markGo(event.id, keynote.id, who.id, at9)).rejects.toThrow(GoRefused);
    }
    await expect(markGo(event.id, keynote.id, 'nobody', at9)).rejects.toThrow(/stage manager on duty in Ballroom A/);
    expect(await prisma.liveMark.count()).toBe(0);

    expect(await markGo(event.id, keynote.id, sm.id, at9)).toMatchObject({ staffId: sm.id });
    expect(await markGo(event.id, keynote.id, showCaller.id, at9)).toMatchObject({ staffId: showCaller.id }); // event-wide
  });
});
