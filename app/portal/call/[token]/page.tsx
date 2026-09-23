import { notFound, redirect } from 'next/navigation';
import { confirmReceipt, PortalRefused, resolveCrewPortal, submitCoi } from '@/src/callsheet/portal';
import type { CallSheetRow } from '@/src/callsheet/callsheet';
import { systemClock } from '@/src/clock';
import { MAX_UPLOAD_BYTES } from '@/src/content/pipeline';
import { fromDbDate, hhmm, shortDay } from '@/src/time';
import { refusable } from '../../../events/[eventId]/refusable';

export const dynamic = 'force-dynamic';

const stamp = (d: Date) => `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
const when = (r: CallSheetRow) => `${hhmm(r.startMin)}–${hhmm(r.endMin)} ${shortDay(r.day)}, ${r.room}`;

/**
 * The crew/vendor portal (P1-3, D-026). Public: the token in the path is the
 * only credential, and every write re-checks it in src/callsheet/portal.ts.
 * Shows the latest issued sheet exactly as sent. A bad or expired link is a
 * plain 404.
 */
export default async function CrewPortal({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ error?: string }> }) {
  const { token } = await params;
  const { error } = await searchParams;
  const p = await resolveCrewPortal(token, systemClock);
  if (!p) notFound();
  const here = `/portal/call/${token}`;

  async function doConfirm(form: FormData) {
    'use server';
    await refusable(here, () => confirmReceipt(token, String(form.get('issueId')), systemClock), PortalRefused);
  }

  async function doCoi(form: FormData) {
    'use server';
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) redirect(`${here}?error=${encodeURIComponent('Choose a file to upload')}`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    await refusable(here, () => submitCoi(token, { filename: file.name, mimeType: file.type, bytes }, String(form.get('expiresOn')), systemClock), PortalRefused);
  }

  const issue = p.issue;
  const days = issue ? Map.groupBy(issue.sheet.rows, (r) => r.day) : new Map();
  const c = issue?.changes;
  const changes = c ? [
    ...c.added.map((r) => `Added: ${r.label}, ${when(r)}`),
    ...c.removed.map((r) => `Removed: ${r.label}, was ${when(r)}`),
    ...c.changed.map(({ from, to }) => `Changed: ${to.label}, now ${when(to)} (was ${when(from)})`),
    ...(c.reportTo ? [`Report to changed (was: ${c.reportTo.from || 'not set'})`] : []),
  ] : [];

  return (
    <main>
      <h1>{p.event} — {p.role} call sheet</h1>
      {error && <p role="alert">{error}</p>}
      {!issue ? <p>No call sheet has been issued to you yet.</p> : (
        <>
          <p>Issue {issue.number} · issued {stamp(issue.issuedAt)}</p>
          {issue.confirmedAt
            ? <p role="status">You confirmed receipt of issue {issue.number} at {stamp(issue.confirmedAt)}.</p>
            : (
              <form action={doConfirm}>
                <input type="hidden" name="issueId" value={issue.id} />
                <button type="submit">Confirm I have issue {issue.number}</button>
              </form>
            )}
          {issue.sheet.reportTo && <p><strong>Report to:</strong> {issue.sheet.reportTo}</p>}
          {changes.length > 0 && (
            <section aria-label="Changes">
              <h2>Changed since issue {issue.number - 1}</h2>
              <ul>{changes.map((t) => <li key={t}>{t}</li>)}</ul>
            </section>
          )}
          {days.size === 0 && <p>No cues on this sheet.</p>}
          {[...days].map(([day, rows]: [string, CallSheetRow[]]) => (
            <section key={day}>
              {/* Rows are in run-sheet order, so a day's first row is its call. */}
              <h2>{shortDay(day)} — call {hhmm(rows[0]!.startMin)}</h2>
              <table>
                <thead><tr><th>Time</th><th>Room</th><th>Cue</th></tr></thead>
                <tbody>{rows.map((r) => <tr key={r.cueId}><td>{hhmm(r.startMin)}–{hhmm(r.endMin)}</td><td>{r.room}</td><td>{r.label}</td></tr>)}</tbody>
              </table>
            </section>
          ))}
        </>
      )}

      {p.coi && (
        <section aria-label="Certificate of insurance">
          <h2>Certificate of insurance — {p.vendor}</h2>
          <p>Upload your current certificate. Our producer checks it before it counts. Limit {MAX_UPLOAD_BYTES / 1024 / 1024} MB.</p>
          <form action={doCoi}>
            <input type="file" name="file" required aria-label="Certificate file" />{' '}
            <label>Expires <input type="date" name="expiresOn" required /></label>{' '}
            <button type="submit">Upload certificate</button>
          </form>
          <ul>
            {p.coi.map((s) => (
              <li key={s.id}>{s.filename} · expires {shortDay(fromDbDate(s.statedExpiresOn))} · uploaded {stamp(s.submittedAt)} · {s.docId ? 'accepted' : 'waiting for review'}</li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
