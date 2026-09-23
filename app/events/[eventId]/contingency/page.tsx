import { notFound } from 'next/navigation';
import { systemClock } from '@/src/clock';
import { contingencyBoard, type PlanState } from '@/src/contingency/contingency';
import { usd } from '@/src/money';
import { hhmm, shortDay } from '@/src/time';

export const dynamic = 'force-dynamic';

const stamp = (d: Date) => `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;

const READS: Record<PlanState, string> = { overdue: 'OVERDUE — not called', due: 'due soon', open: 'open', decided: 'decided' };

const countdown = (min: number) => {
  const m = Math.abs(min), text = m >= 1440 ? `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h` : `${Math.floor(m / 60)}h ${m % 60}m`;
  return min > 0 ? `${text} left` : `${text} late`;
};

/**
 * The contingency dashboard (P0-7, D-022). Each decide-by is a run-sheet cue,
 * so the time shown is the cascade's, never a stored copy; the state is
 * derived from the clock on every render. The escalation sweep writes the
 * outbox (app/api/cron/escalate); this page only reads it.
 */
export default async function Contingency({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const board = await contingencyBoard(eventId, systemClock).catch(() => null);
  if (!board) notFound();
  const sent = board.plans.flatMap((p) => p.escalations.map((e) => ({ ...e, title: p.title }))).sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime());

  return (
    <main>
      <h1>{board.event.name} — contingency plans</h1>
      <p>Now {hhmm(board.now.min)} {shortDay(board.now.day)} on the venue&rsquo;s clock. {board.plans.filter((p) => p.state === 'overdue').length} call(s) overdue.</p>
      {board.runSheetStale && <p role="alert">The run sheet is behind the published agenda: decide-by times are as last built.</p>}

      {board.plans.map((p) => (
        <section key={p.id} aria-label={p.title}>
          <h2>{p.title} — {READS[p.state]}</h2>
          <p>
            Decide by <strong>{hhmm(p.decideBy.min)} {shortDay(p.decideBy.day)}</strong>
            {p.state !== 'decided' && <> ({countdown(p.minutesLeft)})</>} · owner {p.owner.name}
            {p.decision && <> · called {stamp(p.decision.decidedAt)}: <strong>{p.decision.branch.label}</strong></>}
            {p.escalated && <> · escalated {stamp(p.escalated.sentAt)}</>}
          </p>
          <p>Trigger: {p.trigger}</p>
          <table>
            <thead><tr><th>Branch</th><th>Run-sheet variant</th><th>Vendor notices</th><th>Cost delta</th></tr></thead>
            <tbody>
              {p.branches.map((b) => (
                <tr key={b.id}>
                  <td>{b.label}</td>
                  <td>{b.cueEdits.length ? b.cueEdits.map((e) => board.cueLabel.get(e.cueId) ?? 'a cue no longer on the sheet').join(', ') : 'as planned'}</td>
                  <td>{b.notices.length ? b.notices.map((n) => `${n.vendor.name}: ${n.body}`).join(' · ') : '—'}</td>
                  <td>{b.costDeltaCents ? `${usd(b.costDeltaCents)} ${b.costCategory}${b.costVendor ? ` (${b.costVendor.name})` : ''}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      {!board.plans.length && <p>No contingency plans for this event.</p>}

      <section aria-label="Escalation outbox">
        <h2>Escalation outbox</h2>
        {sent.length ? (
          <table>
            <thead><tr><th>Sent</th><th>Plan</th><th>To</th><th>Message</th></tr></thead>
            <tbody>{sent.map((e) => <tr key={e.id}><td>{stamp(e.sentAt)}</td><td>{e.title}</td><td>{e.to}</td><td>{e.body}</td></tr>)}</tbody>
          </table>
        ) : <p>Nothing escalated.</p>}
      </section>
    </main>
  );
}
