import { hhmm, shortDay } from '../time';
import type { Problem, Timing } from '../runsheet/cues';

/**
 * Load slots against the venue's house facts (P0-8, D-024). Pure: the venue,
 * each load with its room, and the resolved timings in; problems out. The
 * cascade runs this with the cue graph, so a keynote push that shoves a
 * load-out past dock close, or a rain call that moves a rig into a room that
 * cannot hang it, is refused like a compression.
 *
 * - dock_hours: the slot runs outside the house dock hours.
 * - dock_bays:  more trucks at the dock at once than it has bays.
 * - venue_spec: the truck is too long for the dock, or the room cannot take
 *               the rig, the power draw or the trim height.
 */
export type VenueRules = { name: string; dockBays: number; dockOpenMin: number; dockCloseMin: number; maxTruckFt: number; unionHouse: boolean; minCallMin: number };
export type RoomSpec = { name: string; ceilingFt: number | null; rigPoints: number; rigPointLbs: number; powerAmps: number };
export type LoadNeed = {
  cueId: string; label: string; room: RoomSpec;
  trucks: number; truckFt: number; rigPoints: number; rigPointLbs: number; powerAmps: number; ceilingFt: number;
};

export function venueProblems(venue: VenueRules | null, loads: LoadNeed[], timings: Map<string, Timing>): Problem[] {
  const problems: Problem[] = [];
  const add = (kind: Problem['kind'], l: LoadNeed, message: string) => problems.push({ kind, cueId: l.cueId, message: `"${l.label}" ${message}` });
  for (const l of loads) {
    if (!venue) { add('venue_spec', l, 'is a load slot, but the event has no venue profile to plan it against'); continue; }
    const r = l.room;
    if (l.truckFt > venue.maxTruckFt) add('venue_spec', l, `needs a ${l.truckFt} ft truck; the ${venue.name} dock takes ${venue.maxTruckFt} ft at most`);
    if (l.rigPoints > r.rigPoints) add('venue_spec', l, `needs ${l.rigPoints} rigging points; ${r.name} has ${r.rigPoints}`);
    else if (l.rigPoints > 0 && l.rigPointLbs > r.rigPointLbs) add('venue_spec', l, `hangs ${l.rigPointLbs} lb a point; ${r.name} is rated ${r.rigPointLbs} lb`);
    if (l.powerAmps > r.powerAmps) add('venue_spec', l, `draws ${l.powerAmps} A; ${r.name} has ${r.powerAmps} A of house power`);
    if (r.ceilingFt !== null && l.ceilingFt > r.ceilingFt) add('venue_spec', l, `needs ${l.ceilingFt} ft of trim; ${r.name}'s ceiling is ${r.ceilingFt} ft`);

    const t = timings.get(l.cueId);
    if (!t) continue;
    if (t.startMin < venue.dockOpenMin || t.endMin > venue.dockCloseMin) {
      add('dock_hours', l, `runs ${hhmm(t.startMin)}–${hhmm(t.endMin)} ${shortDay(t.day)}; the ${venue.name} dock is open ${hhmm(venue.dockOpenMin)}–${hhmm(venue.dockCloseMin)}`);
    }
  }

  // The dock is fullest at some slot's start, so checking every start finds every overload — named once, on the slot that tips it.
  // ponytail: one event's slots only; two events sharing a venue's dock the same day would each pass alone.
  const timed = venue ? loads.flatMap((l) => { const t = timings.get(l.cueId); return t ? [{ l, t }] : []; }) : [];
  for (const { l, t } of timed) {
    const at = timed.filter((o) => o.t.day === t.day && o.t.startMin <= t.startMin && t.startMin < o.t.endMin);
    const trucks = at.reduce((n, o) => n + o.l.trucks, 0);
    const tipped = trucks > venue!.dockBays && trucks - l.trucks <= venue!.dockBays;
    if (tipped) add('dock_bays', l, `puts ${trucks} trucks at the ${venue!.name} dock at ${hhmm(t.startMin)} ${shortDay(t.day)} (with ${at.filter((o) => o.l !== l).map((o) => `"${o.l.label}"`).join(', ')}); it has ${venue!.dockBays} bays`);
  }
  return problems;
}

/** A union house bills a call shorter than its minimum as the minimum. */
export const billedMinutes = (venue: VenueRules, durationMin: number) => (venue.unionHouse ? Math.max(durationMin, venue.minCallMin) : durationMin);
