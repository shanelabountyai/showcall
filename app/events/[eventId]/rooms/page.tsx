import { BudgetRefused } from '@/src/budget/budget';
import { notFound } from 'next/navigation';
import { addThreshold, AttritionRefused, attritionBoard, createBlock, decide, framing, reserve, type Assessment } from '@/src/attrition/attrition';
import { systemClock } from '@/src/clock';
import { prisma } from '@/src/db';
import { GuestKind, type AttritionChoice } from '@/src/generated/prisma/enums';
import { parseCents, usd } from '@/src/money';
import { daysBetween, fromDbDate, shortDay } from '@/src/time';
import { refusable } from '../refusable';

export const dynamic = 'force-dynamic';

const STATE: Record<Assessment['state'], string> = {
  met: 'met', on_pace: 'on pace', accepted: 'short — accepted on the budget', watch: 'short at this pace', alert: 'ALERT', owed: 'OWED — not on the budget',
};
const perWeek = (n: number | null) => (n == null ? '—' : n.toFixed(1));

/**
 * Room blocks and attrition (P0-5). Pickup against each dated threshold,
 * projected at the pace so far; an open shortfall inside the alert window is
 * framed as the decision it is, and either answer is logged. Accepting posts
 * the exposure to the budget.
 */
export default async function Rooms({ params, searchParams }: { params: Promise<{ eventId: string }>; searchParams: Promise<{ error?: string }> }) {
  const { eventId } = await params;
  const { error } = await searchParams;
  const board = await attritionBoard(eventId, systemClock).catch(() => null);
  if (!board) notFound();
  const here = `/events/${eventId}/rooms`;
  const [vendors, speakers, staff] = await Promise.all([
    prisma.vendor.findMany({ orderBy: { name: 'asc' } }),
    prisma.speaker.findMany({ where: { eventId }, orderBy: { name: 'asc' } }),
    prisma.staff.findMany({ orderBy: { name: 'asc' } }),
  ]);

  async function doDecide(form: FormData) {
    'use server';
    await refusable(here, () => decide(String(form.get('thresholdId')), String(form.get('choice')) as AttritionChoice, Number(form.get('expected')), systemClock), AttritionRefused, BudgetRefused);
  }

  async function doBlock(form: FormData) {
    'use server';
    await refusable(here, () => {
      const rate = parseCents(String(form.get('rate') ?? ''));
      if (rate == null) throw new AttritionRefused(`"${form.get('rate')}" is not a nightly rate — dollars and cents, like 240`);
      const first = String(form.get('firstNight')), last = String(form.get('lastNight'));
      if (!first || !last || last < first) throw new AttritionRefused('The last night cannot come before the first');
      return createBlock(eventId, {
        hotelId: String(form.get('hotelId')), rateCents: rate,
        contractedOn: String(form.get('contractedOn')), cutoffOn: String(form.get('cutoffOn')),
        nights: daysBetween(first, last).map((night) => ({ night, rooms: Number(form.get('rooms')) })),
      });
    }, AttritionRefused);
  }

  async function doThreshold(form: FormData) {
    'use server';
    await refusable(here, () => addThreshold(String(form.get('blockId')), String(form.get('dueOn')), Number(form.get('percent'))), AttritionRefused);
  }

  async function doReserve(form: FormData) {
    'use server';
    await refusable(here, () => reserve(String(form.get('blockId')), {
      kind: String(form.get('kind')) as GuestKind, guest: String(form.get('guest') ?? ''),
      speakerId: String(form.get('speakerId') ?? '') || null, staffId: String(form.get('staffId') ?? '') || null,
      rooms: Number(form.get('rooms')), arriveOn: String(form.get('arriveOn')), departOn: String(form.get('departOn')),
    }, systemClock), AttritionRefused);
  }

  return (
    <main>
      <h1>{board.event.name} — room blocks</h1>
      {error && <p role="alert">{error}</p>}

      <section aria-label="Attrition alerts">
        <h2>Decisions due</h2>
        {board.alerts.length === 0 && <p>No attrition decision is due.</p>}
        <ul>
          {board.alerts.map(({ block, a, says }) => (
            <li key={a.id}>
              <strong>{block.hotel.name}, {a.percent}% by {shortDay(a.dueOn)}:</strong> {says}.{' '}
              {a.release != null && a.release > 0 && (
                <form action={doDecide} style={{ display: 'inline' }}>
                  <input type="hidden" name="thresholdId" value={a.id} /><input type="hidden" name="choice" value="release" /><input type="hidden" name="expected" value={a.release} />
                  <button type="submit">Release {a.release}</button>
                </form>
              )}{' '}
              <form action={doDecide} style={{ display: 'inline' }}>
                <input type="hidden" name="thresholdId" value={a.id} /><input type="hidden" name="choice" value="accept" /><input type="hidden" name="expected" value={a.exposureCents} />
                <button type="submit">Accept {usd(a.exposureCents)}</button>
              </form>
            </li>
          ))}
        </ul>
      </section>

      {board.blocks.map((v) => {
        const b = v.block;
        return (
          <section key={b.id} aria-label={`Block at ${b.hotel.name}`}>
            <h2>{b.hotel.name} — {usd(b.rateCents)} a night</h2>
            <p>
              Signed {shortDay(v.contract.contractedOn)} · cutoff {shortDay(v.contract.cutoffOn)}
              {v.pastCutoff ? ' (passed — unsold rooms went back to the hotel)' : ''} · pickup by guest:{' '}
              {[...v.byKind].map(([k, n]) => `${k} ${n}`).join(', ') || 'none yet'}
            </p>
            <table>
              <thead><tr><th>Threshold</th><th>Contracted</th><th>Required</th><th>Picked up</th><th>Projected</th><th>Pace / needed per week</th><th>Short</th><th>State</th><th>Decision</th></tr></thead>
              <tbody>
                {v.thresholds.map((a) => (
                  <tr key={a.id}>
                    <td>{a.percent}% by {shortDay(a.dueOn)} ({a.daysLeft < 0 ? `${-a.daysLeft}d ago` : `${a.daysLeft}d`})</td>
                    <td>{a.contracted}</td><td>{a.required}</td><td>{a.pickup}</td><td>{a.projected}</td>
                    <td>{perWeek(a.pacePerWeek)} / {perWeek(a.neededPerWeek)}</td>
                    <td>{a.shortfall ? `${a.shortfall} · ${usd(a.shortfall * b.rateCents)}` : '—'}</td>
                    <td>{STATE[a.state]}</td>
                    <td>{framing(a) ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <form action={doThreshold}>
              <input type="hidden" name="blockId" value={b.id} />
              <label>Threshold <input name="percent" type="number" min={1} max={100} required aria-label="Percent" size={4} />%</label>{' '}
              <label>by <input name="dueOn" type="date" required /></label>{' '}
              <button type="submit">Add threshold</button>
            </form>

            <h3>Nights</h3>
            <table>
              <thead><tr><th>Night</th><th>Contracted</th><th>Released</th><th>Booked</th><th>Unsold</th></tr></thead>
              <tbody>
                {v.nights.map((n) => <tr key={n.night}><td>{shortDay(n.night)}</td><td>{n.contracted}</td><td>{n.released}</td><td>{n.booked}</td><td>{n.unsold}</td></tr>)}
              </tbody>
            </table>

            <h3>Rooms booked</h3>
            <ul>
              {b.reservations.map((r) => (
                <li key={r.id}>{r.guest} ({r.kind}) — {r.rooms} room{r.rooms === 1 ? '' : 's'}, {shortDay(fromDbDate(r.arriveOn))} to {shortDay(fromDbDate(r.departOn))}</li>
              ))}
            </ul>
            {!v.pastCutoff && (
              <form action={doReserve}>
                <input type="hidden" name="blockId" value={b.id} />
                <select name="kind" aria-label="Guest kind" defaultValue="attendee">
                  {Object.values(GuestKind).map((k) => <option key={k} value={k}>{k}</option>)}
                </select>{' '}
                <input name="guest" aria-label="Guest" placeholder="Guest (attendee, VIP)" />{' '}
                <select name="speakerId" aria-label="Speaker" defaultValue=""><option value="">— speaker —</option>{speakers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>{' '}
                <select name="staffId" aria-label="Staff" defaultValue=""><option value="">— staff —</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>{' '}
                <input name="rooms" type="number" min={1} defaultValue={1} aria-label="Rooms" size={4} />{' '}
                <label>Arrive <input name="arriveOn" type="date" required /></label>{' '}
                <label>Depart <input name="departOn" type="date" required /></label>{' '}
                <button type="submit">Book into block</button>
              </form>
            )}

            <h3>Decision log</h3>
            <ul>
              {b.decisions.map((d) => (
                <li key={d.id}>
                  {shortDay(fromDbDate(d.decidedOn))} — {d.threshold.percent}% by {shortDay(fromDbDate(d.threshold.dueOn))}:{' '}
                  {d.choice === 'release' ? `released ${d.roomNights} room-nights` : `accepted ${usd(d.exposureCents)} (${d.roomNights} room-nights) onto the budget`}
                </li>
              ))}
            </ul>
            {b.decisions.length === 0 && <p>No decisions yet.</p>}
          </section>
        );
      })}

      <section aria-label="New block">
        <h2>Add a block</h2>
        <form action={doBlock}>
          <select name="hotelId" aria-label="Hotel" required>{vendors.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>{' '}
          <input name="rate" required inputMode="decimal" aria-label="Nightly rate" placeholder="Rate $" size={8} />{' '}
          <input name="rooms" type="number" min={1} required aria-label="Rooms per night" placeholder="Rooms" size={5} />{' '}
          <label>Nights <input name="firstNight" type="date" required /></label> to <input name="lastNight" type="date" required aria-label="Last night" />{' '}
          <label>Signed <input name="contractedOn" type="date" required /></label>{' '}
          <label>Cutoff <input name="cutoffOn" type="date" required /></label>{' '}
          <button type="submit">Add block</button>
        </form>
        <p>Hotels are vendors — add one on the budget page. This form enters the same room count every night; a contract with smaller shoulder nights is entered per night through the seed or the module.</p>
      </section>
    </main>
  );
}
