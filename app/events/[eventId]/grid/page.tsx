import { notFound } from 'next/navigation';
import { detectConflicts } from '@/src/agenda/conflicts';
import { deleteSession, GridEditRefused, saveSession } from '@/src/agenda/grid';
import { currentAgendaVersion, loadGrid, publishAgenda, PublishBlocked } from '@/src/agenda/publish';
import { systemClock } from '@/src/clock';
import { prisma } from '@/src/db';
import { daysBetween, fromDbDate, fromHhmm, inputTime, shortDay } from '@/src/time';
import { refusable } from '../refusable';

export const dynamic = 'force-dynamic';

/**
 * The draft grid: edit freely, see every conflict, publish when clean. The
 * public agenda only ever shows a published version, so nothing here leaks.
 */
export default async function Grid({ params, searchParams }: { params: Promise<{ eventId: string }>; searchParams: Promise<{ error?: string }> }) {
  const { eventId } = await params;
  const { error } = await searchParams;
  const event = await prisma.event.findUnique({ where: { id: eventId }, include: { speakers: { orderBy: { name: 'asc' } } } });
  if (!event) notFound();
  const [{ rooms, sessions }, version] = await Promise.all([loadGrid(eventId), currentAgendaVersion(eventId)]);
  const conflicts = detectConflicts(sessions, rooms);
  const days = daysBetween(fromDbDate(event.startDate), fromDbDate(event.endDate));
  const here = `/events/${eventId}/grid`;

  async function save(form: FormData) {
    'use server';
    const get = (k: string) => String(form.get(k) ?? '');
    await refusable(here, () => saveSession(eventId, {
      id: get('id') || undefined, title: get('title'), day: get('day'), roomId: get('roomId'),
      startMin: fromHhmm(get('start')), endMin: fromHhmm(get('end')), speakerIds: form.getAll('speakerIds').map(String),
    }), GridEditRefused);
  }

  async function remove(form: FormData) {
    'use server';
    await refusable(here, () => deleteSession(eventId, String(form.get('id'))), GridEditRefused);
  }

  async function publish() {
    'use server';
    await refusable(here, () => publishAgenda(eventId, systemClock), PublishBlocked);
  }

  type Row = Partial<(typeof sessions)[number]>;
  const row = (s: Row) => (
    <form action={save} key={s.id ?? 'new'} style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'start', marginBottom: 6 }}>
      <input type="hidden" name="id" value={s.id ?? ''} />
      <input name="title" defaultValue={s.title} placeholder="Title" required aria-label="Title" />
      <select name="day" defaultValue={s.day} aria-label="Day">{days.map((d) => <option key={d} value={d}>{shortDay(d)}</option>)}</select>
      <select name="roomId" defaultValue={s.roomId} aria-label="Room">{rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
      <input type="time" name="start" defaultValue={s.startMin === undefined ? '' : inputTime(s.startMin)} required aria-label="Start" />
      <input type="time" name="end" defaultValue={s.endMin === undefined ? '' : inputTime(s.endMin)} required aria-label="End" />
      <select name="speakerIds" multiple defaultValue={s.speakers?.map((p) => p.id) ?? []} aria-label="Speakers" size={2}>
        {event.speakers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <button type="submit">{s.id ? 'Save' : 'Add'}</button>
      {s.id && <button type="submit" formAction={remove} formNoValidate>Delete</button>}
    </form>
  );

  return (
    <main>
      <h1>{event.name} — draft grid</h1>
      <p>Published: {version ? `version ${version}` : 'never'}. Edits here stay private until published.</p>
      {error && <p role="alert">{error}</p>}
      {conflicts.length > 0 ? (
        <section role="status">
          <strong>{conflicts.length} conflict(s) — publish is blocked:</strong>
          <ul>{conflicts.map((c, i) => <li key={i}>{c.message}</li>)}</ul>
        </section>
      ) : <p>No conflicts.</p>}
      <form action={publish}><button type="submit" disabled={conflicts.length > 0}>Publish version {version + 1}</button></form>

      {days.map((day) => (
        <section key={day}>
          <h2>{shortDay(day)}</h2>
          {sessions.filter((s) => s.day === day).map(row)}
        </section>
      ))}
      <h2>Add a session</h2>
      {rooms.length ? row({}) : <p>This event has no rooms yet.</p>}
    </main>
  );
}
