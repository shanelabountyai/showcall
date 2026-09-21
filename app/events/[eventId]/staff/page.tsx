import { notFound } from 'next/navigation';
import { prisma } from '@/src/db';
import { DayRole } from '@/src/generated/prisma/enums';
import { assign, StaffingRefused } from '@/src/staffing/staffing';
import { daysBetween, fromDbDate, fromHhmm, hhmm, shortDay } from '@/src/time';
import { refusable } from '../refusable';

export const dynamic = 'force-dynamic';

const roleName = (r: DayRole) => r.replace('_', ' ');

/** Day-of roles for this event. Capacity and overlaps are the person's, across every event. */
export default async function Staffing({ params, searchParams }: { params: Promise<{ eventId: string }>; searchParams: Promise<{ error?: string }> }) {
  const { eventId } = await params;
  const { error } = await searchParams;
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      rooms: { orderBy: { name: 'asc' } },
      staffing: { include: { staff: true, room: true }, orderBy: [{ day: 'asc' }, { startMin: 'asc' }, { staff: { name: 'asc' } }] },
    },
  });
  if (!event) notFound();
  const staff = await prisma.staff.findMany({ orderBy: { name: 'asc' } });
  const days = daysBetween(fromDbDate(event.startDate), fromDbDate(event.endDate));
  const here = `/events/${eventId}/staff`;

  async function add(form: FormData) {
    'use server';
    const get = (k: string) => String(form.get(k) ?? '');
    await refusable(here, () => assign({
      eventId, staffId: get('staffId'), roomId: get('roomId') || null, day: get('day'),
      startMin: fromHhmm(get('start')), endMin: fromHhmm(get('end')), role: get('role') as DayRole,
    }), StaffingRefused);
  }

  return (
    <main>
      <h1>{event.name} — staffing</h1>
      {error && <p role="alert">{error}</p>}
      {days.map((day) => (
        <section key={day}>
          <h2>{shortDay(day)}</h2>
          <table>
            <thead><tr><th>Shift</th><th>Who</th><th>Role</th><th>Where</th></tr></thead>
            <tbody>
              {event.staffing.filter((a) => fromDbDate(a.day) === day).map((a) => (
                <tr key={a.id}>
                  <td>{hhmm(a.startMin)}–{hhmm(a.endMin)}</td>
                  <td>{a.staff.name}</td>
                  <td>{roleName(a.role)}</td>
                  <td>{a.room?.name ?? 'all rooms'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      <h2>Assign</h2>
      <form action={add}>
        <select name="staffId" aria-label="Who" required>{staff.map((s) => <option key={s.id} value={s.id}>{s.name} (cap {s.maxMinutesPerDay / 60}h)</option>)}</select>{' '}
        <select name="role" aria-label="Role">{Object.values(DayRole).map((r) => <option key={r} value={r}>{roleName(r)}</option>)}</select>{' '}
        <select name="day" aria-label="Day">{days.map((d) => <option key={d} value={d}>{shortDay(d)}</option>)}</select>{' '}
        <select name="roomId" aria-label="Where"><option value="">all rooms</option>{event.rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>{' '}
        <input type="time" name="start" required aria-label="Start" /> <input type="time" name="end" required aria-label="End" />{' '}
        <button type="submit">Assign</button>
      </form>
    </main>
  );
}
