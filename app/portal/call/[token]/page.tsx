import { notFound, redirect } from 'next/navigation';
import { confirmReceipt, PortalRefused, submitCoi } from '@/src/callsheet/portal';
import { systemClock } from '@/src/clock';
import { MAX_UPLOAD_BYTES } from '@/src/content/pipeline';
import { buildFrame, type CrewData } from '@/src/live/frames';
import { fromDbDate, shortDay } from '@/src/time';
import { refusable } from '../../../events/[eventId]/refusable';
import { LiveChip, LiveProvider } from '../../../live-stream';
import { CrewIssue } from './issue';

export const dynamic = 'force-dynamic';

/** Frames carry dates as ISO strings (they went through JSON); the first frame is built the same way. */
const stamp = (d: Date | string) => `${new Date(d).toISOString().slice(0, 16).replace('T', ' ')} UTC`;

/**
 * The crew/vendor portal (P1-3, D-026). Public: the token in the path is the
 * only credential, and every write re-checks it in src/callsheet/portal.ts.
 * Shows the latest issued sheet exactly as sent, and a re-issue live through
 * the role's own stream (D-040, D-041). A bad or expired link is a plain 404.
 */
export default async function CrewPortal({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ error?: string }> }) {
  const { token } = await params;
  const { error } = await searchParams;
  const frame = await buildFrame('crew', token, { clock: systemClock, since: null });
  if (!frame) notFound();
  const p = frame.data as CrewData;
  const timeZone = p.timezone;
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

  return (
    <main>
      <LiveProvider url={`/api/live/call/${token}`} initial={frame} timeZone={timeZone}>
      <h1>{p.event} — {p.role} call sheet</h1>
      <LiveChip />
      {error && <p role="alert">{error}</p>}
      <CrewIssue confirm={doConfirm} />
      </LiveProvider>

      {p.catering && (
        <section aria-label="Dietary and accessibility">
          <h2>Dietary and accessibility — counts</h2>
          <p>From {p.catering.records} attendee records of {p.catering.registered} registered.{p.catering.registered > p.catering.records && ` ${p.catering.registered - p.catering.records} have not told us yet.`}</p>
          <ul>
            {p.catering.needs.filter((n) => n.count).map((n) => <li key={n.label}>{n.label}: {n.count}</li>)}
          </ul>
        </section>
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
              <li key={s.id}>{s.filename} · expires {shortDay(fromDbDate(new Date(s.statedExpiresOn)))} · uploaded {stamp(s.submittedAt)} · {s.docId ? 'accepted' : 'waiting for review'}</li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
