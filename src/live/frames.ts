import { createHash } from 'node:crypto';
import { callSheetStatus } from '../callsheet/callsheet';
import { resolveCrewPortal } from '../callsheet/portal';
import type { Clock } from '../clock';
import { prisma, type Tx } from '../db';
import { hashToken } from '../portal';
import { cueRows, loadRunSheet } from '../runsheet/cascade';
import { liveShow } from './live';
import type { Frame, Missed } from './stream';

/**
 * Frame builders (D-038, D-040, D-042). Each subscriber kind has one
 * projection, chosen by the endpoint and never by a client parameter, and
 * each frame reads its seq and that projection in one REPEATABLE READ
 * transaction, so the seq names exactly the state the frame shows.
 *
 * - `runsheet`: the producer view. The run sheet, its cue rows with their
 *   revisions (the row editor), call-sheet status, and each deliverable's
 *   latest version and show-file pointer. Carries the missed log on resume.
 * - `live`: stage-manager live mode, `liveShow` as of the clock. Missed log too.
 * - `crew`: the role's own issued sheet, `resolveCrewPortal`. Never the live
 *   projection, never the log.
 *
 * Nothing here writes. In particular nothing here writes ShowFileLock (D-042);
 * a test greps this directory for it.
 */
export type FrameKind = 'runsheet' | 'live' | 'crew';

/** Show-file state per deliverable, read when the frame is built (D-042): the pointer only ever moves by approve or override. */
export async function contentState(eventId: string, db: Tx = prisma) {
  const ds = await db.deliverable.findMany({
    where: { eventId }, orderBy: [{ label: 'asc' }, { id: 'asc' }],
    select: {
      id: true, label: true, kind: true,
      speaker: { select: { name: true } }, sponsor: { select: { name: true } },
      versions: { orderBy: { number: 'desc' }, take: 1, select: { number: true } },
      locks: { orderBy: { number: 'desc' }, take: 1, select: { version: { select: { number: true } } } },
    },
  });
  return ds.map((d) => ({
    id: d.id, label: d.label, kind: d.kind, owner: d.speaker?.name ?? d.sponsor?.name ?? '',
    latest: d.versions[0]?.number ?? 0, showFile: d.locks[0]?.version.number ?? null,
  }));
}

export async function producerProjection(eventId: string, db: Tx) {
  return {
    sheet: await loadRunSheet(eventId, db),
    cues: await cueRows(eventId, db),
    callSheets: await callSheetStatus(eventId, db),
    content: await contentState(eventId, db),
  };
}
export type ProducerData = Awaited<ReturnType<typeof producerProjection>>;
export type LiveData = Awaited<ReturnType<typeof liveShow>>;
export type CrewData = NonNullable<Awaited<ReturnType<typeof resolveCrewPortal>>>;

/** Dates become ISO strings, exactly as the wire carries them, so a server-rendered first frame and a streamed one are the same shape. */
export const wire = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** The show's committed seq: the poll. One short query; returns its connection (D-043). */
export async function eventSeq(eventId: string) {
  const e = await prisma.event.findUnique({ where: { id: eventId }, select: { changeSeq: true } });
  return e?.changeSeq ?? null;
}

export const crewHash = (data: unknown) => createHash('sha256').update(JSON.stringify(data)).digest('hex');

type Hooks = { afterSeqRead?: () => Promise<void> };

/**
 * One frame for one subscriber, from one snapshot. `since`: the seq the client
 * held on resume; producer frames then carry the log entries after it.
 * `hooks.afterSeqRead` runs between the seq read and the projection read, and
 * only under LIVE_TEST_HOOKS=1: it lets a test commit a write in that gap.
 */
export async function buildFrame(kind: FrameKind, key: string, opts: { clock: Clock; since: number | null; hooks?: Hooks }): Promise<Frame | null> {
  const hooks = process.env.LIVE_TEST_HOOKS === '1' ? opts.hooks : undefined;
  return prisma.$transaction(async (tx) => {
    let eventId = key;
    if (kind === 'crew') {
      const role = await tx.callRole.findUnique({ where: { portalTokenHash: hashToken(key) }, select: { eventId: true } });
      if (!role) return null;
      eventId = role.eventId;
    }
    const event = await tx.event.findUnique({ where: { id: eventId }, select: { changeSeq: true } });
    if (!event) return null;
    const seq = event.changeSeq;
    await hooks?.afterSeqRead?.();

    let data: unknown;
    if (kind === 'runsheet') data = await producerProjection(eventId, tx);
    else if (kind === 'live') data = await liveShow(eventId, opts.clock, tx);
    else {
      const portal = (await resolveCrewPortal(key, opts.clock, tx)) && await loadRunSheet(eventId, tx); // RED ON PURPOSE (L1.9d): the producer sheet in place of the issued sheet
      if (!portal) return null;
      data = portal;
    }

    let missed: Missed[] | undefined;
    if (kind !== 'crew' && opts.since !== null && opts.since < seq) {
      const rows = await tx.showChange.findMany({ where: { eventId, seq: { gt: opts.since, lte: seq } }, orderBy: { seq: 'asc' } });
      missed = rows.map((r) => ({ seq: r.seq, kinds: r.kinds, actor: r.actor, at: r.at.toISOString() }));
    }
    return wire({ seq, data, ...(missed && { missed }) });
  }, { isolationLevel: 'RepeatableRead', timeout: 15_000 });
}
