import { notFound } from 'next/navigation';
import { systemClock } from '@/src/clock';
import { buildPackage, packageStatus, type Scope } from '@/src/content/distribution';
import { ContentRefused } from '@/src/content/pipeline';
import { prisma } from '@/src/db';
import { hhmm, shortDay } from '@/src/time';
import { refusable } from '../refusable';

export const dynamic = 'force-dynamic';

/** `room:<id>` or `attendees` from the build form. Module scope: server actions must not close over page data. */
const scopeFrom = (key: string): Scope => key.startsWith('room:') ? { audience: 'room', roomId: key.slice(5) } : { audience: 'attendees' };

const stamp = (d: Date) => `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;

/**
 * Distribution packages (D-016): one playback package per room, in running
 * order from the published agenda, and the post-show attendees bundle behind
 * the consent gate. A package is stale when what it would hold now differs
 * from its last build; only a rebuild clears it.
 */
export default async function Packages({ params, searchParams }: { params: Promise<{ eventId: string }>; searchParams: Promise<{ error?: string }> }) {
  const { eventId } = await params;
  const { error } = await searchParams;
  const event = await prisma.event.findUnique({ where: { id: eventId }, include: { rooms: { orderBy: { name: 'asc' } } } });
  if (!event) notFound();
  const here = `/events/${eventId}/packages`;
  const published = await prisma.agendaVersion.count({ where: { eventId } });

  async function doBuild(form: FormData) {
    'use server';
    await refusable(here, () => buildPackage(eventId, scopeFrom(String(form.get('scope'))), systemClock), ContentRefused);
  }

  const scopes = [
    ...event.rooms.map((r) => ({ key: `room:${r.id}`, title: `${r.name} — playback`, scope: { audience: 'room', roomId: r.id } as Scope })),
    { key: 'attendees', title: 'Attendees — post-show decks (consent-gated)', scope: { audience: 'attendees' } as Scope },
  ];
  const statuses = published ? await Promise.all(scopes.map(async (s) => ({ ...s, status: await packageStatus(eventId, s.scope) }))) : [];

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
            <ul>{s.withheld.map((w) => <li key={`${w.speaker}:${w.label}`}>Withheld: {w.label} — {w.reason}</li>)}</ul>
          )}
        </section>
      ))}
    </main>
  );
}
