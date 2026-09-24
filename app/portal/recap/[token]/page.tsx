import { notFound } from 'next/navigation';
import { systemClock } from '@/src/clock';
import { resolveRecap } from '@/src/content/recap';
import { hhmm, shortDay } from '@/src/time';

export const dynamic = 'force-dynamic';

/**
 * An attendee's post-show recap (P1-2, D-031). Public: the token in the path
 * is the only credential. Lists only what the last built package holds and
 * the consent gate still releases; each download re-checks both.
 */
export default async function Recap({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = await resolveRecap(token, systemClock);
  if (!r) notFound();
  return (
    <main>
      <h1>{r.event} — session materials</h1>
      <p>For {r.attendee}.</p>
      {r.files.length === 0 ? <p>Nothing has been shared yet.</p> : (
        <table aria-label="Session materials">
          <thead><tr><th>Day</th><th>Start</th><th>Session</th><th>Speaker</th><th>File</th></tr></thead>
          <tbody>
            {r.files.map((f) => (
              <tr key={f.versionId}>
                <td>{shortDay(f.day)}</td><td>{hhmm(f.startMin)}</td><td>{f.session}</td><td>{f.speaker}</td>
                <td><a href={`/portal/recap/${token}/file/${f.versionId}`} rel="noreferrer">{f.label}</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
