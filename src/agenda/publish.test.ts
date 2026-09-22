import { beforeEach, describe, expect, it } from 'vitest';
import { fixedClock } from '../clock';
import { prisma } from '../db';
import { makeEvent, makeSession, resetDb } from '../test/harness';
import { currentAgendaVersion, publishAgenda, PublishBlocked, type PublicSession } from './publish';

const D1 = '2026-10-13';
const clock = fixedClock('2026-10-01T15:00:00Z');

beforeEach(resetDb);

async function setup() {
  const event = await makeEvent();
  const room = await prisma.room.create({ data: { eventId: event.id, name: 'Ballroom A', strikeMinutes: 10, resetMinutes: 5 } });
  const speaker = await prisma.speaker.create({ data: { eventId: event.id, name: 'Dana Reyes' } });
  return { event, room, speaker };
}

describe('publishAgenda', () => {
  it('publishes a clean grid as version 1, then 2, snapshotting the public projection only', async () => {
    const { event, room, speaker } = await setup();
    await makeSession(event.id, room.id, D1, 540, 600, [speaker.id]);
    expect(await currentAgendaVersion(event.id)).toBe(0);

    const v1 = await publishAgenda(event.id, clock);
    expect(v1.number).toBe(1);
    expect(v1.publishedAt.toISOString()).toBe('2026-10-01T15:00:00.000Z');
    const [only] = v1.snapshot as PublicSession[];
    expect(Object.keys(only!).sort()).toEqual(['day', 'endMin', 'id', 'room', 'speakers', 'startMin', 'title']);
    expect(only).toMatchObject({ day: D1, room: 'Ballroom A', speakers: ['Dana Reyes'] });

    expect((await publishAgenda(event.id, clock)).number).toBe(2);
    expect(await currentAgendaVersion(event.id)).toBe(2);
  });

  it('blocks publish with every conflict named, and writes nothing', async () => {
    const { event, room, speaker } = await setup();
    await makeSession(event.id, room.id, D1, 540, 600, [speaker.id]);
    await makeSession(event.id, room.id, D1, 605, 660);

    const err = await publishAgenda(event.id, clock).catch((e) => e);
    expect(err).toBeInstanceOf(PublishBlocked);
    expect(err.conflicts.map((c: { kind: string }) => c.kind)).toEqual(['turnover_short']);
    expect(err.message).toMatch(/Ballroom A needs 15 min turnover/);
    expect(await prisma.agendaVersion.count()).toBe(0);
  });

  it('never rewrites or removes a published version', async () => {
    const { event, room } = await setup();
    await makeSession(event.id, room.id, D1, 540, 600);
    const v1 = await publishAgenda(event.id, clock);
    await expect(prisma.agendaVersion.update({ where: { id: v1.id }, data: { snapshot: [] } })).rejects.toThrow(/append-only/);
    await expect(prisma.agendaVersion.delete({ where: { id: v1.id } })).rejects.toThrow(/append-only/);
  });

  it('excludes rehearsals from the public snapshot, but a rehearsal conflict still blocks publish', async () => {
    const { event, room, speaker } = await setup();
    await makeSession(event.id, room.id, D1, 540, 600, [speaker.id]);
    await makeSession(event.id, room.id, D1, 480, 520, [speaker.id], true); // clear of the 15 min turnover
    const v1 = await publishAgenda(event.id, clock);
    expect((v1.snapshot as PublicSession[])).toHaveLength(1);

    await makeSession(event.id, room.id, D1, 500, 518, [], true); // overlaps the rehearsal above only
    const err = await publishAgenda(event.id, clock).catch((e) => e);
    expect(err).toBeInstanceOf(PublishBlocked);
    expect(err.conflicts).toHaveLength(1);
  });

  it('refuses an out-of-range session at the database', async () => {
    const { event, room } = await setup();
    await expect(makeSession(event.id, room.id, D1, 600, 600)).rejects.toThrow();
    await expect(makeSession(event.id, room.id, D1, 1400, 1500)).rejects.toThrow();
  });
});
