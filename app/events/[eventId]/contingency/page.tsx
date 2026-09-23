import { BudgetRefused } from '@/src/budget/budget';
import { notFound } from 'next/navigation';
import { systemClock } from '@/src/clock';
import { contingencyBoard, ContingencyRefused, executeBranch, previewBranch, type PlanState } from '@/src/contingency/contingency';
import { usd } from '@/src/money';
import { CascadeBlocked, CascadeChanged } from '@/src/runsheet/cascade';
import type { Moved, Span } from '@/src/runsheet/cues';
import { hhmm, shortDay } from '@/src/time';
import { refusable } from '../refusable';

export const dynamic = 'force-dynamic';

const stamp = (d: Date) => `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;

const READS: Record<PlanState, string> = { overdue: 'OVERDUE — not called', due: 'due soon', open: 'open', decided: 'decided' };

const where = (s: Span | null) => (s ? `${hhmm(s.startMin)}–${hhmm(s.endMin)} ${shortDay(s.day)}${s.room ? `, ${s.room}` : ''}` : 'off the sheet');
const moveLine = (m: Moved, label: Map<string, string>) => `${label.get(m.id) ?? 'a row no longer on the sheet'}: ${where(m.from)} → ${where(m.to)}`;

const countdown = (min: number) => {
  const m = Math.abs(min), text = m >= 1440 ? `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h` : `${Math.floor(m / 60)}h ${m % 60}m`;
  return min > 0 ? `${text} left` : `${text} late`;
};

/**
 * The contingency dashboard (P0-7, D-022). Each decide-by is a run-sheet cue,
 * so the time shown is the cascade's, never a stored copy; the state is
 * derived from the clock on every render. The escalation sweep writes the
 * outbox (app/api/cron/escalate); this page only reads it.
 *
 * Making the call is preview then execute (S-17, D-023): the execute form
 * carries the preview's cascade, and the commit refuses unless it moves
 * exactly that.
 */
export default async function Contingency({ params, searchParams }: { params: Promise<{ eventId: string }>; searchParams: Promise<{ error?: string; preview?: string }> }) {
  const { eventId } = await params;
  const { error, preview: previewId } = await searchParams;
  const board = await contingencyBoard(eventId, systemClock).catch(() => null);
  if (!board) notFound();
  const here = `/events/${eventId}/contingency`;
  const previewing = board.plans.find((p) => p.state !== 'decided' && p.branches.some((b) => b.id === previewId));
  const preview = previewing && await previewBranch(previewing.id, previewId!);

  async function doExecute(form: FormData) {
    'use server';
    const expected = JSON.parse(String(form.get('expected'))) as Moved[];
    await refusable(here, () => executeBranch(String(form.get('planId')), String(form.get('branchId')), expected, systemClock), ContingencyRefused, CascadeChanged, CascadeBlocked, BudgetRefused);
  }
  const sent = board.plans.flatMap((p) => p.escalations.map((e) => ({ ...e, title: p.title }))).sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime());

  return (
    <main>
      <h1>{board.event.name} — contingency plans</h1>
      {error && <p role="alert">{error}</p>}
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
            <thead><tr><th>Branch</th><th>Run-sheet variant</th><th>Vendor notices</th><th>Cost delta</th><th /></tr></thead>
            <tbody>
              {p.branches.map((b) => (
                <tr key={b.id}>
                  <td>{b.label}{p.decision && (p.decision.branchId === b.id ? ' — taken' : ' — not taken')}</td>
                  <td>{b.cueEdits.length ? b.cueEdits.map((e) => board.cueLabel.get(e.cueId) ?? 'a cue no longer on the sheet').join(', ') : 'as planned'}</td>
                  <td>{b.notices.length ? b.notices.map((n) => `${n.vendor.name}: ${n.body}`).join(' · ') : '—'}</td>
                  <td>{b.costDeltaCents ? `${usd(b.costDeltaCents)} ${b.costCategory}${b.costVendor ? ` (${b.costVendor.name})` : ''}` : '—'}</td>
                  <td>{!p.decision && <a href={`${here}?preview=${b.id}`}>Preview {b.label}</a>}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {preview && previewing === p && (() => {
            const b = p.branches.find((x) => x.id === previewId)!;
            return (
              <section aria-label="Preview">
                <h3>If you call &ldquo;{b.label}&rdquo;</h3>
                {preview.moved.length ? <ul>{preview.moved.map((m) => <li key={m.id}>{moveLine(m, board.cueLabel)}</li>)}</ul> : <p>The run sheet stays as it is.</p>}
                <p>Call sheets re-issued: {preview.callSheets.length ? preview.callSheets.join(', ') : 'none'}.</p>
                {preview.warnings.length > 0 && (
                  <ul aria-label="Work rules">{preview.warnings.map((w) => <li key={w.message}>{w.isNew ? 'New: ' : 'Already: '}{w.message}</li>)}</ul>
                )}
                {preview.problems.length > 0 && <ul role="alert">{preview.problems.map((x) => <li key={x.cueId + x.kind}>{x.message}</li>)}</ul>}
                <form action={doExecute}>
                  <input type="hidden" name="planId" value={p.id} />
                  <input type="hidden" name="branchId" value={b.id} />
                  <input type="hidden" name="expected" value={JSON.stringify(preview.moved)} />
                  <button disabled={preview.problems.length > 0}>Execute {b.label}</button> <a href={here}>Cancel</a>
                </form>
              </section>
            );
          })()}

          {p.decision && (
            <section aria-label="Decision log">
              <h3>Decision log</h3>
              <p>Called {stamp(p.decision.decidedAt)}: <strong>{p.decision.branch.label}</strong>.
                {p.decision.budgetLine ? ` Budget: ${usd(p.decision.budgetLine.committedCents)} committed as "${p.decision.budgetLine.description}".` : ' No cost.'}</p>
              <p>Call sheets re-issued: {p.decision.reissued.length ? p.decision.reissued.join(', ') : 'none'}.</p>
              {p.decision.moved.length ? <ul>{p.decision.moved.map((m) => <li key={m.id}>{moveLine(m, board.cueLabel)}</li>)}</ul> : <p>The run sheet was left as it was.</p>}
              {p.branches.find((b) => b.id === p.decision!.branchId)!.notices.map((n) => <p key={n.id}>Sent to {n.vendor.name}: {n.body}</p>)}
            </section>
          )}
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
