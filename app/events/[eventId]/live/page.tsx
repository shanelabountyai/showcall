import { revalidatePath } from 'next/cache';
import { notFound } from 'next/navigation';
import { systemClock } from '@/src/clock';
import { prisma } from '@/src/db';
import { liveShow, markGo } from '@/src/live/live';
import { stageManagersOnDuty } from '@/src/staffing/staffing';
import { hhmm, shortDay } from '@/src/time';
import { Poll } from './poll';

export const dynamic = 'force-dynamic';

const signed = (min: number) => (min === 0 ? 'on time' : min > 0 ? `${min} min late` : `${-min} min early`);

/**
 * Stage-manager live mode: current/next per room and projected times. GO logs
 * a mark; it never edits a cue. `?as=` picks who is calling — not auth (D-011):
 * GO shows only in that person's rooms, and markGo re-checks the assignment.
 */
export default async function Live({ params, searchParams }: { params: Promise<{ eventId: string }>; searchParams: Promise<{ as?: string }> }) {
  const { eventId } = await params;
  const { as } = await searchParams;
  if (!(await prisma.event.findUnique({ where: { id: eventId }, select: { id: true } }))) notFound();
  const live = await liveShow(eventId, systemClock);
  const onDuty = await stageManagersOnDuty(eventId, live.day);
  const mine = onDuty.filter((a) => a.staffId === as);
  const canGo = (room: string) => mine.some((a) => !a.room || a.room.name === room);

  async function go(form: FormData) {
    'use server';
    await markGo(eventId, String(form.get('rowId')), String(form.get('staffId')), systemClock);
    revalidatePath(`/events/${eventId}/live`);
  }

  return (
    <main>
      <Poll ms={5000} />
      <h1>{live.eventName} — live</h1>
      <p>{shortDay(live.day)} · now {hhmm(live.nowMin)}</p>
      <nav>
        Calling as:{' '}
        {onDuty.length === 0 ? 'no stage manager is assigned today' : onDuty.map((a, i) => (
          <span key={a.id}>{i > 0 && ' · '}
            {a.staffId === as ? <strong>{a.staff.name}</strong> : <a href={`?as=${a.staffId}`}>{a.staff.name}</a>} ({a.room?.name ?? 'all rooms'})
          </span>
        ))}
      </nav>
      {live.stale && <p role="alert"><strong>The agenda has published past this run sheet.</strong> Times shown are the run sheet as built; rebase it.</p>}
      {live.rooms.length === 0 && <p>Nothing on the run sheet today.</p>}
      {live.rooms.map((room) => (
        <section key={room.room}>
          <h2>{room.room} — {signed(room.offsetMin)}</h2>
          <p>Current: {room.current?.label ?? '—'} · Next: {room.next ? `${room.next.label} at ${hhmm(room.next.projectedMin)}` : '—'}</p>
          <table>
            <thead><tr><th>Planned</th><th>Projected</th><th>Row</th><th></th></tr></thead>
            <tbody>
              {room.rows.map((r) => (
                <tr key={r.id} data-state={r.state} aria-current={r.state === 'current' ? 'step' : undefined}>
                  <td>{hhmm(r.startMin)}</td>
                  <td>{r.projectedMin === r.startMin ? '' : hhmm(r.projectedMin)}</td>
                  <td>{r.state === 'current' ? <strong>{r.label}</strong> : r.label}</td>
                  <td>
                    {canGo(room.room) && (
                      <form action={go}>
                        <input type="hidden" name="rowId" value={r.id} />
                        <input type="hidden" name="staffId" value={as} />
                        <button type="submit">GO</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </main>
  );
}
