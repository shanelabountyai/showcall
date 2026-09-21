import { isDeepStrictEqual } from 'node:util';
import type { PublicSession } from '../agenda/publish';
import { prisma, type Tx } from '../db';
import { fromDbDate, toDbDate } from '../time';
import { diffTimings, resolveCues, type CueSpec, type Moved, type Problem } from './cues';

/**
 * The run sheet on disk: cue specs plus the agenda version they resolve
 * against (Event.runSheetVersion, D-003). Every change — cue edits, a rebase
 * onto the newest agenda, or both at once — runs through `applyChange`, so a
 * preview is exactly the commit with the transaction rolled back.
 *
 * Invariant: the stored graph resolves without problems against its pinned
 * version. A change that leaves any problem is refused whole, so fixing a
 * compression and the rebase that caused it land together or not at all.
 */
export type CueEdit = { cueId: string } & Partial<Omit<CueSpec, 'id'>>;
export type Change = { rebase?: boolean; edits?: CueEdit[] };
export type CascadeResult = { agendaVersion: number; moved: Moved[]; problems: Problem[] };

/** The change leaves problems; nothing was written. */
export class CascadeBlocked extends Error {
  constructor(readonly problems: Problem[]) {
    super(`Run sheet has ${problems.length} problem(s):\n${problems.map((p) => p.message).join('\n')}`);
  }
}

/** The cascade no longer matches the preview (someone else changed the sheet or published). Preview again. */
export class CascadeChanged extends Error {
  constructor(readonly result: CascadeResult) { super('The run sheet changed since the preview; preview again'); }
}

class Rollback extends Error { constructor(readonly result: CascadeResult) { super('preview'); } }

async function sessionsAt(tx: Tx, eventId: string, number: number) {
  if (number === 0) return [];
  const v = await tx.agendaVersion.findUniqueOrThrow({ where: { eventId_number: { eventId, number } } });
  return v.snapshot as PublicSession[];
}

type CueRow = Awaited<ReturnType<Tx['cue']['findMany']>>[number];
const toSpec = ({ eventId: _, roomId: __, day, ...c }: CueRow): CueSpec => ({ ...c, day: day && fromDbDate(day) });
const cuesOf = (tx: Tx, eventId: string) => tx.cue.findMany({ where: { eventId }, orderBy: { id: 'asc' } });

async function resolveAt(tx: Tx, eventId: string, version: number) {
  return resolveCues(await sessionsAt(tx, eventId, version), (await cuesOf(tx, eventId)).map(toSpec));
}

async function lockEvent(tx: Tx, eventId: string) {
  const [row] = await tx.$queryRaw<{ runSheetVersion: number }[]>`SELECT "runSheetVersion" FROM "Event" WHERE id = ${eventId} FOR UPDATE`;
  if (!row) throw new Error(`No event ${eventId}`);
  return row.runSheetVersion;
}

const dbDay = (day: string | null) => (day === null ? null : toDbDate(day));
const cueData = ({ day, ...rest }: Partial<Omit<CueSpec, 'id'>>) => ({ ...rest, ...(day !== undefined && { day: dbDay(day) }) });

async function applyChange(eventId: string, change: Change, expected?: Moved[]): Promise<CascadeResult> {
  try {
    return await prisma.$transaction(async (tx) => {
      const pinned = await lockEvent(tx, eventId);
      const before = await resolveAt(tx, eventId, pinned);

      let version = pinned;
      if (change.rebase) {
        const last = await tx.agendaVersion.findFirst({ where: { eventId }, orderBy: { number: 'desc' }, select: { number: true } });
        if (!last) throw new Error('Publish the agenda before building a run sheet from it');
        version = last.number;
        await tx.event.update({ where: { id: eventId }, data: { runSheetVersion: version } });
      }
      for (const { cueId, ...patch } of change.edits ?? []) {
        const { count } = await tx.cue.updateMany({ where: { id: cueId, eventId }, data: cueData(patch) });
        if (count !== 1) throw new Error(`No cue ${cueId} in event ${eventId}`);
      }

      const after = await resolveAt(tx, eventId, version);
      const result = { agendaVersion: version, moved: diffTimings(before.timings, after.timings), problems: after.problems };
      if (!expected) throw new Rollback(result);
      if (result.problems.length) throw new CascadeBlocked(result.problems);
      if (!isDeepStrictEqual(result.moved, expected)) throw new CascadeChanged(result);
      return result;
    });
  } catch (e) {
    if (e instanceof Rollback) return e.result;
    throw e;
  }
}

/** What `change` would move and break. Writes nothing. */
export const previewCascade = (eventId: string, change: Change) => applyChange(eventId, change);

/**
 * Apply `change` atomically. `expected` is the preview's `moved`: the commit
 * refuses unless it moves exactly that, so what lands is what was shown.
 */
export const commitCascade = (eventId: string, change: Change, expected: Moved[]) => applyChange(eventId, change, expected);

/** Add a production cue. Refused, and not written, if the sheet then has any problem. */
export async function addCue(eventId: string, roomId: string, spec: Omit<CueSpec, 'id'>) {
  return prisma.$transaction(async (tx) => {
    const pinned = await lockEvent(tx, eventId);
    await tx.room.findFirstOrThrow({ where: { id: roomId, eventId } });
    const cue = await tx.cue.create({ data: { eventId, roomId, ...spec, day: dbDay(spec.day) } });
    const { problems } = await resolveAt(tx, eventId, pinned);
    if (problems.length) throw new CascadeBlocked(problems);
    return cue;
  });
}

export type RunSheetRow = { id: string; kind: 'session' | 'cue'; label: string; room: string; day: string; startMin: number; endMin: number; slack?: number };

/**
 * The run sheet as built: sessions from the pinned agenda version plus cues,
 * in time order. `stale` when the agenda has published past it.
 */
export async function loadRunSheet(eventId: string) {
  return prisma.$transaction(async (tx) => {
    const event = await tx.event.findUniqueOrThrow({ where: { id: eventId }, include: { rooms: true } });
    const [sessions, cues, last] = await Promise.all([
      sessionsAt(tx, eventId, event.runSheetVersion),
      cuesOf(tx, eventId),
      tx.agendaVersion.findFirst({ where: { eventId }, orderBy: { number: 'desc' }, select: { number: true } }),
    ]);
    const { timings, problems } = resolveCues(sessions, cues.map(toSpec));
    const roomName = new Map(event.rooms.map((r) => [r.id, r.name]));
    const rows: RunSheetRow[] = [
      ...sessions.map((s) => ({ id: s.id, kind: 'session' as const, label: s.title, room: s.room })),
      ...cues.map((c) => ({ id: c.id, kind: 'cue' as const, label: c.label, room: roomName.get(c.roomId)! })),
    ].flatMap((r) => { const t = timings.get(r.id); return t ? [{ ...r, ...t }] : []; });
    rows.sort((a, b) => a.day.localeCompare(b.day) || a.startMin - b.startMin || a.endMin - b.endMin);
    const currentVersion = last?.number ?? 0;
    return { agendaVersion: event.runSheetVersion, currentVersion, stale: event.runSheetVersion < currentVersion, rows, problems };
  });
}
