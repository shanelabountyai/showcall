import { notFound } from 'next/navigation';
import { systemClock } from '@/src/clock';
import { prisma } from '@/src/db';
import { BudgetCategory, Inclusion, LineBasis } from '@/src/generated/prisma/enums';
import { parseCents, usd } from '@/src/money';
import { addSchemaLine, advanceContract, award, createRfp, enterQuote, rfpBoard, RfpRefused, setQuantity, setRegistration } from '@/src/rfp/rfp';
import { fromDbDate, shortDay } from '@/src/time';
import { refusable } from '../refusable';

export const dynamic = 'force-dynamic';

const BASIS: Record<LineBasis, string> = { per_head: 'per head', each: 'each', flat: 'flat' };
const CELL: Record<Inclusion, string> = { included: 'included', excluded: 'EXCLUDED', extra: 'extra' };
const GAP = { background: '#fde2e1' };

const dollars = (form: FormData, key: string, what: string) => {
  const c = parseCents(String(form.get(key) ?? ''));
  if (c == null) throw new RfpRefused(`"${form.get(key)}" is not ${what} — dollars and cents, like 72 or 1,250.00`);
  return c;
};

/**
 * RFPs (P0-6). Registration sets the per-head quantity; each RFP's quotes are
 * normalized line by line and compared — totals, per head, the inclusion
 * matrix with gaps highlighted. Awarding posts the total to the budget.
 */
export default async function Rfps({ params, searchParams }: { params: Promise<{ eventId: string }>; searchParams: Promise<{ error?: string }> }) {
  const { eventId } = await params;
  const { error } = await searchParams;
  const board = await rfpBoard(eventId, systemClock).catch(() => null);
  if (!board) notFound();
  const here = `/events/${eventId}/rfps`;
  const [vendors, schema] = await Promise.all([
    prisma.vendor.findMany({ orderBy: { name: 'asc' } }),
    prisma.lineSchema.findMany({ orderBy: [{ category: 'asc' }, { position: 'asc' }] }),
  ]);

  async function doRegistration(form: FormData) {
    'use server';
    await refusable(here, () => setRegistration(eventId, String(form.get('type') ?? ''), Number(form.get('registered')), Number(form.get('capacity'))), RfpRefused);
  }
  async function doSchema(form: FormData) {
    'use server';
    await refusable(here, () => addSchemaLine(String(form.get('category')) as BudgetCategory, String(form.get('label') ?? ''), String(form.get('basis')) as LineBasis), RfpRefused);
  }
  async function doRfp(form: FormData) {
    'use server';
    await refusable(here, () => createRfp(eventId, String(form.get('category')) as BudgetCategory, String(form.get('title') ?? ''), systemClock), RfpRefused);
  }
  async function doQuantity(form: FormData) {
    'use server';
    await refusable(here, () => setQuantity(String(form.get('itemId')), Number(form.get('quantity'))), RfpRefused);
  }
  async function doQuote(form: FormData) {
    'use server';
    await refusable(here, async () => {
      const itemIds = form.getAll('itemId').map(String);
      return enterQuote(String(form.get('rfpId')), {
        vendorId: String(form.get('vendorId')), baseCents: dollars(form, 'base', 'a base price'),
        basePerHead: form.get('perHead') === 'on', receivedOn: String(form.get('receivedOn')),
        lines: itemIds.map((itemId) => {
          const inclusion = String(form.get(`inc-${itemId}`)) as Inclusion;
          return { itemId, inclusion, unitCents: inclusion === 'extra' ? dollars(form, `unit-${itemId}`, 'an extra cost') : null };
        }),
      });
    }, RfpRefused);
  }
  async function doAward(form: FormData) {
    'use server';
    await refusable(here, () => award(String(form.get('quoteId')), Number(form.get('expected')), systemClock), RfpRefused);
  }
  async function doAdvance(form: FormData) {
    'use server';
    await refusable(here, () => advanceContract(String(form.get('contractId')), systemClock), RfpRefused);
  }

  return (
    <main>
      <h1>{board.event.name} — RFPs</h1>
      {error && <p role="alert">{error}</p>}

      <section aria-label="Registration">
        <h2>Registration — {board.headcount} registered</h2>
        <p>The per-head quantity on every RFP line is this total.</p>
        <table>
          <thead><tr><th>Attendee type</th><th>Registered</th><th>Capacity</th><th></th></tr></thead>
          <tbody>
            {board.registrations.map((r) => (
              <tr key={r.id}>
                <td>{r.attendeeType}</td><td>{r.registered}</td><td>{r.capacity}</td>
                <td>{r.registered > r.capacity ? `over capacity by ${r.registered - r.capacity}` : r.registered === r.capacity ? 'full' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <form action={doRegistration}>
          <input name="type" required aria-label="Attendee type" placeholder="Attendee type" />{' '}
          <input name="registered" type="number" min={0} required aria-label="Registered" placeholder="Registered" size={6} />{' '}
          <input name="capacity" type="number" min={0} required aria-label="Capacity" placeholder="Capacity" size={6} />{' '}
          <button type="submit">Set counts</button>
        </form>
      </section>

      {board.rfps.map(({ rfp, comparison: c }) => {
        const awarded = rfp.contract;
        return (
          <section key={rfp.id} aria-label={`RFP ${rfp.title}`}>
            <h2>{rfp.title} ({rfp.category})</h2>
            {awarded && (
              <div aria-label="Contract">
                <p>
                  <strong>Awarded to {awarded.quote.vendor.name}</strong> at {usd(awarded.committedCents)} ({awarded.headcount} registered) — committed on the budget.
                  Contract: {awarded.status}.{' '}
                  {awarded.status !== 'signed' && (
                    <form action={doAdvance} style={{ display: 'inline' }}>
                      <input type="hidden" name="contractId" value={awarded.id} />
                      <button type="submit">Mark {awarded.status === 'awarded' ? 'sent' : 'signed'}</button>
                    </form>
                  )}
                </p>
                {awarded.papers.length > 0 && <p style={GAP}>Compliance at award: {awarded.papers.join('; ')}.</p>}
                {awarded.gaps.length > 0 && <p style={GAP}>Not in this quote — still to source: {awarded.gaps.join(', ')}.</p>}
              </div>
            )}

            {c.quotes.length === 0 ? <p>No quotes yet.</p> : (
              <table aria-label="Comparison">
                <thead>
                  <tr><th>Line</th><th>Qty</th>{c.quotes.map((q) => <th key={q.id}>{q.vendor}</th>)}</tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Base price</td><td></td>
                    {c.quotes.map((q) => <td key={q.id}>{usd(q.baseCents)}{q.basePerHead ? ` × ${c.headcount}` : ' flat'} = {usd(q.baseTotalCents)}</td>)}
                  </tr>
                  {c.rows.map((row, i) => (
                    <tr key={row.item.id} style={row.gap ? GAP : undefined}>
                      <td>{row.item.label} ({BASIS[row.item.basis]}){row.gap ? ' — gap' : ''}</td>
                      <td>{row.quantity}</td>
                      {c.quotes.map((q) => {
                        const cell = q.cells[i]!;
                        return (
                          <td key={q.id} style={cell.inclusion === 'excluded' ? { ...GAP, fontWeight: 'bold' } : undefined}>
                            {CELL[cell.inclusion]}{cell.inclusion === 'extra' && ` ${usd(cell.unitCents!)} × ${row.quantity} = ${usd(cell.lineCents)}`}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  <tr>
                    <th>Total</th><td></td>
                    {c.quotes.map((q) => (
                      <td key={q.id}>
                        <strong>{usd(q.totalCents)}</strong>{q.id === c.lowestComplete ? ' — lowest complete' : ''}
                        {q.gaps.length > 0 && <div style={GAP}>excludes {q.gaps.join(', ')}</div>}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <th>Per head</th><td></td>
                    {c.quotes.map((q) => <td key={q.id}>{q.perHeadCents == null ? '—' : usd(q.perHeadCents)}</td>)}
                  </tr>
                  {!awarded && (
                    <tr>
                      <td></td><td></td>
                      {c.quotes.map((q) => (
                        <td key={q.id}>
                          <form action={doAward}>
                            <input type="hidden" name="quoteId" value={q.id} /><input type="hidden" name="expected" value={q.totalCents} />
                            <button type="submit">Award {q.vendor} {usd(q.totalCents)}</button>
                          </form>
                        </td>
                      ))}
                    </tr>
                  )}
                </tbody>
              </table>
            )}

            {!awarded && (
              <>
                <h3>Quantities</h3>
                <ul>
                  {rfp.items.filter((it) => it.basis === 'each').map((it) => (
                    <li key={it.id}>
                      <form action={doQuantity}>
                        <input type="hidden" name="itemId" value={it.id} />
                        <label>{it.label} <input name="quantity" type="number" min={1} defaultValue={it.quantity ?? 1} size={4} /></label>{' '}
                        <button type="submit">Set</button>
                      </form>
                    </li>
                  ))}
                </ul>

                <h3>Enter a quote</h3>
                <form action={doQuote}>
                  <input type="hidden" name="rfpId" value={rfp.id} />
                  <select name="vendorId" aria-label="Vendor" required>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>{' '}
                  <input name="base" required inputMode="decimal" aria-label="Base price" placeholder="Base $" size={10} />{' '}
                  <label><input name="perHead" type="checkbox" /> per head</label>{' '}
                  <label>Received <input name="receivedOn" type="date" required defaultValue={board.today} /></label>
                  <table>
                    <tbody>
                      {rfp.items.map((it) => (
                        <tr key={it.id}>
                          <td>{it.label} ({BASIS[it.basis]})<input type="hidden" name="itemId" value={it.id} /></td>
                          <td>
                            <select name={`inc-${it.id}`} aria-label={`${it.label} inclusion`} defaultValue="included">
                              {Object.values(Inclusion).map((x) => <option key={x} value={x}>{x}</option>)}
                            </select>
                          </td>
                          <td><input name={`unit-${it.id}`} inputMode="decimal" aria-label={`${it.label} extra cost`} placeholder="extra $ per unit" size={10} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <button type="submit">Enter quote</button>
                </form>
                <p>A revised quote from the same vendor replaces the last one. Received: {rfp.quotes.map((q) => `${q.vendor.name} ${shortDay(fromDbDate(q.receivedOn))}`).join(', ') || 'none'}.</p>
              </>
            )}
          </section>
        );
      })}

      <section aria-label="New RFP">
        <h2>Open an RFP</h2>
        <form action={doRfp}>
          <select name="category" aria-label="Category">{Object.values(BudgetCategory).map((x) => <option key={x} value={x}>{x}</option>)}</select>{' '}
          <input name="title" required aria-label="Title" placeholder="Title" />{' '}
          <button type="submit">Open RFP</button>
        </form>
      </section>

      <section aria-label="Line-item schema">
        <h2>Line-item schemas</h2>
        <p>An RFP copies its category&apos;s lines when it opens; changing a schema never rewrites an open RFP.</p>
        <ul>
          {Object.values(BudgetCategory).filter((cat) => schema.some((s) => s.category === cat)).map((cat) => (
            <li key={cat}><strong>{cat}:</strong> {schema.filter((s) => s.category === cat).map((s) => `${s.label} (${BASIS[s.basis]})`).join(', ')}</li>
          ))}
        </ul>
        <form action={doSchema}>
          <select name="category" aria-label="Schema category">{Object.values(BudgetCategory).map((x) => <option key={x} value={x}>{x}</option>)}</select>{' '}
          <input name="label" required aria-label="Line label" placeholder="Line" />{' '}
          <select name="basis" aria-label="Basis">{Object.values(LineBasis).map((x) => <option key={x} value={x}>{BASIS[x]}</option>)}</select>{' '}
          <button type="submit">Add line</button>
        </form>
      </section>
    </main>
  );
}
