import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import type { PublicSession } from '@/src/agenda/publish';
import { systemClock } from '@/src/clock';
import { buildPackage, packageStatus, type Scope } from '@/src/content/distribution';
import { ContentRefused } from '@/src/content/pipeline';
import { addRecording, issueMissingRecapLinks, issueRecapLink, recapFiles, revokeRecapLink } from '@/src/content/recap';
import { prisma } from '@/src/db';
import { hhmm, shortDay } from '@/src/time';
import { IssueLink, type Issued } from '../../../issue-link';
import { refusable } from '../refusable';

export const dynamic = 'force-dynamic';

/** `room:<id>` or `attendees` from the build form. Module scope: server actions must not close over page data. */
const scopeFrom = (key: string): Scope => key.startsWith('room:') ? { audience: 'room', roomId: key.slice(5) } : { audience: 'attendees' };

const stamp = (d: Date) => `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;

/**
 * Distribution packages (D-016): one playback package per room, in running
 * order from the published agenda, and the post-show attendees bundle behind
 * the consent gate. A package is stale when what it would hold now differs
 * from its last build; only a rebuild clears it. Below them: session
 * recordings, and a recap link per attendee serving the attendees package
 * through the live consent gate (D-031).
 */
export default async function Packages({ params, searchParams }: { params: Promise<{ eventId: string }>; searchParams: Promise<{ error?: string }> }) {
  const { eventId } = await params;
  const { error } = await searchParams;
  const event = await prisma.event.findUnique({ where: { id: eventId }, include: { rooms: { orderBy: { name: 'asc' } } } });
  if (!event) notFound();
  const here = `/events/${eventId}/packages`;
  const agenda = await prisma.agendaVersion.findFirst({ where: { eventId }, orderBy: { number: 'desc' } });
  const published = !!agenda;

  async function doBuild(form: FormData) {
    'use server';
    await refusable(here, () => buildPackage(eventId, scopeFrom(String(form.get('scope'))), systemClock), ContentRefused);
  }

  async function doRecording(form: FormData) {
    'use server';
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) redirect(`${here}?error=${encodeURIComponent('Choose a file to upload')}`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    await refusable(here, () => addRecording(eventId, String(form.get('sessionId')), { filename: file.name, mimeType: file.type, bytes }, systemClock), ContentRefused);
  }

  async function doLinks(): Promise<Issued> {
    'use server';
    const links = await issueMissingRecapLinks(eventId);
    revalidatePath(here);
    return { links: links.map((l) => ({ for: l.name, url: `/portal/recap/${l.token}` })) };
  }

  async function doLink(_prev: Issued, form: FormData): Promise<Issued> {
    'use server';
    const a = await prisma.attendee.findFirst({ where: { id: String(form.get('attendeeId')), eventId }, select: { id: true, name: true } });
    if (!a) return { error: 'No such attendee on this event' };
    const token = await issueRecapLink(eventId, a.id);
    revalidatePath(here);
    return { url: `/portal/recap/${token}`, for: a.name };
  }

  async function doRevoke(form: FormData) {
    'use server';
    await revokeRecapLink(eventId, String(form.get('attendeeId')));
    revalidatePath(here);
  }

  const scopes = [
    ...event.rooms.map((r) => ({ key: `room:${r.id}`, title: `${r.name} — playback`, scope: { audience: 'room', roomId: r.id } as Scope })),
    { key: 'attendees', title: 'Attendees — post-show decks, videos and recordings (consent-gated)', scope: { audience: 'attendees' } as Scope },
  ];
  const statuses = published ? await Promise.all(scopes.map(async (s) => ({ ...s, status: await packageStatus(eventId, s.scope) }))) : [];
  const sessions = ((agenda?.snapshot ?? []) as PublicSession[]).toSorted((a, b) => a.day.localeCompare(b.day) || a.startMin - b.startMin || a.room.localeCompare(b.room));
  const recordings = await prisma.sessionRecording.findMany({ where: { eventId }, orderBy: { number: 'desc' }, select: { sessionId: true, number: true, filename: true } });
  const latest = new Map(recordings.toReversed().map((r) => [r.sessionId, r]));
  const [attendees, serving] = await Promise.all([
    prisma.attendee.findMany({ where: { eventId }, orderBy: { name: 'asc' }, select: { id: true, name: true, email: true, recapTokenHash: true, _count: { select: { downloads: true } } } }),
    published ? recapFiles(eventId) : [],
  ]);

  return (
    <main>
      <h1>{event.name} — distribution packages</h1>
      {error && <p role="alert">{error}</p>}
      {!published && <p>Publish the agenda first — packages follow its running order.</p>}
      {statuses.map(({ key, title, status: s }) => (
        <section key={key} aria-label={title} style={{ border: '1px solid #ccc', padding: 8, marginBottom: 12 }}>
          <h2>{title}</h2>
          <p>
            {s.last ? <>Package {s.last.number}, built {stamp(s.last.builtAt)} from agenda v{s.last.agendaVersion} · checksum <code>{s.last.sha256.slice(0, 12)}</code> · </> : 'Never built · '}
            <strong>{s.stale ? (s.last ? 'STALE — rebuild' : 'not built') : 'current'}</strong>
          </p>
          {s.last && s.stale && (
            <ul>
              {s.added.map((l) => <li key={`+${l}`}>Added: {l}</li>)}
              {s.removed.map((l) => <li key={`-${l}`}>Removed: {l}</li>)}
            </ul>
          )}
          {s.stale && (
            <form action={doBuild}>
              <input type="hidden" name="scope" value={key} />
              <button type="submit">{s.last ? 'Rebuild package' : 'Build package'}</button>
            </form>
          )}
          <table>
            <thead><tr><th>Day</th><th>Start</th><th>Session</th><th>Speaker</th><th>File</th><th>SHA-256</th></tr></thead>
            <tbody>
              {s.manifest.entries.map((e) => (
                <tr key={`${e.sessionId}:${e.versionId}`}>
                  <td>{shortDay(e.day)}</td><td>{hhmm(e.startMin)}</td><td>{e.session}</td><td>{e.speaker}</td>
                  <td>{e.label} v{e.version} ({e.filename})</td><td><code>{e.sha256.slice(0, 12)}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
          {s.manifest.gaps.length > 0 && (
            <ul>{s.manifest.gaps.map((g) => <li key={`${g.sessionId}:${g.speaker}:${g.label}`}>Not locked yet: {g.session} — {g.speaker}: {g.label}</li>)}</ul>
          )}
          {s.withheld.length > 0 && (
            <ul>{s.withheld.map((w, i) => <li key={i}>Withheld: {w.label} — {w.reason}</li>)}</ul>
          )}
        </section>
      ))}
      {published && (
        <section aria-label="Session recordings" style={{ border: '1px solid #ccc', padding: 8, marginBottom: 12 }}>
          <h2>Session recordings</h2>
          <p>The latest upload per session goes in the attendees package — only if every speaker on it consented to recording and publishing video.</p>
          <table>
            <thead><tr><th>Day</th><th>Start</th><th>Room</th><th>Session</th><th>Recording</th><th>Upload</th></tr></thead>
            <tbody>
              {sessions.map((x) => {
                const r = latest.get(x.id);
                return (
                  <tr key={x.id}>
                    <td>{shortDay(x.day)}</td><td>{hhmm(x.startMin)}</td><td>{x.room}</td><td>{x.title}</td>
                    <td>{r ? `#${r.number} ${r.filename}` : '—'}</td>
                    <td>
                      <form action={doRecording}>
                        <input type="hidden" name="sessionId" value={x.id} />
                        <input type="file" name="file" accept="video/*,audio/*" aria-label={`Recording for ${x.title}`} />
                        <button type="submit">Upload</button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
      <section aria-label="Attendee recap links" style={{ border: '1px solid #ccc', padding: 8, marginBottom: 12 }}>
        <h2>Attendee recap links</h2>
        <p>
          Each link shows the last built attendees package, minus anything a speaker has since withheld — {serving.length} file{serving.length === 1 ? '' : 's'} right now.
          Links stop working 90 days after the show.
        </p>
        {attendees.length === 0 ? <p>No attendee records on this event.</p> : (
          <>
            <IssueLink action={doLinks} fields={{}} label="Issue links to attendees without one" />
            <table>
              <thead><tr><th>Attendee</th><th>Email</th><th>Link</th><th>Downloads</th><th></th></tr></thead>
              <tbody>
                {attendees.map((a) => (
                  <tr key={a.id}>
                    <td>{a.name}</td><td>{a.email}</td><td>{a.recapTokenHash ? 'issued' : '—'}</td><td>{a._count.downloads}</td>
                    <td>
                      <IssueLink action={doLink} fields={{ attendeeId: a.id }} label={a.recapTokenHash ? 'Reissue' : 'Issue link'} />
                      {a.recapTokenHash && <form action={doRevoke}><input type="hidden" name="attendeeId" value={a.id} /><button type="submit">Revoke</button></form>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>
    </main>
  );
}
