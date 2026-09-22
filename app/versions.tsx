import type { Facts } from '@/src/content/facts';
import type { RuleResult } from '@/src/content/rules';

type Version = {
  id: string; number: number; filename: string; byteSize: number; facts: unknown; uploadedAt: Date;
  runs: { id: string; outcome: string; results: unknown; at: Date }[];
  comments: { id: string; side: string; body: string; requestsChanges: boolean; at: Date }[];
};

const stamp = (d: Date) => `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

/** A deliverable's versions, newest first: validation outcome, what to fix, and the comment thread. Shared by the portal and the producer view. */
export function Versions({ versions, href, commentForm }: { versions: Version[]; href?: (versionId: string) => string; commentForm: (versionId: string) => React.ReactNode }) {
  if (!versions.length) return <p>Nothing uploaded yet.</p>;
  return (
    <ol reversed>
      {versions.map((v) => {
        const run = v.runs[0];
        const facts = v.facts as Facts;
        const todo = ((run?.results ?? []) as RuleResult[]).filter((r) => r.status !== 'pass');
        return (
          <li key={v.id}>
            <strong>v{v.number}</strong> {href ? <a href={href(v.id)}>{v.filename}</a> : v.filename} · {mb(v.byteSize)} · {stamp(v.uploadedAt)} ·{' '}
            <strong>{run?.outcome.replace('_', ' ') ?? 'not validated'}</strong>
            {todo.length > 0 && (
              <ul>{todo.map((r) => <li key={r.ruleId}>{r.status === 'fail' ? 'Fix' : 'Needs review'}: {r.fix}</li>)}</ul>
            )}
            {facts.unembeddedFonts && <p>Fonts not embedded: {facts.unembeddedFonts.join(', ')}</p>}
            {v.comments.length > 0 && (
              <ul>{v.comments.map((c) => <li key={c.id}>{c.side}{c.requestsChanges && ' (requests changes)'}: {c.body} — {stamp(c.at)}</li>)}</ul>
            )}
            {commentForm(v.id)}
          </li>
        );
      })}
    </ol>
  );
}
