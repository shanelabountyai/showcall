import type { Clock } from '../clock';
import { prisma } from '../db';
import { loadRunSheet, type RunSheetRow } from '../runsheet/cascade';
import { localNow, toDbDate } from '../time';

/**
 * Stage-manager live mode. The SM calls GO on a row; each GO is an append-only
 * LiveMark stamped from the clock. Nothing here writes a cue: the running
 * offset is live state derived from the marks and the clock, and projected
 * times are planned + offset. The run sheet itself never moves.
 *
 * Per room, today only:
 * - current = the row of the latest GO; next = the row after it in time order.
 * - offset  = latest GO's actual − planned start (negative is early), raised to
 *   now − next's planned start once next is overdue: a cue that has not gone
 *   yet is at least that late.
 */
export type Mark = { rowId: string; plannedMin: number; actualMin: number };
export type LiveRow = RunSheetRow & { projectedMin: number; state: 'done' | 'current' | 'next' | 'upcoming' };
export type LiveRoom = { room: string; offsetMin: number; current: LiveRow | null; next: LiveRow | null; rows: LiveRow[] };

/** `rows` are one day's, in time order; `marks` are that day's, oldest first. */
export function projectLive(rows: RunSheetRow[], marks: (Mark & { room: string })[], nowMin: number): LiveRoom[] {
  const rooms = [...new Set(rows.map((r) => r.room))];
  return rooms.map((room) => {
    const own = rows.filter((r) => r.room === room);
    const mark = marks.filter((m) => m.room === room).at(-1);
    const currentIdx = mark ? own.findIndex((r) => r.id === mark.rowId) : -1;
    // A GO'd row that a rebase has since removed: resume after its planned time.
    let nextIdx = currentIdx >= 0 ? currentIdx + 1 : mark ? own.findIndex((r) => r.startMin > mark.plannedMin) : 0;
    if (nextIdx < 0) nextIdx = own.length;

    let offsetMin = mark ? mark.actualMin - mark.plannedMin : 0;
    const next = own[nextIdx];
    if (next && nowMin > next.startMin + offsetMin) offsetMin = nowMin - next.startMin;

    const live = own.map((r, i): LiveRow => ({
      ...r,
      projectedMin: i === currentIdx ? mark!.actualMin : i >= nextIdx ? r.startMin + offsetMin : r.startMin,
      state: i === currentIdx ? 'current' : i === nextIdx ? 'next' : i < nextIdx ? 'done' : 'upcoming',
    }));
    return { room, offsetMin, current: live[currentIdx] ?? null, next: live[nextIdx] ?? null, rows: live };
  });
}

async function today(eventId: string, clock: Clock) {
  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId }, include: { rooms: true } });
  const now = localNow(clock.now(), event.timezone);
  const sheet = await loadRunSheet(eventId);
  return { event, now, sheet, rows: sheet.rows.filter((r) => r.day === now.day) };
}

/** Everything the live view shows, as of the clock. Polled; reads only. */
export async function liveShow(eventId: string, clock: Clock) {
  const { event, now, sheet, rows } = await today(eventId, clock);
  const marks = await prisma.liveMark.findMany({
    where: { eventId, day: toDbDate(now.day) },
    orderBy: [{ markedAt: 'asc' }, { id: 'asc' }],
    include: { room: { select: { name: true } } },
  });
  const rooms = projectLive(rows, marks.map((m) => ({ ...m, room: m.room.name })), now.min);
  return { eventName: event.name, day: now.day, nowMin: now.min, stale: sheet.stale, rooms };
}

/** GO on a row of today's run sheet, at the clock's minute. Refused for any other row. */
export async function markGo(eventId: string, rowId: string, clock: Clock) {
  const { event, now, rows } = await today(eventId, clock);
  const row = rows.find((r) => r.id === rowId);
  if (!row) throw new Error(`No row ${rowId} on today's run sheet`);
  const room = event.rooms.find((r) => r.name === row.room)!;
  return prisma.liveMark.create({
    data: { eventId, roomId: room.id, rowId, day: toDbDate(now.day), plannedMin: row.startMin, actualMin: now.min, markedAt: clock.now() },
  });
}
