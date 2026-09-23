import { notFound } from 'next/navigation';
import { prisma } from '@/src/db';
import type { LoadKind } from '@/src/generated/prisma/enums';
import { CascadeBlocked } from '@/src/runsheet/cascade';
import { addDays, daysBetween, fromDbDate, fromHhmm, hhmm, inputTime, shortDay } from '@/src/time';
import { loadPlan, planLoad, saveVenue, setEventVenue, VenueRefused } from '@/src/venue/venue';
import { refusable } from '../refusable';

export const dynamic = 'force-dynamic';

const num = (form: FormData, k: string) => Number(form.get(k) || 0);
const hours = (min: number) => `${Math.floor(min / 60)}h${min % 60 ? ` ${min % 60}m` : ''}`;

/**
 * Venue profile and load plan (P0-8, D-024). The house facts are data the
 * cascade checks every load slot against; an edit that would break a slot
 * already planned is refused, naming it.
 */
export default async function Venue({ params, searchParams }: { params: Promise<{ eventId: string }>; searchParams: Promise<{ error?: string }> }) {
  const { eventId } = await params;
  const { error } = await searchParams;
  const plan = await loadPlan(eventId).catch(() => null);
  if (!plan) notFound();
  const { event, venue, rooms, loads } = plan;
  const vendors = await prisma.vendor.findMany({ orderBy: { name: 'asc' } });
  const days = daysBetween(addDays(fromDbDate(event.startDate), -1), fromDbDate(event.endDate));
  const here = `/events/${eventId}/venue`;

  async function doProfile(form: FormData) {
    'use server';
    await refusable(here, async () => {
      const input = {
        name: String(form.get('name') ?? ''), dockBays: num(form, 'dockBays'), dockOpenMin: fromHhmm(String(form.get('dockOpen'))),
        dockCloseMin: String(form.get('dockClose')) === '00:00' ? 1440 : fromHhmm(String(form.get('dockClose'))),
        maxTruckFt: num(form, 'maxTruckFt'), wifiMbps: num(form, 'wifiMbps'), unionHouse: form.get('unionHouse') === 'on', minCallMin: num(form, 'minCallHours') * 60,
      };
      if (venue) return saveVenue(input, venue.id);
      const created = await saveVenue(input);
      return setEventVenue(eventId, created.id);
    }, VenueRefused, CascadeBlocked);
  }

  async function doLoad(form: FormData) {
    'use server';
    await refusable(here, () => planLoad(eventId, {
      kind: String(form.get('kind')) as LoadKind, vendorId: String(form.get('vendorId')), roomId: String(form.get('roomId')),
      durationMin: num(form, 'hours') * 60, trucks: num(form, 'trucks'), truckFt: num(form, 'truckFt'),
      rigPoints: num(form, 'rigPoints'), rigPointLbs: num(form, 'rigPointLbs'), powerAmps: num(form, 'powerAmps'), ceilingFt: num(form, 'ceilingFt'),
      when: { day: String(form.get('day')), startMin: fromHhmm(String(form.get('start'))), anchorId: null, anchorEdge: null, offsetMin: 0 },
    }), VenueRefused, CascadeBlocked);
  }

  return (
    <main>
      <h1>{event.name} — venue</h1>
      {error && <p role="alert">{error}</p>}

      <section aria-label="Venue profile">
        <h2>{venue ? venue.name : 'No venue profile yet'}</h2>
        {venue && (
          <p>
            Dock: {venue.dockBays} bays, open {hhmm(venue.dockOpenMin)}–{hhmm(venue.dockCloseMin)}, trucks up to {venue.maxTruckFt} ft · Wifi {venue.wifiMbps} Mbps ·{' '}
            {venue.unionHouse ? `Union house: ${hours(venue.minCallMin)} minimum call` : 'Non-union house'}
          </p>
        )}
        <form action={doProfile}>
          <input name="name" aria-label="Venue name" defaultValue={venue?.name} required />{' '}
          <label>Bays <input type="number" name="dockBays" min={1} defaultValue={venue?.dockBays ?? 1} /></label>{' '}
          <label>Dock opens <input type="time" name="dockOpen" defaultValue={inputTime(venue?.dockOpenMin ?? 360)} /></label>{' '}
          <label>Dock closes <input type="time" name="dockClose" defaultValue={inputTime((venue?.dockCloseMin ?? 1380) % 1440)} /></label>{' '}
          <label>Max truck ft <input type="number" name="maxTruckFt" min={1} defaultValue={venue?.maxTruckFt ?? 53} /></label>{' '}
          <label>Wifi Mbps <input type="number" name="wifiMbps" min={0} defaultValue={venue?.wifiMbps ?? 0} /></label>{' '}
          <label><input type="checkbox" name="unionHouse" defaultChecked={venue?.unionHouse} /> Union house</label>{' '}
          <label>Minimum call h <input type="number" name="minCallHours" min={0} step={0.5} defaultValue={(venue?.minCallMin ?? 0) / 60} /></label>{' '}
          <button>{venue ? 'Save profile' : 'Create profile'}</button>
        </form>
      </section>

      <section aria-label="Rooms">
        <h2>What each room can take</h2>
        <table>
          <thead><tr><th>Room</th><th>Ceiling</th><th>Rigging</th><th>Power</th></tr></thead>
          <tbody>
            {rooms.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td><td>{r.ceilingFt === null ? 'open air' : `${r.ceilingFt} ft`}</td>
                <td>{r.rigPoints ? `${r.rigPoints} points × ${r.rigPointLbs} lb` : 'none'}</td><td>{r.powerAmps} A</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-label="Load plan">
        <h2>Load plan</h2>
        {loads.length === 0 && <p>No load slots planned.</p>}
        <table>
          <thead><tr><th>Slot</th><th>When</th><th>Where</th><th>Dock</th><th>Needs</th><th>Billed</th></tr></thead>
          <tbody>
            {loads.map((l) => (
              <tr key={l.id}>
                <td>{l.row.label}</td>
                <td>{shortDay(l.row.day)} {hhmm(l.row.startMin)}–{hhmm(l.row.endMin)}</td>
                <td>{l.row.room}</td>
                <td>{l.trucks} × {l.truckFt} ft</td>
                <td>{[l.rigPoints && `${l.rigPoints} points × ${l.rigPointLbs} lb`, l.powerAmps && `${l.powerAmps} A`, l.ceilingFt && `${l.ceilingFt} ft trim`].filter(Boolean).join(', ') || '—'}</td>
                <td>{hours(l.billedMin)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <form action={doLoad}>
          <select name="kind" aria-label="Kind"><option value="load_in">Load-in</option><option value="load_out">Load-out</option></select>{' '}
          <select name="vendorId" aria-label="Vendor" required>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select>{' '}
          <select name="roomId" aria-label="Room">{rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>{' '}
          <select name="day" aria-label="Day">{days.map((d) => <option key={d} value={d}>{shortDay(d)}</option>)}</select>{' '}
          <input type="time" name="start" required aria-label="Start" />{' '}
          <label>Hours <input type="number" name="hours" min={0.5} step={0.5} defaultValue={2} /></label>{' '}
          <label>Trucks <input type="number" name="trucks" min={1} defaultValue={1} /></label>{' '}
          <label>Truck ft <input type="number" name="truckFt" min={1} defaultValue={26} /></label>{' '}
          <label>Rig points <input type="number" name="rigPoints" min={0} defaultValue={0} /></label>{' '}
          <label>lb/point <input type="number" name="rigPointLbs" min={0} defaultValue={0} /></label>{' '}
          <label>Amps <input type="number" name="powerAmps" min={0} defaultValue={0} /></label>{' '}
          <label>Trim ft <input type="number" name="ceilingFt" min={0} defaultValue={0} /></label>{' '}
          <button>Plan slot</button>
        </form>
      </section>
    </main>
  );
}
