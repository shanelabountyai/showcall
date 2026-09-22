import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../db';
import { makeEvent, resetDb } from '../test/harness';
import { deleteSession, GridEditRefused, saveSession } from './grid';
import { loadGrid } from './publish';

describe('draft grid editing', () => {
  beforeEach(resetDb);

  async function setup() {
    const [event, other] = await Promise.all([makeEvent(), makeEvent()]);
    const room = await prisma.room.create({ data: { eventId: event.id, name: 'Ballroom A' } });
    const speaker = await prisma.speaker.create({ data: { eventId: event.id, name: 'Dana Reyes' } });
    const foreignRoom = await prisma.room.create({ data: { eventId: other.id, name: 'Ballroom A' } });
    const foreignSpeaker = await prisma.speaker.create({ data: { eventId: other.id, name: 'Lee Park' } });
    const base = { title: 'Keynote', day: '2026-10-13', roomId: room.id, startMin: 540, endMin: 600, speakerIds: [speaker.id] };
    return { event, room, speaker, foreignRoom, foreignSpeaker, base };
  }

  it('creates, edits and replaces speakers on a session', async () => {
    const { event, speaker, base } = await setup();
    const s = await saveSession(event.id, base);
    await saveSession(event.id, { ...base, id: s.id, title: ' Opening keynote ', startMin: 555, endMin: 615, speakerIds: [] });
    const [row] = (await loadGrid(event.id)).sessions;
    expect(row).toMatchObject({ title: 'Opening keynote', startMin: 555, endMin: 615, speakers: [] });
    await saveSession(event.id, { ...base, id: s.id, speakerIds: [speaker.id, speaker.id] });
    expect((await loadGrid(event.id)).sessions[0]!.speakers).toEqual([{ id: speaker.id, name: 'Dana Reyes' }]);
  });

  it('allows a conflicting draft — publish is what refuses it', async () => {
    const { event, base } = await setup();
    await saveSession(event.id, base);
    await expect(saveSession(event.id, { ...base, title: 'Overlap' })).resolves.toBeTruthy();
  });

  it('refuses what cannot belong to the event, and writes nothing', async () => {
    const { event, foreignRoom, foreignSpeaker, base } = await setup();
    const refused = [
      { ...base, title: '  ' },
      { ...base, endMin: 540 },
      { ...base, day: '2026-10-15' },
      { ...base, roomId: foreignRoom.id },
      { ...base, speakerIds: [foreignSpeaker.id] },
      { ...base, isRehearsal: true, speakerIds: [] },
    ];
    for (const input of refused) await expect(saveSession(event.id, input)).rejects.toThrow(GridEditRefused);
    expect(await prisma.session.count()).toBe(0);
  });

  it('books a rehearsal, off the public agenda', async () => {
    const { event, base } = await setup();
    const rehearsal = await saveSession(event.id, { ...base, isRehearsal: true });
    expect((await loadGrid(event.id)).sessions.find((s) => s.id === rehearsal.id)).toMatchObject({ isRehearsal: true });
  });

  it('will not edit or delete another event’s session', async () => {
    const { event, foreignRoom, base } = await setup();
    const theirs = await saveSession(foreignRoom.eventId, { ...base, roomId: foreignRoom.id, speakerIds: [] });
    await expect(saveSession(event.id, { ...base, id: theirs.id })).rejects.toThrow(GridEditRefused);
    await expect(deleteSession(event.id, theirs.id)).rejects.toThrow(GridEditRefused);
    await deleteSession(foreignRoom.eventId, theirs.id);
    expect(await prisma.session.count()).toBe(0);
  });
});
