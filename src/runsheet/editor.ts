import type { Clock } from '../clock';
import { prisma } from '../db';
import { fromDbDate, localNow, toDbDate } from '../time';
import { commitCascade, previewCascade, type CueEdit } from './cascade';
import type { Moved } from './cues';

/**
 * The run-sheet row editor's server side (D-044, D-045, O-6). "Editing as"
 * names who made a change on the log; it is attribution, not identity: anyone
 * with the demo password can pick any listed name (SEC-01). The pick is
 * re-checked here on every preview and commit, as markGo re-checks GO (D-011).
 */
export class EditRefused extends Error {}

/**
 * Who may edit today: staff with a producer or stage-manager assignment on
 * this event today, or on any day of it while the show has not started.
 */
export async function editors(eventId: string, clock: Clock) {
  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId }, select: { timezone: true, startDate: true } });
  const today = localNow(clock.now(), event.timezone).day;
  const preShow = today < fromDbDate(event.startDate);
  const rows = await prisma.assignment.findMany({
    where: { eventId, role: { in: ['producer', 'stage_manager'] }, ...(!preShow && { day: toDbDate(today) }) },
    orderBy: [{ role: 'asc' }, { staff: { name: 'asc' } }],
    select: { role: true, staff: { select: { id: true, name: true } } },
  });
  const seen = new Set<string>();
  return rows.flatMap((r) => (seen.has(r.staff.id) ? [] : (seen.add(r.staff.id), [{ staffId: r.staff.id, name: r.staff.name, role: r.role }])));
}

/** The actor's name for the change log, or refused with the reason. */
export async function editAs(eventId: string, staffId: string, clock: Clock) {
  if (!staffId) throw new EditRefused('Pick who you are editing as before you preview or commit');
  const who = (await editors(eventId, clock)).find((e) => e.staffId === staffId);
  if (!who) throw new EditRefused('Only a producer or stage manager assigned to this event today can edit the run sheet');
  return who.name;
}

/** What one row edit would move. Writes nothing. A stale `rev` is refused with RowChanged. */
export async function previewRowEdit(eventId: string, staffId: string, edit: CueEdit, clock: Clock) {
  const actor = await editAs(eventId, staffId, clock);
  return previewCascade(eventId, { edits: [edit], actor });
}

/** Land one row edit as previewed (`expected`), naming the actor on the change log. */
export async function commitRowEdit(eventId: string, staffId: string, edit: CueEdit, expected: Moved[], clock: Clock) {
  const actor = await editAs(eventId, staffId, clock);
  return commitCascade(eventId, { edits: [edit], actor }, expected);
}
