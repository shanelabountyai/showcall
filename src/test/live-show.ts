import { publishAgenda } from '../agenda/publish';
import { fixedClock } from '../clock';
import { prisma } from '../db';
import { addCue, commitCascade, previewCascade, type Change } from '../runsheet/cascade';
import type { CueSpec } from '../runsheet/cues';
import { makeEvent, makeSession } from './harness';

/**
 * A small show for the live suites: one room, a keynote, a fixed "Stage call"
 * cue with two cues anchored to it, and an unrelated fixed "Lunch". Two roles
 * see different cues, so frames can be checked for leaks.
 */
export const D1 = '2026-10-13';
export const clock = fixedClock('2026-10-01T15:00:00Z');
const blank = { day: null, startMin: null, anchorId: null, anchorEdge: null, offsetMin: 0, endById: null, endByEdge: null, endByOffsetMin: 0 } as const;
const spec = (label: string, durationMin: number, s: Partial<CueSpec>): Omit<CueSpec, 'id'> => ({ ...blank, label, durationMin, ...s });

export async function smallShow() {
  const event = await makeEvent();
  const room = await prisma.room.create({ data: { eventId: event.id, name: 'Ballroom A' } });
  const keynote = await makeSession(event.id, room.id, D1, 540, 600);
  await publishAgenda(event.id, clock);
  const rebase = await previewCascade(event.id, { rebase: true });
  await commitCascade(event.id, { rebase: true }, rebase.moved);

  const stageCall = await addCue(event.id, room.id, spec('Stage call', 30, { day: D1, startMin: 480 }));
  const doors = await addCue(event.id, room.id, spec('Doors open', 20, { anchorId: stageCall.id, anchorEdge: 'start', offsetMin: 10 }));
  const walkIn = await addCue(event.id, room.id, spec('Walk-in music', 15, { anchorId: stageCall.id, anchorEdge: 'end' }));
  const lunch = await addCue(event.id, room.id, spec('Lunch service', 60, { day: D1, startMin: 720 }));
  const audio = await prisma.callRole.create({ data: { eventId: event.id, name: 'A1 Audio', reportTo: 'FOH mix position' } });
  const catering = await prisma.callRole.create({ data: { eventId: event.id, name: 'Catering', reportTo: 'Service corridor C' } });
  await prisma.cueRole.createMany({ data: [{ roleId: audio.id, cueId: walkIn.id }, { roleId: catering.id, cueId: lunch.id }] });
  return { event, room, keynote, cues: { stageCall, doors, walkIn, lunch }, roles: { audio, catering } };
}

export const seqOf = async (eventId: string) => (await prisma.event.findUniqueOrThrow({ where: { id: eventId }, select: { changeSeq: true } })).changeSeq;
export const logOf = (eventId: string) => prisma.showChange.findMany({ where: { eventId }, orderBy: { seq: 'asc' } });

/** Preview then commit: what the row editor does. */
export async function commit(eventId: string, change: Change) {
  const preview = await previewCascade(eventId, change);
  return commitCascade(eventId, change, preview.moved);
}

/** Resolves once Postgres shows a backend waiting on a lock: the second writer is queued behind the first. */
export async function untilSomeoneWaits() {
  for (let i = 0; i < 200; i++) {
    const [row] = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()`;
    if (row && row.n > 0n) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('No backend ever waited on a lock');
}

/** A promise with its resolve handle, for holding a transaction open. */
export function gate() {
  let open!: () => void;
  const done = new Promise<void>((r) => { open = r; });
  return { open, done };
}
