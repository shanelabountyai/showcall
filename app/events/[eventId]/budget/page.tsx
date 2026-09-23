import { notFound } from 'next/navigation';
import { addLine, budgetToActuals, BudgetRefused, takeSnapshot, updateLine } from '@/src/budget/budget';
import { addVendor, complianceBoard, complianceOutbox, ComplianceRefused, KIND_LABEL, KINDS, recordDoc, sendComplianceNags, type ComplianceRow } from '@/src/budget/compliance';
import { systemClock } from '@/src/clock';
import { prisma } from '@/src/db';
import { BudgetCategory, type ComplianceKind } from '@/src/generated/prisma/enums';
import { parseCents, usd } from '@/src/money';
import { fromDbDate, shortDay } from '@/src/time';
import { refusable } from '../refusable';

export const dynamic = 'force-dynamic';

const stamp = (d: Date) => `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
const signed = (c: number) => (c > 0 ? `+${usd(c)}` : c < 0 ? `−${usd(-c)}` : usd(0));

/** Dollars as typed into integer cents, refused here rather than guessed at. */
function amount(form: FormData, field: string) {
  const c = parseCents(String(form.get(field) ?? ''));
  if (c == null) throw new BudgetRefused(`"${form.get(field)}" is not an amount — dollars and cents, like 2,400 or 18.50`);
  return c;
}

function reads(r: ComplianceRow) {
  if (r.state === 'ok') return r.expiresOn ? `in force to ${shortDay(r.expiresOn)}` : 'on file';
  const late = r.daysLeft! < 0 ? `${-r.daysLeft!}d late` : r.daysLeft === 0 ? 'today' : `${r.daysLeft}d left`;
  return `${r.state === 'overdue' ? 'OVERDUE' : r.state === 'due' ? 'due soon' : 'open'} — ${r.reason === 'missing' ? 'not on file' : 'lapses before the show'}, due ${shortDay(r.dueDay!)} (${late})`;
}

/**
 * Budget-to-actuals (P0-8) and vendor compliance. The ledger every later money
 * feature posts into (D-018); a line's vendor carries its compliance flag, so
 * spend with a vendor whose papers have lapsed is visible where the money is.
 */
export default async function Budget({ params, searchParams }: { params: Promise<{ eventId: string }>; searchParams: Promise<{ error?: string }> }) {
  const { eventId } = await params;
  const { error } = await searchParams;
  const board = await complianceBoard(eventId, systemClock).catch(() => null);
  if (!board) notFound();
  const here = `/events/${eventId}/budget`;
  const [view, vendors, nags] = await Promise.all([
    budgetToActuals(eventId),
    prisma.vendor.findMany({ orderBy: { name: 'asc' } }),
    complianceOutbox(eventId),
  ]);
  const worklist = board.rows.filter((r) => r.state !== 'ok');
  const flagged = new Set(worklist.map((r) => r.vendorId));
  const owed = board.rows.filter((r) => r.owed != null).length;

  async function doAddLine(form: FormData) {
    'use server';
    await refusable(here, () => addLine(eventId, {
      category: String(form.get('category')) as BudgetCategory, description: String(form.get('description') ?? ''),
      committedCents: amount(form, 'committed'), clientBillable: form.get('billable') === 'on', vendorId: String(form.get('vendorId') ?? '') || null,
    }), BudgetRefused);
  }

  async function doUpdate(form: FormData) {
    'use server';
    await refusable(here, () => updateLine(String(form.get('lineId')), { committedCents: amount(form, 'committed'), actualCents: amount(form, 'actual') }), BudgetRefused);
  }

  async function doSnapshot(form: FormData) {
    'use server';
    await refusable(here, () => takeSnapshot(eventId, String(form.get('label') ?? ''), systemClock), BudgetRefused);
  }

  async function doVendor(form: FormData) {
    'use server';
    await refusable(here, () => addVendor(String(form.get('name') ?? '')), ComplianceRefused);
  }

  async function doDoc(form: FormData) {
    'use server';
    await refusable(here, () => recordDoc(
      String(form.get('vendorId')), String(form.get('kind')) as ComplianceKind,
      String(form.get('receivedOn')), String(form.get('expiresOn') ?? '') || null,
    ), ComplianceRefused);
  }

  async function doNag() {
    'use server';
    await refusable(here, () => sendComplianceNags(eventId, systemClock), ComplianceRefused);
  }

  return (
    <main>
      <h1>{board.event.name} — budget</h1>
      {error && <p role="alert">{error}</p>}

      <section aria-label="Budget to actuals">
        <h2>Budget to actuals</h2>
        <p>
          Committed {usd(view.total.committed)} · actual {usd(view.total.actual)} · client-billable {usd(view.total.billableCommitted)} committed
          {view.latest && <> · {signed(view.sinceSnapshot!)} since snapshot {view.latest.number} ({view.latest.label})</>}
        </p>
        <table>
          <thead><tr><th>Category</th><th>Committed</th><th>Actual</th><th>Variance</th><th>Billable</th><th>Since snapshot</th></tr></thead>
          <tbody>
            {view.categories.map((c) => (
              <tr key={c.category}>
                <td>{c.category}</td><td>{usd(c.committed)}</td><td>{usd(c.actual)}</td><td>{signed(c.variance)}</td>
                <td>{usd(c.billableCommitted)}</td><td>{c.sinceSnapshot == null ? '—' : signed(c.sinceSnapshot)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {view.categories.length === 0 && <p>No budget lines yet.</p>}
      </section>

      <section aria-label="Budget lines">
        <h2>Lines</h2>
        <table>
          <thead><tr><th>Category</th><th>Line</th><th>Vendor</th><th>Billable</th><th>Committed / actual</th></tr></thead>
          <tbody>
            {view.lines.map((l) => (
              <tr key={l.id}>
                <td>{l.category}</td>
                <td>{l.description}</td>
                <td>{l.vendor?.name ?? '—'}{l.vendorId && flagged.has(l.vendorId) && ' · compliance outstanding'}</td>
                <td>{l.clientBillable ? 'client' : 'house'}</td>
                <td>
                  <form action={doUpdate}>
                    <input type="hidden" name="lineId" value={l.id} />
                    <input name="committed" defaultValue={(l.committedCents / 100).toFixed(2)} inputMode="decimal" required aria-label={`Committed for ${l.description}`} size={10} />{' '}
                    <input name="actual" defaultValue={(l.actualCents / 100).toFixed(2)} inputMode="decimal" required aria-label={`Actual for ${l.description}`} size={10} />{' '}
                    <button type="submit">Save</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <form action={doAddLine}>
          <select name="category" aria-label="Category" defaultValue="av">
            {Object.values(BudgetCategory).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>{' '}
          <input name="description" required aria-label="Description" placeholder="Description" />{' '}
          <select name="vendorId" aria-label="Vendor" defaultValue="">
            <option value="">No vendor</option>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>{' '}
          <input name="committed" required inputMode="decimal" aria-label="Committed" placeholder="Committed $" />{' '}
          <label><input name="billable" type="checkbox" defaultChecked /> client-billable</label>{' '}
          <button type="submit">Add line</button>
        </form>
      </section>

      <section aria-label="Snapshots">
        <h2>Snapshots</h2>
        <p>A snapshot freezes every line as it stands. It is never rewritten; the view above compares against the latest.</p>
        <form action={doSnapshot}>
          <input name="label" required aria-label="Snapshot label" placeholder="Label, e.g. client v2" />{' '}
          <button type="submit">Take snapshot</button>
        </form>
        <ul>
          {view.snapshots.map((s) => (
            <li key={s.id}>#{s.number} {s.label} — {stamp(s.takenAt)} · committed {usd(s.committedCents)} · actual {usd(s.actualCents)} · billable {usd(s.billableCents)}</li>
          ))}
        </ul>
      </section>

      <section aria-label="Compliance worklist">
        <h2>Vendor compliance</h2>
        <p>Every vendor with a line on this event needs a W-9 on file and a certificate of insurance in force through {shortDay(fromDbDate(board.event.endDate))}.</p>
        <form action={doNag}>
          <button type="submit" disabled={owed === 0}>Send due nags ({owed})</button>
        </form>
        <table>
          <thead><tr><th>Vendor</th><th>Document</th><th>Status</th><th>Last nag</th></tr></thead>
          <tbody>
            {board.rows.map((r) => (
              <tr key={`${r.vendorId}-${r.kind}`}>
                <td>{r.vendor}</td><td>{KIND_LABEL[r.kind]}</td><td>{reads(r)}</td>
                <td>{r.lastSent ? `step ${r.lastSent.step} · ${stamp(r.lastSent.sentAt)}` : 'never'}{r.owed != null && ' · one owed'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {board.rows.length === 0 && <p>No vendor has a line on this event yet.</p>}

        <h3>Record a document</h3>
        <form action={doDoc}>
          <select name="vendorId" aria-label="Document vendor" required>
            {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>{' '}
          <select name="kind" aria-label="Document kind" defaultValue="coi">
            {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>{' '}
          <label>Received <input name="receivedOn" type="date" required /></label>{' '}
          <label>Expires <input name="expiresOn" type="date" /></label>{' '}
          <button type="submit">Record</button>
        </form>

        <h3>Add a vendor</h3>
        <form action={doVendor}>
          <input name="name" required aria-label="Vendor name" placeholder="Vendor name" />{' '}
          <button type="submit">Add vendor</button>
        </form>
      </section>

      <section aria-label="Nag outbox">
        <h2>Nag outbox</h2>
        <table>
          <thead><tr><th>Sent</th><th>Vendor</th><th>Step</th><th>Message</th></tr></thead>
          <tbody>
            {nags.map((n) => <tr key={n.id}><td>{stamp(n.sentAt)}</td><td>{n.vendor.name}</td><td>{n.step}</td><td>{n.body}</td></tr>)}
          </tbody>
        </table>
        {nags.length === 0 && <p>Nothing has gone out yet.</p>}
      </section>
    </main>
  );
}
