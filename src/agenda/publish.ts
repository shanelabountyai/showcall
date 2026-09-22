import type { Clock } from '../clock';
import { prisma } from '../db';
import { fromDbDate, type LocalDate } from '../time';
import { detectConflicts, type Conflict, type GridSession } from './conflicts';

/** A grid with conflicts. Nothing was published; `conflicts` says why. */
export class PublishBlocked extends Error {
  constructor(readonly conflicts: Conflict[]) {
    super(`Agenda has ${conflicts.length} conflict(s):\n${conflicts.map((c) => c.message).join('\n')}`);
  }
}

/**
 * What the public agenda may show. An explicit projection, so a field added
 * to Session (AV notes, speaker phone numbers) stays private until added here.
 * `id` is an opaque key so run-sheet cues can anchor to a session as published;
 * `speakerIds` (same order as `speakers`) are opaque too, so distribution
 * packages follow the speakers as published, not the draft (D-016).
 */
export type PublicSession = { id: string; title: string; day: LocalDate; room: string; startMin: number; endMin: number; speakers: string[]; speakerIds: string[] };

/** A grid row, with the flag conflicts.ts does not need but publishAgenda does. */
export type GridSessionRow = GridSession & { isRehearsal: boolean };

/** The event's draft grid, in the shape the conflict engine reads. Rehearsals are included — same conflict engine (D-013) — and carry `isRehearsal` for publishAgenda to filter on. */
export async function loadGrid(eventId: string) {
  const [rooms, rows] = await Promise.all([
    prisma.room.findMany({ where: { eventId } }),
    prisma.session.findMany({
      where: { eventId },
      include: { speakers: { include: { speaker: true } } },
      orderBy: [{ day: 'asc' }, { startMin: 'asc' }, { title: 'asc' }],
    }),
  ]);
  const sessions: GridSessionRow[] = rows.map((s) => ({
    id: s.id, title: s.title, day: fromDbDate(s.day), roomId: s.roomId, startMin: s.startMin, endMin: s.endMin,
    isRehearsal: s.isRehearsal,
    speakers: s.speakers.map(({ speaker }) => ({ id: speaker.id, name: speaker.name })),
  }));
  return { rooms, sessions };
}

/**
 * Publish the draft grid as the next agenda version. Refused, with every
 * conflict named, unless the grid is clean. Two concurrent publishes collide
 * on (eventId, number); one fails and nothing half-lands.
 */
export async function publishAgenda(eventId: string, clock: Clock) {
  const { rooms, sessions } = await loadGrid(eventId);
  const conflicts = detectConflicts(sessions, rooms);
  if (conflicts.length) throw new PublishBlocked(conflicts);

  const roomName = new Map(rooms.map((r) => [r.id, r.name]));
  const snapshot: PublicSession[] = sessions.filter((s) => !s.isRehearsal).map((s) => {
    const speakers = [...s.speakers].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    return {
      id: s.id, title: s.title, day: s.day, room: roomName.get(s.roomId)!, startMin: s.startMin, endMin: s.endMin,
      speakers: speakers.map((p) => p.name), speakerIds: speakers.map((p) => p.id),
    };
  });
  const last = await prisma.agendaVersion.findFirst({ where: { eventId }, orderBy: { number: 'desc' }, select: { number: true } });
  return prisma.agendaVersion.create({
    data: { eventId, number: (last?.number ?? 0) + 1, snapshot, publishedAt: clock.now() },
  });
}

/** The newest published version number, or 0. A derived artifact built from less is stale. */
export async function currentAgendaVersion(eventId: string) {
  const last = await prisma.agendaVersion.findFirst({ where: { eventId }, orderBy: { number: 'desc' }, select: { number: true } });
  return last?.number ?? 0;
}
