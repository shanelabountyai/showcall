import { notFound } from 'next/navigation';
import { ApprovalRefused, decideBudget, resolveClientPortal } from '@/src/budget/approval';
import { systemClock } from '@/src/clock';
import { usd } from '@/src/money';
import { refusable } from '../../../events/[eventId]/refusable';

export const dynamic = 'force-dynamic';

const stamp = (d: Date) => `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;

/**
 * The client's approval portal (P1-6, D-028). Public: the token in the path is
 * the only credential, and the answer re-checks it in src/budget/approval.ts.
 * Shows only the latest budget sent, billable lines only, against what the
 * client last approved. A bad or expired link is a plain 404.
 */
export default async function ClientPortal({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ error?: string }> }) {
  const { token } = await params;
  const { error } = await searchParams;
  const p = await resolveClientPortal(token, systemClock);
  if (!p) notFound();
  const here = `/portal/client/${token}`;

  async function doDecide(form: FormData) {
    'use server';
    await refusable(here, () => decideBudget(token, String(form.get('snapshotId')), {
      approved: form.get('answer') === 'approve', signedBy: String(form.get('signedBy') ?? ''), note: String(form.get('note') ?? ''),
    }, systemClock), ApprovalRefused);
  }

  const s = p.sent;
  return (
    <main>
      <h1>{p.event} — budget for {p.client}</h1>
      {error && <p role="alert">{error}</p>}
      <p>{p.baseline ? `You last approved #${p.baseline.number} ${p.baseline.label}: ${usd(p.baseline.cents)}.` : 'You have not approved a budget yet.'}</p>
      {!s ? <p>No budget has been sent to you yet.</p> : (
        <section aria-label="Budget for approval">
          <h2>#{s.number} {s.label} — {usd(s.cents)}</h2>
          <p>Sent {stamp(s.takenAt)}</p>
          <table>
            <thead><tr><th>Category</th><th>Line</th><th>Amount</th><th>You approved</th></tr></thead>
            <tbody>
              {s.lines.map((l, i) => (
                <tr key={i}>
                  <td>{l.category}</td><td>{l.description}</td><td>{usd(l.cents)}</td>
                  <td>{l.wasCents == null ? '—' : l.wasCents === l.cents ? 'same' : l.wasCents === 0 ? 'new' : usd(l.wasCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {s.approval ? (
            <p role="status">
              {s.approval.approved ? 'Approved' : 'Declined'} by {s.approval.signedBy} at {stamp(s.approval.decidedAt)}{s.approval.note && `: “${s.approval.note}”`}
            </p>
          ) : (
            <form action={doDecide}>
              <input type="hidden" name="snapshotId" value={s.id} />
              <label>Your name <input name="signedBy" required /></label>{' '}
              <label>Note (required to decline) <input name="note" /></label>{' '}
              <button type="submit" name="answer" value="approve">Approve {usd(s.cents)}</button>{' '}
              <button type="submit" name="answer" value="decline">Decline</button>
            </form>
          )}
        </section>
      )}
    </main>
  );
}
