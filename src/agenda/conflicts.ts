import { hhmm, shortDay, type LocalDate } from '../time';

/**
 * The agenda conflict engine (P0-1). Pure: the grid in, every conflict out,
 * each one naming what collides so a blocked publish says why. Rehearsal
 * slots (P0-4) run through the same function — a rehearsal is a session that
 * is not on the public agenda.
 *
 * - room_double_booked:    two sessions overlap in one room.
 * - turnover_short:        the gap between two sessions in a room is less
 *                          than that room's strike + reset minutes.
 * - speaker_double_booked: one speaker's sessions overlap. Back-to-back in
 *                          different rooms is allowed; walking time is the
 *                          producer's call, not the engine's.
 *
 * Intervals are half-open: a session ending 10:00 and one starting 10:00 do
 * not overlap.
 */
export type GridRoom = { id: string; name: string; strikeMinutes: number; resetMinutes: number };
export type GridSession = {
  id: string; title: string; day: LocalDate; roomId: string;
  startMin: number; endMin: number; speakers: { id: string; name: string }[];
};
export type ConflictKind = 'room_double_booked' | 'turnover_short' | 'speaker_double_booked';
export type Conflict = { kind: ConflictKind; sessionIds: [string, string]; message: string };

const span = (s: GridSession) => `"${s.title}" ${hhmm(s.startMin)}–${hhmm(s.endMin)}`;
const byStart = (a: GridSession, b: GridSession) => a.startMin - b.startMin || a.endMin - b.endMin;

function groupBy<T>(items: T[], key: (t: T) => string): T[][] {
  const m = new Map<string, T[]>();
  for (const t of items) { const k = key(t); m.set(k, [...(m.get(k) ?? []), t]); }
  return [...m.values()];
}

export function detectConflicts(sessions: GridSession[], rooms: GridRoom[]): Conflict[] {
  const roomById = new Map(rooms.map((r) => [r.id, r]));
  for (const s of sessions) if (!roomById.has(s.roomId)) throw new Error(`Session ${s.id} is in unknown room ${s.roomId}`);
  const out: Conflict[] = [];

  for (const group of groupBy(sessions, (s) => `${s.day}|${s.roomId}`)) {
    const room = roomById.get(group[0]!.roomId)!;
    const turnover = room.strikeMinutes + room.resetMinutes;
    const sorted = [...group].sort(byStart);
    sorted.forEach((a, i) => {
      // Sorted by start, so once one starts clear of a's end + turnover, all later ones do.
      for (const b of sorted.slice(i + 1)) {
        if (b.startMin >= a.endMin + turnover) break;
        const ids: [string, string] = [a.id, b.id];
        if (b.startMin < a.endMin) {
          out.push({ kind: 'room_double_booked', sessionIds: ids, message: `${room.name} is double-booked ${shortDay(a.day)}: ${span(a)} overlaps ${span(b)}` });
        } else {
          out.push({ kind: 'turnover_short', sessionIds: ids, message: `${room.name} needs ${turnover} min turnover ${shortDay(a.day)} between ${span(a)} and ${span(b)}; has ${b.startMin - a.endMin}` });
        }
      }
    });
  }

  const bySpeaker = sessions.flatMap((s) => [...new Map(s.speakers.map((p) => [p.id, p])).values()].map((speaker) => ({ speaker, s })));
  for (const group of groupBy(bySpeaker, (x) => `${x.s.day}|${x.speaker.id}`)) {
    const sorted = group.map((x) => x.s).sort(byStart);
    const { name } = group[0]!.speaker;
    sorted.forEach((a, i) => {
      for (const b of sorted.slice(i + 1)) {
        if (b.startMin >= a.endMin) break;
        out.push({ kind: 'speaker_double_booked', sessionIds: [a.id, b.id], message: `${name} is in two places ${shortDay(a.day)}: ${span(a)} overlaps ${span(b)}` });
      }
    });
  }
  return out;
}
