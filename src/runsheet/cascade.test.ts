import { beforeEach, describe, expect, it } from 'vitest';
import { publishAgenda } from '../agenda/publish';
import { fixedClock } from '../clock';
import { prisma } from '../db';
import { makeEvent, makeSession, resetDb } from '../test/harness';
import { addCue, CascadeBlocked, CascadeChanged, commitCascade, loadRunSheet, previewCascade } from './cascade';
import type { CueSpec } from './cues';

const D1 = '2026-10-13';
const clock = fixedClock('2026-10-01T15:00:00Z');
const blank = { durationMin: 0, day: null, startMin: null, anchorId: null, anchorEdge: null, offsetMin: 0, endById: null, endByEdge: null, endByOffsetMin: 0 } as const;
const spec = (label: string, s: Partial<CueSpec>): Omit<CueSpec, 'id'> => ({ ...blank, label, ...s });

beforeEach(resetDb);

/** Keynote 9:00–10:00, panel 11:00; doors 30 before, strike 20 after, reset 20 after strike and done by the panel. */
async function show() {
  const event = await makeEvent();
  const room = await prisma.room.create({ data: { eventId: event.id, name: 'Ballroom A' } });
  const keynote = await makeSession(event.id, room.id, D1, 540, 600);
  const panel = await makeSession(event.id, room.id, D1, 660, 720);
  await publishAgenda(event.id, clock);
  const built = await previewCascade(event.id, { rebase: true });
  await commitCascade(event.id, { rebase: true }, built.moved);

  const doors = await addCue(event.id, room.id, spec('Doors', { anchorId: keynote.id, anchorEdge: 'start', offsetMin: -30 }));
  const strike = await addCue(event.id, room.id, spec('Strike', { anchorId: keynote.id, anchorEdge: 'end', durationMin: 20 }));
  const reset = await addCue(event.id, room.id, spec('Reset', { anchorId: strike.id, anchorEdge: 'end', durationMin: 20, endById: panel.id, endByEdge: 'start' }));
  const moveKeynote = async (by: number) => {
    await prisma.session.update({ where: { id: keynote.id }, data: { startMin: { increment: by }, endMin: { increment: by } } });
    await publishAgenda(event.id, clock);
  };
  return { event, room, keynote, panel, doors, strike, reset, moveKeynote };
}

const version = async (eventId: string) => (await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).runSheetVersion;

describe('run-sheet cascade', () => {
  it('keynote moves 15 min: preview names the cascade and writes nothing; commit lands it', async () => {
    const { event, keynote, doors, strike, reset, moveKeynote } = await show();
    expect((await loadRunSheet(event.id)).rows.map((r) => [r.label, r.startMin, r.endMin])).toEqual([
      ['Doors', 510, 510], [expect.any(String), 540, 600], ['Strike', 600, 620], ['Reset', 620, 640], [expect.any(String), 660, 720],
    ]);

    await moveKeynote(15);
    expect(await loadRunSheet(event.id)).toMatchObject({ agendaVersion: 1, currentVersion: 2, stale: true });

    const preview = await previewCascade(event.id, { rebase: true });
    expect(preview.problems).toEqual([]);
    expect(Object.fromEntries(preview.moved.map((m) => [m.id, [m.from!.startMin, m.to!.startMin]]))).toEqual({
      [keynote.id]: [540, 555], [doors.id]: [510, 525], [strike.id]: [600, 615], [reset.id]: [620, 635],
    });
    expect(await version(event.id)).toBe(1);

    await commitCascade(event.id, { rebase: true }, preview.moved);
    const sheet = await loadRunSheet(event.id);
    expect(sheet).toMatchObject({ agendaVersion: 2, stale: false, problems: [] });
    expect(sheet.rows.find((r) => r.id === reset.id)).toMatchObject({ startMin: 635, endMin: 655, slack: 5 });
  });

  it('impossible compression blocks the rebase; the fix and the rebase land together', async () => {
    const { event, panel, reset, moveKeynote } = await show();
    await moveKeynote(30);

    const blocked = await previewCascade(event.id, { rebase: true });
    expect(blocked.problems.map((p) => p.message)).toEqual([`"Reset" ends 11:10 Tue, Oct 13 but must end by "${panel.title}" start 11:00 — 10 min short`]);
    await expect(commitCascade(event.id, { rebase: true }, blocked.moved)).rejects.toBeInstanceOf(CascadeBlocked);
    expect(await version(event.id)).toBe(1);

    const fix = { rebase: true, edits: [{ cueId: reset.id, durationMin: 10 }] };
    const fixed = await previewCascade(event.id, fix);
    expect(fixed.problems).toEqual([]);
    await commitCascade(event.id, fix, fixed.moved);
    expect(await version(event.id)).toBe(2);
    expect((await loadRunSheet(event.id)).rows.find((r) => r.id === reset.id)).toMatchObject({ startMin: 650, endMin: 660, slack: 0 });
  });

  it('refuses to commit a cascade other than the one previewed', async () => {
    const { event, moveKeynote } = await show();
    await moveKeynote(15);
    const preview = await previewCascade(event.id, { rebase: true });
    await moveKeynote(5); // someone publishes in between

    await expect(commitCascade(event.id, { rebase: true }, preview.moved)).rejects.toBeInstanceOf(CascadeChanged);
    expect(await version(event.id)).toBe(1);
  });

  it('a room move is a move: the preview shows it, a commit to another event\'s room is refused', async () => {
    const { event, doors } = await show();
    const lobby = await prisma.room.create({ data: { eventId: event.id, name: 'Lobby' } });
    const change = { edits: [{ cueId: doors.id, roomId: lobby.id }] };
    const preview = await previewCascade(event.id, change);
    expect(preview.moved).toEqual([{ id: doors.id, from: { day: D1, startMin: 510, endMin: 510, room: 'Ballroom A' }, to: { day: D1, startMin: 510, endMin: 510, room: 'Lobby' } }]);
    await commitCascade(event.id, change, preview.moved);
    expect((await loadRunSheet(event.id)).rows.find((r) => r.id === doors.id)?.room).toBe('Lobby');

    const other = await makeEvent();
    const elsewhere = await prisma.room.create({ data: { eventId: other.id, name: 'Elsewhere' } });
    await expect(previewCascade(event.id, { edits: [{ cueId: doors.id, roomId: elsewhere.id }] })).rejects.toThrow('No room');
  });

  it('a refusal in the commit\'s own writes undoes the cascade', async () => {
    const { event, doors } = await show();
    const change = { edits: [{ cueId: doors.id, offsetMin: -45 }] };
    const preview = await previewCascade(event.id, change);
    await expect(commitCascade(event.id, change, preview.moved, async () => { throw new Error('refused downstream'); })).rejects.toThrow('refused downstream');
    expect((await prisma.cue.findUniqueOrThrow({ where: { id: doors.id } })).offsetMin).toBe(-30);
  });

  it('an edit that closes a loop is named in preview and refused at commit', async () => {
    const { event, strike, reset } = await show();
    const change = { edits: [{ cueId: strike.id, anchorId: reset.id }] };
    const preview = await previewCascade(event.id, change);
    expect(preview.problems.map((p) => p.kind)).toEqual(['cycle']);
    await expect(commitCascade(event.id, change, preview.moved)).rejects.toBeInstanceOf(CascadeBlocked);
    expect((await prisma.cue.findUniqueOrThrow({ where: { id: strike.id } })).anchorId).not.toBe(reset.id);
  });

  it('refuses a cue anchored off the pinned agenda, in another event, or in another event\'s room', async () => {
    const { event, room, doors } = await show();
    const draftOnly = await makeSession(event.id, room.id, D1, 800, 860);
    await expect(addCue(event.id, room.id, spec('Walk-in', { anchorId: draftOnly.id, anchorEdge: 'start' }))).rejects.toBeInstanceOf(CascadeBlocked);
    expect(await prisma.cue.count()).toBe(3);

    const other = await makeEvent();
    const otherRoom = await prisma.room.create({ data: { eventId: other.id, name: 'Salon B' } });
    await expect(addCue(event.id, otherRoom.id, spec('Load-in', { day: D1, startMin: 360 }))).rejects.toThrow();
    await expect(previewCascade(other.id, { edits: [{ cueId: doors.id, offsetMin: -45 }] })).rejects.toThrow(/No cue/);
  });

  it('marking a published session a rehearsal drops it from the next snapshot; the rebase names the vanished anchor (D-013)', async () => {
    const { event, keynote } = await show();
    await prisma.session.update({ where: { id: keynote.id }, data: { isRehearsal: true } });
    await publishAgenda(event.id, clock);
    const preview = await previewCascade(event.id, { rebase: true });
    expect(preview.problems.map((p) => p.kind)).toEqual(['anchor_missing', 'anchor_missing']);
  });

  it('will not build a run sheet from an unpublished agenda', async () => {
    const event = await makeEvent();
    await expect(previewCascade(event.id, { rebase: true })).rejects.toThrow(/Publish the agenda/);
  });

  it('the database refuses a cue that is both fixed and anchored, or neither', async () => {
    const { event, room, doors } = await show();
    await expect(prisma.cue.update({ where: { id: doors.id }, data: { day: new Date('2026-10-13'), startMin: 500 } })).rejects.toThrow();
    await expect(prisma.cue.create({ data: { eventId: event.id, roomId: room.id, label: 'x', durationMin: 0 } })).rejects.toThrow();
  });
});
