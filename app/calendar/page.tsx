import { prisma } from '@/src/db';
import { describeShift, loadShifts, MIN_REST_MIN, staffConflicts } from '@/src/staffing/portfolio';
import { fromDbDate, hhmm, shortDay } from '@/src/time';

export const dynamic = 'force-dynamic';

/** Every event by date, and the people who cross between them (P1-4, D-030). */
export default async function Calendar() {
  const [events, staff, shifts] = await Promise.all([
    prisma.event.findMany({ orderBy: { startDate: 'asc' }, include: { client: true } }),
    prisma.staff.findMany({ orderBy: { name: 'asc' } }),
    loadShifts(),
  ]);
  const conflicts = staffConflicts(shifts);
  const name = new Map(staff.map((s) => [s.id, s.name]));
  const crossing = staff.filter((p) => new Set(shifts.filter((s) => s.staffId === p.id).map((s) => s.eventId)).size > 1);

  return (
    <main>
      <h1>Portfolio calendar</h1>
      <table>
        <thead><tr><th>Dates</th><th>Event</th><th>Client</th><th>Timezone</th><th>Staffed</th></tr></thead>
        <tbody>
          {events.map((e) => (
            <tr key={e.id}>
              <td>{shortDay(fromDbDate(e.startDate))}–{shortDay(fromDbDate(e.endDate))}</td>
              <td><a href={`/events/${e.id}/staff`}>{e.name}</a></td>
              <td>{e.client.name}</td>
              <td>{e.timezone}</td>
              <td>{new Set(shifts.filter((s) => s.eventId === e.id).map((s) => s.staffId)).size}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Staff conflicts across events</h2>
      <p>Overlaps are checked in real time, each event in its own timezone. Moving between events with under {MIN_REST_MIN / 60}h rest is a warning.</p>
      {conflicts.length === 0 ? <p>None.</p> : (
        <ul aria-label="Staff conflicts">
          {conflicts.map((c) => (
            <li key={`${c.a.id}-${c.b.id}`} role={c.kind === 'overlap' ? 'alert' : undefined}>
              <strong>{name.get(c.staffId)}</strong>: {c.kind === 'overlap' ? `overlaps by ${hhmm(-c.restMin)}` : `${hhmm(c.restMin)} rest, ${MIN_REST_MIN / 60}h owed`} — {c.a.eventName} {describeShift(c.a)} → {c.b.eventName} {describeShift(c.b)}
            </li>
          ))}
        </ul>
      )}

      <h2>People on more than one event</h2>
      {crossing.length === 0 ? <p>None.</p> : crossing.map((p) => (
        <section key={p.id}>
          <h3>{p.name}</h3>
          <ul>{shifts.filter((s) => s.staffId === p.id).sort((x, y) => x.day.localeCompare(y.day) || x.startMin - y.startMin).map((s) => <li key={s.id}>{s.eventName} — {describeShift(s)}</li>)}</ul>
        </section>
      ))}
    </main>
  );
}
