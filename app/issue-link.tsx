'use client';

import { useActionState } from 'react';

export type Issued = { url: string; for: string } | { error: string } | null;

/**
 * Issue (or reissue) a portal link and show it once (SEC-04). The raw token
 * comes back as the action's state and is rendered here only — never put in
 * a URL, so it stays out of history, logs and the Referer header.
 */
export function IssueLink({ action, fields, label }: { action: (prev: Issued, form: FormData) => Promise<Issued>; fields: Record<string, string>; label: string }) {
  const [state, run, pending] = useActionState(action, null);
  return (
    <form action={run}>
      {Object.entries(fields).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
      <button type="submit" disabled={pending}>{label}</button>
      {state && 'error' in state && <p role="alert">{state.error}</p>}
      {state && 'url' in state && (
        <p role="status">
          Portal link for {state.for} — copy it now, it will not be shown again: <code>{state.url}</code>{' '}
          <a href={state.url} rel="noreferrer">open</a>
        </p>
      )}
    </form>
  );
}
