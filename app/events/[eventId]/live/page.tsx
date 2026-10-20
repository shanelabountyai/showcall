import { revalidatePath } from 'next/cache';
import { notFound } from 'next/navigation';
import { systemClock } from '@/src/clock';
import { prisma } from '@/src/db';
import { CallSheetsBlocked, issueCallSheets } from '@/src/callsheet/callsheet';
import { buildFrame, type LiveData } from '@/src/live/frames';
import { markGo } from '@/src/live/live';
import { CascadeBlocked, commitCascade, previewCascade } from '@/src/runsheet/cascade';
import { stageManagersOnDuty } from '@/src/staffing/staffing';
import { LiveChip, LiveProvider } from '../../../live-stream';
import { refusable } from '../refusable';
import { LiveRooms } from './rooms';

export const dynamic = 'force-dynamic';

/**
 * Stage-manager live mode: current/next per room and projected times. GO logs
 * a mark; it never edits a cue. `?as=` picks who is calling — not auth (D-011):
 * GO shows only in that person's rooms, and markGo re-checks the assignment.
 */
export default async function Live({ params, searchParams }: { params: Promise<{ eventId: string }>; searchParams: Promise<{ as?: string; error?: string; reissued?: string }> }) {
  const { eventId } = await params;
  const { as, error, reissued } = await searchParams;
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { timezone: true } });
  if (!event) notFound();
  const frame = await buildFrame('live', eventId, { clock: systemClock, since: null });
  if (!frame) notFound();
  const live = frame.data as LiveData;
  const onDuty = await stageManagersOnDuty(eventId, live.day);
  const mine = onDuty.filter((a) => a.staffId === as);
  const goRooms = mine.length === 0 ? [] : mine.some((a) => !a.room) ? null : mine.map((a) => a.room!.name);

  async function go(form: FormData) {
    'use server';
    await markGo(eventId, String(form.get('rowId')), String(form.get('staffId')), systemClock);
    revalidatePath(`/events/${eventId}/live`);
  }

  /** Rebase onto the newest agenda through the cascade, then re-issue the sheets it changed. Refused whole if the new agenda breaks a cue. */
  async function rebase() {
    'use server';
    await refusable(`/events/${eventId}/live`, async () => {
      const preview = await previewCascade(eventId, { rebase: true });
      await commitCascade(eventId, { rebase: true }, preview.moved);
      const issued = await issueCallSheets(eventId, systemClock);
      return new URLSearchParams({ reissued: issued.map((i) => i.role).join(', ') || 'none' });
    }, CascadeBlocked, CallSheetsBlocked);
  }

  return (
    <main>
      <LiveProvider url={`/api/live/${eventId}/live`} initial={frame} timeZone={event.timezone} replaceOnEqual>
        <h1>{live.eventName} — live</h1>
        <LiveChip />
        <nav>
          Calling as:{' '}
          {onDuty.length === 0 ? 'no stage manager is assigned today' : onDuty.map((a, i) => (
            <span key={a.id}>{i > 0 && ' · '}
              {a.staffId === as ? <strong>{a.staff.name}</strong> : <a href={`?as=${a.staffId}`}>{a.staff.name}</a>} ({a.room?.name ?? 'all rooms'})
            </span>
          ))}
        </nav>
        {error && <p role="alert">{error}</p>}
        {reissued && <p role="status">Call sheets re-issued: {reissued}.</p>}
        <LiveRooms go={go} rebase={rebase} as={as ?? ''} goRooms={goRooms} />
      </LiveProvider>
    </main>
  );
}
