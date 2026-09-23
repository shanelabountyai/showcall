import { notFound } from 'next/navigation';
import { systemClock } from '@/src/clock';
import { usd } from '@/src/money';
import { closeBudget, CloseRefused, reconciliation } from '@/src/reconcile/reconcile';
import { hhmm, shortDay } from '@/src/time';
import { refusable } from '../refusable';

export const dynamic = 'force-dynamic';

const signed = (n: number, f: (n: number) => string = String) => (n > 0 ? `+${f(n)}` : n < 0 ? `−${f(-n)}` : f(0));
const min = (n: number | null) => (n == null ? '—' : `${signed(n)} min`);

/**
 * Post-event reconciliation (P1-5, D-025): where the show slipped, from the
 * GO log; the final attrition math; and the budget close, refused while
 * anything is outstanding, with each item named.
 */
export default async function Reconcile({ params, searchParams }: { params: Promise<{ eventId: string }>; searchParams: Promise<{ error?: string }> }) {
  const { eventId } = await params;
  const { error } = await searchParams;
  const view = await reconciliation(eventId, systemClock).catch((e) => { if (e instanceof CloseRefused) return null; throw e; });
  if (!view) notFound();
  const here = `/events/${eventId}/reconcile`;

  async function doClose(form: FormData) {
    'use server';
    await refusable(here, () => closeBudget(eventId, Number(form.get('expected')), systemClock), CloseRefused);
  }

  return (
    <main>
      <h1>{view.event.name}: reconciliation</h1>
      {error && <p role="alert">{error}</p>}

      <section aria-label="Planned vs actual">
        <h2>Planned vs. actual</h2>
        <p>Actual times come from the stage managers' GO log. Slip is actual minus planned. <em>Added</em> is how much later a row ran than the row before it, so it shows where the delay came from.</p>
        {view.cues.filter((g) => g.called).length === 0 && <p>No GO has been called yet.</p>}
        {view.cues.filter((g) => g.called).map((g) => (
          <article key={`${g.day}-${g.room}`} aria-label={`${g.room} ${g.day}`}>
            <h3>{g.room}, {shortDay(g.day)}</h3>
            <p>
              {g.called} of {g.rows.length} rows called · ended {min(g.finalSlipMin)}
              {g.worst && <> · most added: {g.worst.label} ({min(g.worst.addedMin)})</>}
            </p>
            <table>
              <thead><tr><th>Row</th><th>Planned</th><th>Actual</th><th>Slip</th><th>Added</th></tr></thead>
              <tbody>
                {g.rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.label}</td><td>{hhmm(r.plannedMin)}</td><td>{r.actualMin == null ? 'not called' : hhmm(r.actualMin)}</td>
                    <td>{min(r.slipMin)}</td><td>{min(r.addedMin)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>
        ))}
      </section>

      <section aria-label="Final attrition">
        <h2>Final attrition</h2>
        <p>The thresholds net against each other, so the hotel is owed the worst shortfall and not the sum of them.</p>
        {view.attrition.length === 0 && <p>No room blocks.</p>}
        <table>
          <thead><tr><th>Hotel</th><th>Worst shortfall</th><th>Owed</th><th>On the budget</th><th>Gap</th></tr></thead>
          <tbody>
            {view.attrition.map((a, i) => (
              <tr key={i}>
                <td>{a.hotel}</td><td>{a.shortfall} room-nights × {usd(a.rateCents)}</td><td>{usd(a.owedCents)}</td><td>{usd(a.postedCents)}</td>
                <td>{a.gapCents > 0 ? `${usd(a.gapCents)} owed, not posted` : a.gapCents < 0 ? `${usd(-a.gapCents)} over-accrued` : 'settled'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-label="Budget close">
        <h2>Budget close</h2>
        <p>
          Committed {usd(view.budget.total.committed)} · actual {usd(view.budget.total.actual)} · variance {signed(view.budget.total.variance, usd)} ·
          client-billable actual {usd(view.budget.total.billableActual)}
        </p>
        <table>
          <thead><tr><th>Category</th><th>Committed</th><th>Actual</th><th>Variance</th></tr></thead>
          <tbody>
            {view.budget.categories.map((c) => (
              <tr key={c.category}><td>{c.category}</td><td>{usd(c.committed)}</td><td>{usd(c.actual)}</td><td>{signed(c.variance, usd)}</td></tr>
            ))}
          </tbody>
        </table>
        {view.closed ? (
          <p>Closed {view.closed.takenAt.toISOString().slice(0, 10)} as snapshot {view.closed.number}. Every line is frozen.</p>
        ) : view.issues.length ? (
          <>
            <p>Before the budget can close:</p>
            <ul aria-label="Close blockers">{view.issues.map((i) => <li key={i}>{i}</li>)}</ul>
          </>
        ) : (
          <form action={doClose}>
            <input type="hidden" name="expected" value={view.budget.total.actual} />
            <button type="submit">Close the budget at {usd(view.budget.total.actual)} actual</button>
          </form>
        )}
      </section>
    </main>
  );
}
