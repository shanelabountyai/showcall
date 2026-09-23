import { deckLocked, deckQuery, LIFECYCLE, missingItems, nextStepBlocked, type GuardCtx } from '../bureau/bureau';
import type { Clock } from '../clock';
import { prisma } from '../db';
import { packageStatus, type Scope } from '../content/distribution';
import type { DeliverableKind } from '../generated/prisma/enums';
import { addDays, daysUntil, fromDbDate, localNow, shortDay, type LocalDate } from '../time';

/**
 * The chase dashboard (P0-5). Nothing here is a new fact: a deadline is the
 * owner's first call minus the event's lead time for that kind, so moving a
 * session moves the deadline with it (D-003's rule, applied to turn-in). The
 * missing-item flags are the bureau guards' own messages, and the stale flags
 * are the package builder's own — this module only ranks them.
 *
 * The outbox is the only thing it writes: one row per deliverable per cadence
 * step, sent once (unique key), kept as sent (append-only trigger).
 */
export class ChaseRefused extends Error {}

/** Days before due at which a reminder goes out; negative is after. Each fires once. */
export const CADENCE = [14, 7, 3, 0, -3, -7] as const;

/** Inside this many days, a deliverable is on the worklist even though it is not late yet. */
const WARN_DAYS = 3;

/**
 * The most urgent cadence step reached at `daysLeft`, or null before the
 * first one. Steps that were skipped — a board opened for the first time a
 * week late — never fire retroactively; only the one that is current does.
 */
export function cadenceStep(daysLeft: number): number | null {
  const reached = CADENCE.filter((s) => daysLeft <= s);
  return reached.length ? Math.min(...reached) : null;
}

export type ChaseState = 'locked' | 'overdue' | 'due' | 'open' | 'no_policy';

export type ChaseRow = {
  deliverableId: string; kind: DeliverableKind; label: string;
  owner: string; ownerKind: 'speaker' | 'sponsor';
  /** The owner's first call: their earliest session, rehearsal included, or the event's first day. */
  callDay: LocalDate;
  leadDays: number | null;
  dueDay: LocalDate | null;
  daysLeft: number | null;
  latestVersion: number | null;
  latestOutcome: string | null;
  lockedVersion: number | null;
  state: ChaseState;
  /** The cadence step a reminder is owed for right now, or null if none is. */
  owed: number | null;
  lastSent: { step: number; sentAt: Date } | null;
};

const RANK: Record<ChaseState, number> = { overdue: 0, due: 1, open: 2, no_policy: 3, locked: 4 };

/** Every deliverable's deadline and turn-in state, worst first, plus the bureau funnel. */
export async function chaseBoard(eventId: string, clock: Clock) {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      deadlines: true,
      deliverables: {
        orderBy: { label: 'asc' },
        include: {
          speaker: { select: { name: true, sessions: { select: { session: { select: { day: true } } } } } },
          sponsor: { select: { name: true } },
          versions: { orderBy: { number: 'desc' }, take: 1, select: { number: true, runs: { orderBy: { at: 'desc' }, take: 1, select: { outcome: true } } } },
          locks: { orderBy: { number: 'desc' }, take: 1, select: { version: { select: { number: true } } } },
          // The most urgent step sent so far: anything less urgent was sent before it.
          reminders: { orderBy: { step: 'asc' }, take: 1, select: { step: true, sentAt: true } },
        },
      },
    },
  });
  if (!event) throw new ChaseRefused('No such event');

  const today = localNow(clock.now(), event.timezone).day;
  const eventStart = fromDbDate(event.startDate);
  const lead = new Map(event.deadlines.map((p) => [p.kind, p.leadDays]));

  const rows: ChaseRow[] = event.deliverables.map((d): ChaseRow => {
    // LocalDate is 'YYYY-MM-DD', so the lexical minimum is the earliest day.
    const days = (d.speaker?.sessions ?? []).map((s) => fromDbDate(s.session.day));
    const callDay = days.length ? days.reduce((a, b) => (a < b ? a : b)) : eventStart;
    const leadDays = lead.get(d.kind) ?? null;
    const dueDay = leadDays == null ? null : addDays(callDay, -leadDays);
    const daysLeft = dueDay == null ? null : daysUntil(today, dueDay);
    const lockedVersion = d.locks[0]?.version.number ?? null;
    const lastSent = d.reminders[0] ?? null;

    const state: ChaseState = lockedVersion != null ? 'locked'
      : daysLeft == null ? 'no_policy'
      : daysLeft < 0 ? 'overdue'
      : daysLeft <= WARN_DAYS ? 'due'
      : 'open';
    const step = state === 'locked' || daysLeft == null ? null : cadenceStep(daysLeft);
    // Outstanding only if nothing at least this urgent has gone out already.
    const owed = step != null && (!lastSent || lastSent.step > step) ? step : null;

    return {
      deliverableId: d.id, kind: d.kind, label: d.label,
      owner: d.speaker?.name ?? d.sponsor?.name ?? 'unassigned',
      ownerKind: d.speakerId ? 'speaker' : 'sponsor',
      callDay, leadDays, dueDay, daysLeft,
      latestVersion: d.versions[0]?.number ?? null,
      latestOutcome: d.versions[0]?.runs[0]?.outcome ?? null,
      lockedVersion, state, owed, lastSent,
    };
  }).sort((a, b) => RANK[a.state] - RANK[b.state] || (a.daysLeft ?? 0) - (b.daysLeft ?? 0) || a.owner.localeCompare(b.owner));

  const found = await prisma.speaker.findMany({
    where: { eventId }, orderBy: { name: 'asc' },
    include: { sessions: { select: { session: { select: { isRehearsal: true } } } }, deliverables: deckQuery },
  });
  const speakers = found.map((s) => {
    const ctx: GuardCtx = {
      honorariumCents: s.honorariumCents, contractSignedAt: s.contractSignedAt, bio: s.bio, consentRecordedAt: s.consentRecordedAt,
      hasRehearsal: s.sessions.some((x) => x.session.isRehearsal), hasSession: s.sessions.some((x) => !x.session.isRehearsal),
      deckLocked: deckLocked(s.deliverables),
    };
    return { id: s.id, name: s.name, state: s.state, missing: missingItems({ ...ctx, headshotUrl: s.headshotUrl }), blocked: nextStepBlocked(s.state, ctx) };
  });

  return {
    event, today, rows, speakers,
    funnel: LIFECYCLE.map((state) => ({ state, count: speakers.filter((s) => s.state === state).length })),
  };
}

/** What the reminder says — written into the outbox as sent, never re-rendered later. */
function body(row: ChaseRow, eventName: string): string {
  const left = row.daysLeft!;
  const when = left < 0 ? `was due ${shortDay(row.dueDay!)}, ${-left} day${-left === 1 ? '' : 's'} ago`
    : left === 0 ? `is due today, ${shortDay(row.dueDay!)}`
    : `is due ${shortDay(row.dueDay!)}, in ${left} day${left === 1 ? '' : 's'}`;
  return `${eventName}: your ${row.label} ${when}. Upload it from your portal link.`;
}

/**
 * Send every reminder the cadence owes right now. The outbox row is the send
 * — there is no mail seam yet, deliberately: what a producer needs to see is
 * that it went out and when, and a real transport swaps in behind this.
 */
export async function sendDueReminders(eventId: string, clock: Clock) {
  const board = await chaseBoard(eventId, clock);
  const due = board.rows.filter((r) => r.owed != null);
  if (!due.length) throw new ChaseRefused('Nothing is owed a reminder right now');
  const sentAt = clock.now();
  const { count } = await prisma.reminder.createMany({
    data: due.map((r) => ({ deliverableId: r.deliverableId, step: r.owed!, to: r.owner, body: body(r, board.event.name), sentAt })),
    skipDuplicates: true,
  });
  return count;
}

/** The outbox, most recent first. */
export function outbox(eventId: string, take = 50) {
  return prisma.reminder.findMany({
    where: { deliverable: { eventId } }, orderBy: { sentAt: 'desc' }, take,
    include: { deliverable: { select: { label: true } } },
  });
}

export async function setLeadDays(eventId: string, kind: DeliverableKind, leadDays: number) {
  if (!Number.isInteger(leadDays) || leadDays < 0) throw new ChaseRefused('A lead time is a whole number of days and cannot be negative');
  return prisma.deadlinePolicy.upsert({ where: { eventId_kind: { eventId, kind } }, create: { eventId, kind, leadDays }, update: { leadDays } });
}

/** Stale distribution packages, so the worklist carries them beside the missing items (D-016). */
export async function stalePackages(eventId: string) {
  const [rooms, published] = await Promise.all([
    prisma.room.findMany({ where: { eventId }, orderBy: { name: 'asc' } }),
    prisma.agendaVersion.count({ where: { eventId } }),
  ]);
  if (!published) return [];
  const scopes: { title: string; scope: Scope }[] = [
    ...rooms.map((r) => ({ title: `${r.name} — playback`, scope: { audience: 'room', roomId: r.id } as Scope })),
    { title: 'Attendees — post-show decks', scope: { audience: 'attendees' } as Scope },
  ];
  const all = await Promise.all(scopes.map(async (s) => ({ title: s.title, ...(await packageStatus(eventId, s.scope)) })));
  return all.filter((s) => s.stale).map((s) => ({ title: s.title, built: s.last?.number ?? null, added: s.added, removed: s.removed }));
}
