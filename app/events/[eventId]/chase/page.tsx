import { notFound } from 'next/navigation';
import { chaseBoard, ChaseRefused, outbox, sendDueReminders, setLeadDays, stalePackages, type ChaseState } from '@/src/chase/chase';
import { systemClock } from '@/src/clock';
import { contingencyBoard } from '@/src/contingency/contingency';
import { prisma } from '@/src/db';
import { DeliverableKind } from '@/src/generated/prisma/enums';
import { shortDay } from '@/src/time';
import { refusable } from '../refusable';

export const dynamic = 'force-dynamic';

const stamp = (d: Date) => `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;

/** How each state reads on the board — the worklist is the rows that are not `locked`. */
const READS: Record<ChaseState, string> = {
  overdue: 'OVERDUE', due: 'due soon', open: 'open', no_policy: 'no lead time set', locked: 'locked — done',
};

const countdown = (daysLeft: number | null) =>
  daysLeft == null ? '—' : daysLeft < 0 ? `${-daysLeft}d late` : daysLeft === 0 ? 'today' : `${daysLeft}d left`;

/**
 * The chase dashboard (P0-5). Every deadline here is derived — first call
 * minus the kind's lead time — so nothing on this page can drift from the
 * agenda. The missing-item flags are the bureau guards' own messages
 * (src/bureau/bureau.ts), and the stale flags are the package builder's.
 */
export default async function Chase({ params, searchParams }: { params: Promise<{ eventId: string }>; searchParams: Promise<{ error?: string }> }) {
  const { eventId } = await params;
  const { error } = await searchParams;
  const board = await chaseBoard(eventId, systemClock).catch(() => null);
  if (!board) notFound();
  const here = `/events/${eventId}/chase`;
  const [policies, sentList, stale, contingency] = await Promise.all([
    prisma.deadlinePolicy.findMany({ where: { eventId }, orderBy: { kind: 'asc' } }),
    outbox(eventId),
    stalePackages(eventId),
    contingencyBoard(eventId, systemClock),
  ]);
  const calls = contingency.plans.filter((p) => p.state === 'overdue');
  const owed = board.rows.filter((r) => r.owed != null).length;
  const worklist = board.rows.filter((r) => r.state !== 'locked');

  async function doSend() {
    'use server';
    await refusable(here, () => sendDueReminders(eventId, systemClock), ChaseRefused);
  }

  async function doLead(form: FormData) {
    'use server';
    await refusable(here, () => setLeadDays(eventId, String(form.get('kind')) as DeliverableKind, Number(form.get('leadDays'))), ChaseRefused);
  }

  return (
    <main>
      <h1>{board.event.name} — chase dashboard</h1>
      {error && <p role="alert">{error}</p>}
      <p>Today is {shortDay(board.today)} on the venue&rsquo;s clock. {worklist.length} of {board.rows.length} deliverables still owed.</p>

      <section aria-label="Lifecycle funnel">
        <h2>Lifecycle funnel</h2>
        <table>
          <thead><tr>{board.funnel.map((f) => <th key={f.state}>{f.state.replace('_', ' ')}</th>)}</tr></thead>
          <tbody><tr>{board.funnel.map((f) => <td key={f.state}>{f.count}</td>)}</tr></tbody>
        </table>
      </section>

      <section aria-label="Escalation worklist">
        <h2>Escalation worklist</h2>
        {calls.length > 0 && <p role="alert"><a href={`/events/${eventId}/contingency`}>{calls.length} contingency call(s) past decide-by</a>: {calls.map((p) => p.title).join(', ')}</p>}
        <form action={doSend}>
          <button type="submit" disabled={owed === 0}>Send due reminders ({owed})</button>
        </form>
        <table>
          <thead><tr><th>Status</th><th>Due</th><th>Countdown</th><th>Owner</th><th>Deliverable</th><th>Latest</th><th>Last reminder</th></tr></thead>
          <tbody>
            {board.rows.map((r) => (
              <tr key={r.deliverableId}>
                <td>{READS[r.state]}</td>
                <td>{r.dueDay ? shortDay(r.dueDay) : '—'}</td>
                <td>{r.state === 'locked' ? '—' : countdown(r.daysLeft)}</td>
                <td>{r.owner} ({r.ownerKind})</td>
                <td>{r.label} ({r.kind})</td>
                <td>
                  {r.lockedVersion != null ? `v${r.lockedVersion} locked`
                    : r.latestVersion != null ? `v${r.latestVersion} ${r.latestOutcome ?? 'not validated'}`
                    : 'nothing submitted'}
                </td>
                <td>{r.lastSent ? `step ${r.lastSent.step} · ${stamp(r.lastSent.sentAt)}` : 'never'}{r.owed != null && ' · one owed'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {board.rows.length === 0 && <p>Nothing is owed on this event yet.</p>}
      </section>

      <section aria-label="Missing items">
        <h2>Bureau missing items</h2>
        <ul>
          {board.speakers.map((s) => (
            <li key={s.id}>
              <strong>{s.name}</strong> — {s.state.replace('_', ' ')}
              {s.missing.length > 0 ? <> · missing {s.missing.join(', ')}</> : ' · nothing outstanding'}
              {s.blocked && <> · next ({s.blocked.to.replace('_', ' ')}) blocked: {s.blocked.reason}</>}
            </li>
          ))}
        </ul>
        {board.speakers.length === 0 && <p>This event has no speakers yet.</p>}
      </section>

      {stale.length > 0 && (
        <section aria-label="Stale packages">
          <h2>Stale packages</h2>
          <ul>
            {stale.map((p) => (
              <li key={p.title}>
                {p.title} — {p.built ? `package ${p.built} is behind` : 'never built'}
                {(p.added.length > 0 || p.removed.length > 0) && ` (${[...p.added.map((l) => `+${l}`), ...p.removed.map((l) => `−${l}`)].join('; ')})`}
              </li>
            ))}
          </ul>
          <p><a href={`/events/${eventId}/packages`}>Rebuild from Packages</a> — never automatic (D-016).</p>
        </section>
      )}

      <section aria-label="Lead times">
        <h2>Lead times</h2>
        <p>Days before the owner&rsquo;s first call that a kind is due. A kind with no lead time shows as &ldquo;no lead time set&rdquo; rather than getting an invented deadline.</p>
        <form action={doLead}>
          <select name="kind" aria-label="Deliverable kind" defaultValue="deck">
            {Object.values(DeliverableKind).map((k) => <option key={k} value={k}>{k.replace('_', ' ')}</option>)}
          </select>{' '}
          <input name="leadDays" type="number" min="0" step="1" required aria-label="Lead days" placeholder="Days" />{' '}
          <button type="submit">Set lead time</button>
        </form>
        <ul>{policies.map((p) => <li key={p.id}>{p.kind.replace('_', ' ')}: {p.leadDays} days</li>)}</ul>
      </section>

      <section aria-label="Reminder outbox">
        <h2>Reminder outbox</h2>
        <table>
          <thead><tr><th>Sent</th><th>To</th><th>Deliverable</th><th>Step</th><th>Message</th></tr></thead>
          <tbody>
            {sentList.map((r) => (
              <tr key={r.id}><td>{stamp(r.sentAt)}</td><td>{r.to}</td><td>{r.deliverable.label}</td><td>{r.step}</td><td>{r.body}</td></tr>
            ))}
          </tbody>
        </table>
        {sentList.length === 0 && <p>Nothing has gone out yet.</p>}
      </section>
    </main>
  );
}
