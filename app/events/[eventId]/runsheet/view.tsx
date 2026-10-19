'use client';

import { startTransition, useActionState, useEffect, useState, type FormEvent } from 'react';
import type { ProducerData } from '@/src/live/frames';
import type { Missed } from '@/src/live/stream';
import type { CueRowState, RunSheetRow } from '@/src/runsheet/cascade';
import type { Moved, Span } from '@/src/runsheet/cues';
import { hhmm, localNow, shortDay } from '@/src/time';
import { MissedList, useLive } from '../../../live-stream';
import { valuesOf, type EditState, type RowValues } from './edit-state';

type Action = (prev: EditState, form: FormData) => Promise<EditState>;
const span = (s: Span | null) => (s ? `${hhmm(s.startMin)}–${hhmm(s.endMin)} ${shortDay(s.day)}${s.room ? `, ${s.room}` : ''}` : 'off the sheet');

/** Rows in run-sheet order, each cue row editable; times come from the live frame. */
export function RunSheetView({ action, as }: { action: Action; as: string }) {
  const { state } = useLive<ProducerData>();
  const { sheet, cues } = state.data;
  const byId = new Map<string, CueRowState>(cues.map((c) => [c.id, c] as const));
  const labels = new Map<string, string>(sheet.rows.map((r) => [r.id, r.label] as const));
  const describe = (m: Missed) => {
    const what = m.kinds.filter((k) => !k.includes(':')).join(', ');
    const rows = m.kinds.filter((k) => k.startsWith('cue:')).map((k) => labels.get(k.slice(4)) ?? 'a removed cue');
    return rows.length ? `${what}: ${[...new Set(rows)].join(', ')}` : what;
  };
  return (
    <>
      <MissedList describe={describe} />
      {sheet.stale && <p role="alert">The agenda has published past this run sheet (built from v{sheet.agendaVersion}, newest v{sheet.currentVersion}). Rebase it from live mode.</p>}
      {sheet.problems.length > 0 && <ul aria-label="Problems">{sheet.problems.map((p) => <li key={p.message}>{p.message}</li>)}</ul>}
      {sheet.rows.length === 0 && <p>Nothing on the run sheet yet.</p>}
      {sheet.rows.map((r) => {
        const cue = byId.get(r.id);
        return (
          <article key={r.id} aria-label={`${r.label} · ${shortDay(r.day)}`} data-row-id={r.id} data-label={r.label} data-day={r.day} data-start={r.startMin} data-anchor={cue?.anchorId ?? ''}>
            <p>
              <span data-testid="times">{hhmm(r.startMin)}–{hhmm(r.endMin)}</span> {shortDay(r.day)} · {r.room} · {r.kind === 'session' ? <em>{r.label}</em> : <strong>{r.label}</strong>}
              {r.kind === 'session' && ' (session: moves by agenda publish and rebase)'}
            </p>
            {cue && <RowEditor key={cue.id} cue={cue} rows={sheet.rows} action={action} as={as} labels={labels} />}
          </article>
        );
      })}
    </>
  );
}

/**
 * One cue row's form. Opening it captures the row's revision: that is the rev
 * the commit names (D-039), so a change someone else lands while the form is
 * open is refused as RowChanged, never silently overwritten. What was typed
 * stays in the form on every answer.
 */
function RowEditor({ cue, rows, action, as, labels }: { cue: CueRowState; rows: RunSheetRow[]; action: Action; as: string; labels: Map<string, string> }) {
  const [open, setOpen] = useState(false);
  const [rev, setRev] = useState(cue.rev);
  const [v, setV] = useState<RowValues>(() => valuesOf(cue));
  const [answer, run, pending] = useActionState(action, { kind: 'idle' });
  const { timeZone } = useLive();
  const set = (k: keyof RowValues) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));

  useEffect(() => {
    if (answer.kind === 'preview') setRev(answer.rev);
    if (answer.kind === 'committed') setOpen(false);
  }, [answer]);

  if (!open) {
    return (
      <button type="button" onClick={() => { setRev(cue.rev); setV(valuesOf(cue)); setOpen(true); }}>
        Edit {cue.label}
      </button>
    );
  }
  const anchors = rows.filter((r) => r.id !== cue.id);
  const preview = answer.kind === 'preview' ? answer : null;
  // Submitted by hand, not through `<form action>`: React resets a form after an action, and a
  // reset puts a controlled <select> back on its first option. What was typed must survive (D-039).
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
    startTransition(() => run(form));
  };
  return (
    <form onSubmit={submit} aria-label={`Edit ${cue.label}`}>
      <input type="hidden" name="cueId" value={cue.id} />
      <input type="hidden" name="rev" value={rev} />
      <input type="hidden" name="as" value={as} />
      {preview && <input type="hidden" name="expected" value={preview.expected} />}
      {answer.kind === 'conflict' && <input type="hidden" name="currentRev" value={answer.currentRev} />}
      <label>Label <input name="label" value={v.label} onChange={set('label')} /></label>{' '}
      <label>Duration (min) <input name="durationMin" value={v.durationMin} onChange={set('durationMin')} size={4} /></label>{' '}
      <label><input type="radio" name="mode" value="fixed" checked={v.mode === 'fixed'} onChange={set('mode')} /> Fixed time</label>{' '}
      <label><input type="radio" name="mode" value="anchored" checked={v.mode === 'anchored'} onChange={set('mode')} /> Anchored</label>
      {v.mode === 'fixed' ? (
        <>
          {' '}<label>Day <input type="date" name="day" value={v.day} onChange={set('day')} /></label>
          {' '}<label>Start <input type="time" name="start" value={v.start} onChange={set('start')} /></label>
        </>
      ) : (
        <>
          {' '}<label>Anchor{' '}
            <select name="anchorId" value={v.anchorId} onChange={set('anchorId')}>
              <option value="">—</option>
              {anchors.map((r) => <option key={r.id} value={r.id}>{r.label} ({hhmm(r.startMin)} {shortDay(r.day)}, {r.room})</option>)}
            </select>
          </label>
          {' '}<label>Edge{' '}
            <select name="anchorEdge" value={v.anchorEdge} onChange={set('anchorEdge')}>
              <option value="start">start</option>
              <option value="end">end</option>
            </select>
          </label>
          {' '}<label>Offset (min) <input name="offsetMin" value={v.offsetMin} onChange={set('offsetMin')} size={4} /></label>
        </>
      )}
      <p>
        <button type="submit" name="intent" value="preview" disabled={pending}>Preview</button>{' '}
        <button type="submit" name="intent" value="commit" disabled={pending || !preview}>Commit</button>{' '}
        <label><input type="checkbox" name="issue" /> commit and issue changed sheets</label>{' '}
        <button type="button" onClick={() => setOpen(false)}>Close</button>
      </p>

      {preview && (
        <section aria-label="Preview">
          {preview.moved.length === 0 ? <p>Moves nothing.</p> : (
            <ul>{preview.moved.map((m: Moved) => <li key={m.id}>{labels.get(m.id) ?? m.id}: {span(m.from)} → {span(m.to)}</li>)}</ul>
          )}
          {preview.problems.length > 0 && <ul aria-label="Problems">{preview.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
          {preview.warnings.length > 0 && <ul aria-label="New work-rule warnings">{preview.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
        </section>
      )}
      {answer.kind === 'refused' && <p role="alert">{answer.message}</p>}
      {answer.kind === 'conflict' && (
        <section aria-label="Row changed">
          <p role="alert">{answer.message}{answer.at ? ` (at ${hhmm(localNow(new Date(answer.at), timeZone).min)})` : ''}.</p>
          <p data-testid="current-row">
            Now: {answer.current.label}, {answer.current.durationMin} min,{' '}
            {answer.current.mode === 'fixed' ? `fixed at ${answer.current.start} on ${answer.current.day}` : `${answer.current.offsetMin} min from ${labels.get(answer.current.anchorId) ?? 'its anchor'} ${answer.current.anchorEdge}`}
          </p>
          <button type="submit" name="intent" value="repreview" disabled={pending}>Re-preview against current</button>
        </section>
      )}
      {answer.kind === 'committed' && <p>Committed.{answer.issued && ` Call sheets: ${answer.issued}.`}</p>}
    </form>
  );
}
