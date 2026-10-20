'use client';

import type { CallSheetRow } from '@/src/callsheet/callsheet';
import type { CrewData } from '@/src/live/frames';
import { hhmm, shortDay } from '@/src/time';
import { useLive } from '../../../live-stream';

const stamp = (d: Date | string) => `${new Date(d).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
const when = (r: CallSheetRow) => `${hhmm(r.startMin)}–${hhmm(r.endMin)} ${shortDay(r.day)}, ${r.room}`;

/**
 * The role's latest issued sheet, from its own crew stream (D-040, D-041): a
 * re-issue appears without reload; nothing else ever reaches this stream.
 */
export function CrewIssue({ confirm }: { confirm: (form: FormData) => Promise<void> }) {
  const { state } = useLive<CrewData>();
  const issue = state.data.issue;
  if (!issue) return <p>No call sheet has been issued to you yet.</p>;
  const days = Map.groupBy(issue.sheet.rows, (r) => r.day);
  const c = issue.changes;
  const changes = c ? [
    ...c.added.map((r) => `Added: ${r.label}, ${when(r)}`),
    ...c.removed.map((r) => `Removed: ${r.label}, was ${when(r)}`),
    ...c.changed.map(({ from, to }) => `Changed: ${to.label}, now ${when(to)} (was ${when(from)})`),
    ...(c.reportTo ? [`Report to changed (was: ${c.reportTo.from || 'not set'})`] : []),
  ] : [];
  return (
    <>
      <p data-testid="issue-number">Issue {issue.number} · issued {stamp(issue.issuedAt)}</p>
      {issue.confirmedAt
        ? <p role="status">You confirmed receipt of issue {issue.number} at {stamp(issue.confirmedAt)}.</p>
        : (
          <form action={confirm}>
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
      {[...days].map(([day, rows]) => (
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
  );
}
