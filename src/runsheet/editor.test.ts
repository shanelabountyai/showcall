import { beforeEach, describe, expect, it } from 'vitest';
import { fixedClock } from '../clock';
import { prisma } from '../db';
import { makeStaff, resetDb } from '../test/harness';
import { D1, logOf, seqOf, smallShow } from '../test/live-show';
import { toDbDate } from '../time';
import { commitRowEdit, EditRefused, editors, previewRowEdit } from './editor';

beforeEach(resetDb);

const showDay = fixedClock('2026-10-13T15:00:00Z'); // 10:00 in Chicago, day 1
const preShow = fixedClock('2026-10-01T15:00:00Z');

async function crew(eventId: string, roomId: string) {
  const assign = async (role: 'producer' | 'stage_manager' | 'crew', day: string) => {
    const s = await makeStaff();
    await prisma.assignment.create({ data: { staffId: s.id, eventId, roomId: role === 'stage_manager' ? roomId : null, day: toDbDate(day), startMin: 420, endMin: 1080, role } });
    return s;
  };
  return {
    producer: await assign('producer', D1),
    sm: await assign('stage_manager', D1),
    hand: await assign('crew', D1),
    tomorrow: await assign('producer', '2026-10-14'),
    stranger: await makeStaff(),
  };
}

/** L1.4 (D-044, O-6): "Editing as" is re-checked on the server and lands on the change log. */
describe('editing as', () => {
  it('an edit with no one picked is refused, named, and writes nothing', async () => {
    const { event, cues } = await smallShow();
    const seq = await seqOf(event.id);
    const edit = { cueId: cues.lunch.id, rev: 0, startMin: 725 };
    await expect(previewRowEdit(event.id, '', edit, showDay)).rejects.toThrow(new EditRefused('Pick who you are editing as before you preview or commit'));
    await expect(commitRowEdit(event.id, '', edit, [], showDay)).rejects.toThrow(EditRefused);
    expect(await seqOf(event.id)).toBe(seq);
  });

  it('a staffer with no producer or stage-manager assignment today is refused', async () => {
    const { event, room, cues } = await smallShow();
    const { hand, stranger, tomorrow } = await crew(event.id, room.id);
    const edit = { cueId: cues.lunch.id, rev: 0, startMin: 725 };
    for (const s of [hand, stranger, tomorrow]) {
      await expect(previewRowEdit(event.id, s.id, edit, showDay)).rejects.toThrow(/Only a producer or stage manager assigned to this event today/);
    }
  });

  it('on show day the producer and the stage manager may edit; before the show anyone assigned to it may', async () => {
    const { event, room } = await smallShow();
    const c = await crew(event.id, room.id);
    expect((await editors(event.id, showDay)).map((e) => e.staffId).sort()).toEqual([c.producer.id, c.sm.id].sort());
    expect((await editors(event.id, preShow)).map((e) => e.staffId).sort()).toEqual([c.producer.id, c.sm.id, c.tomorrow.id].sort());
  });

  it('a committed edit names its actor on the change log', async () => {
    const { event, room, cues } = await smallShow();
    const { producer } = await crew(event.id, room.id);
    const edit = { cueId: cues.lunch.id, rev: 0, startMin: 725 };
    const preview = await previewRowEdit(event.id, producer.id, edit, showDay);
    await commitRowEdit(event.id, producer.id, edit, preview.moved, showDay);
    expect((await logOf(event.id)).at(-1)).toMatchObject({ actor: producer.name, kinds: ['cue', `cue:${cues.lunch.id}`] });
  });
});
