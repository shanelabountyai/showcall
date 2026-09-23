import { prisma } from '../db';
import type { LoadKind } from '../generated/prisma/enums';
import { insertCue, loadRunSheet, recheck } from '../runsheet/cascade';
import type { CueSpec } from '../runsheet/cues';
import { billedMinutes } from './rules';

/**
 * Venue profiles and load slots (P0-8, D-024). The profile is data the
 * cascade checks against (./rules.ts); every edit here re-checks the run
 * sheets it touches and is refused whole if one would break, so a profile
 * can never silently disagree with a slot already planned.
 */
export class VenueRefused extends Error {}

export type VenueInput = {
  name: string; dockBays: number; dockOpenMin: number; dockCloseMin: number;
  maxTruckFt: number; wifiMbps: number; unionHouse: boolean; minCallMin: number;
};
export type RoomSpecInput = { ceilingFt: number | null; rigPoints: number; rigPointLbs: number; powerAmps: number };
export type LoadInput = {
  kind: LoadKind; vendorId: string; roomId: string; durationMin: number;
  /** Fixed ("06:00 day 1") or anchored ("30 min after the reception ends"). */
  when: Pick<CueSpec, 'day' | 'startMin' | 'anchorId' | 'anchorEdge' | 'offsetMin'>;
  trucks: number; truckFt: number; rigPoints?: number; rigPointLbs?: number; powerAmps?: number; ceilingFt?: number;
};

const whole = (n: number, min = 0) => Number.isSafeInteger(n) && n >= min;

function checkVenue(v: VenueInput) {
  if (!v.name.trim()) throw new VenueRefused('A venue needs a name');
  if (!whole(v.dockBays, 1)) throw new VenueRefused('A dock needs at least one bay');
  if (!whole(v.dockOpenMin) || !whole(v.dockCloseMin) || v.dockCloseMin > 1440 || v.dockOpenMin >= v.dockCloseMin) throw new VenueRefused('Dock hours must open before they close, inside one day');
  if (!whole(v.maxTruckFt, 1)) throw new VenueRefused('The longest truck the dock takes must be a length in feet');
  if (!whole(v.wifiMbps) || !whole(v.minCallMin)) throw new VenueRefused('Wifi and the minimum call are whole numbers, not negative');
}

/** Create a venue, or edit one — refused if the edit breaks a slot planned at any event there. */
export async function saveVenue(input: VenueInput, id?: string) {
  checkVenue(input);
  const data = { ...input, name: input.name.trim() };
  if (!id) return prisma.venue.create({ data });
  return prisma.$transaction(async (tx) => {
    const venue = await tx.venue.update({ where: { id }, data, include: { events: { select: { id: true }, orderBy: { id: 'asc' } } } });
    for (const e of venue.events) await recheck(tx, e.id);
    return venue;
  });
}

export const setEventVenue = (eventId: string, venueId: string) => prisma.$transaction(async (tx) => {
  await tx.event.update({ where: { id: eventId }, data: { venueId } });
  await recheck(tx, eventId);
});

export function setRoomSpec(roomId: string, spec: RoomSpecInput) {
  if ((spec.ceilingFt !== null && !whole(spec.ceilingFt, 1)) || !whole(spec.rigPoints) || !whole(spec.rigPointLbs) || !whole(spec.powerAmps)) {
    throw new VenueRefused('Room specs are whole numbers, not negative; leave the ceiling blank for open air');
  }
  return prisma.$transaction(async (tx) => {
    const room = await tx.room.update({ where: { id: roomId }, data: spec });
    await recheck(tx, room.eventId);
    return room;
  });
}

/** Plan a load-in or load-out as a production cue. Refused, and not written, if it breaks the venue or the sheet. */
export async function planLoad(eventId: string, input: LoadInput) {
  const need = { rigPoints: input.rigPoints ?? 0, rigPointLbs: input.rigPointLbs ?? 0, powerAmps: input.powerAmps ?? 0, ceilingFt: input.ceilingFt ?? 0 };
  if (!whole(input.durationMin, 1)) throw new VenueRefused('A load slot needs a duration in minutes');
  if (!whole(input.trucks, 1) || !whole(input.truckFt, 1)) throw new VenueRefused('A load slot needs at least one truck and its length in feet');
  if (!Object.values(need).every((n) => whole(n))) throw new VenueRefused('Rigging, power and trim are whole numbers, not negative');
  return prisma.$transaction(async (tx) => {
    const vendor = await tx.vendor.findUniqueOrThrow({ where: { id: input.vendorId } });
    const label = `${input.kind === 'load_in' ? 'Load-in' : 'Load-out'}: ${vendor.name}`;
    return insertCue(tx, eventId, input.roomId, {
      ...input.when, label, durationMin: input.durationMin, endById: null, endByEdge: null, endByOffsetMin: 0,
    }, (cueId) => tx.loadSlot.create({ data: { cueId, kind: input.kind, vendorId: vendor.id, trucks: input.trucks, truckFt: input.truckFt, ...need } }));
  });
}

/** The venue page: the profile, what each room can take, and every load slot at its derived time and billed length. */
export async function loadPlan(eventId: string) {
  const [event, sheet] = await Promise.all([
    prisma.event.findUniqueOrThrow({ where: { id: eventId }, include: { venue: true, rooms: { orderBy: { name: 'asc' } } } }),
    loadRunSheet(eventId),
  ]);
  const slots = await prisma.loadSlot.findMany({ where: { cue: { eventId } }, include: { vendor: true } });
  const row = new Map(sheet.rows.map((r) => [r.id, r]));
  const loads = slots.flatMap((s) => {
    const r = row.get(s.cueId);
    return r ? [{ ...s, row: r, billedMin: event.venue ? billedMinutes(event.venue, r.endMin - r.startMin) : r.endMin - r.startMin }] : [];
  }).sort((a, b) => a.row.day.localeCompare(b.row.day) || a.row.startMin - b.row.startMin);
  return { event, venue: event.venue, rooms: event.rooms, loads };
}
