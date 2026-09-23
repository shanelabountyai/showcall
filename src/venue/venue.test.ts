import { beforeEach, describe, expect, it } from 'vitest';
import { publishAgenda } from '../agenda/publish';
import { fixedClock } from '../clock';
import { prisma } from '../db';
import { addCue, CascadeBlocked, commitCascade, previewCascade } from '../runsheet/cascade';
import type { Timing } from '../runsheet/cues';
import { makeEvent, makeSession, resetDb } from '../test/harness';
import { billedMinutes, venueProblems, type LoadNeed, type VenueRules } from './rules';
import { loadPlan, planLoad, saveVenue, setEventVenue, setRoomSpec, VenueRefused, type VenueInput } from './venue';

const D0 = '2026-10-12', D1 = '2026-10-13';
const blank = { day: null, startMin: null, anchorId: null, anchorEdge: null, offsetMin: 0, endById: null, endByEdge: null, endByOffsetMin: 0 } as const;
const HOUSE: VenueInput = { name: 'Lakeshore Grand', dockBays: 2, dockOpenMin: 360, dockCloseMin: 1380, maxTruckFt: 48, wifiMbps: 500, unionHouse: true, minCallMin: 240 };

beforeEach(resetDb);

describe('venue rules (pure)', () => {
  const venue: VenueRules = { ...HOUSE };
  const ballroom = { name: 'Ballroom', ceilingFt: 24, rigPoints: 12, rigPointLbs: 1000, powerAmps: 400 };
  const load = (cueId: string, over: Partial<LoadNeed> = {}): LoadNeed => ({
    cueId, label: cueId, room: ballroom, trucks: 1, truckFt: 26, rigPoints: 0, rigPointLbs: 0, powerAmps: 0, ceilingFt: 0, ...over,
  });
  const at = (startMin: number, endMin: number, day = D1): Timing => ({ day, startMin, endMin });

  it('names each slot that overfills the dock, with the slots already there', () => {
    const timings = new Map([['A', at(480, 720)], ['B', at(540, 600)], ['C', at(600, 660)]]);
    const problems = venueProblems(venue, [load('A', { trucks: 2 }), load('B'), load('C')], timings);
    expect(problems.map((p) => [p.kind, p.cueId])).toEqual([['dock_bays', 'B'], ['dock_bays', 'C']]);
    expect(problems[0]!.message).toBe('"B" puts 3 trucks at the Lakeshore Grand dock at 9:00 Tue, Oct 13 (with "A"); it has 2 bays');
    // C starts as B leaves (end is exclusive): two trucks, two bays.
    expect(venueProblems(venue, [load('A'), load('B'), load('C')], timings)).toEqual([]);
    // Other days never share a dock.
    expect(venueProblems(venue, [load('A', { trucks: 2 }), load('D')], new Map([['A', at(480, 720)], ['D', at(480, 720, D0)]]))).toEqual([]);
  });

  it('checks the truck, the rig, the power and the trim against the dock and the room', () => {
    const t = new Map([['A', at(480, 600)]]);
    const kinds = (over: Partial<LoadNeed>) => venueProblems(venue, [load('A', over)], t).map((p) => p.message);
    expect(kinds({ truckFt: 53 })).toEqual(['"A" needs a 53 ft truck; the Lakeshore Grand dock takes 48 ft at most']);
    expect(kinds({ rigPoints: 14 })).toEqual(['"A" needs 14 rigging points; Ballroom has 12']);
    expect(kinds({ rigPoints: 8, rigPointLbs: 1200 })).toEqual(['"A" hangs 1200 lb a point; Ballroom is rated 1000 lb']);
    expect(kinds({ powerAmps: 600, ceilingFt: 30 })).toEqual(['"A" draws 600 A; Ballroom has 400 A of house power', '"A" needs 30 ft of trim; Ballroom\'s ceiling is 24 ft']);
    expect(venueProblems(venue, [load('A', { ceilingFt: 40, room: { ...ballroom, ceilingFt: null } })], t)).toEqual([]);
  });

  it('keeps every slot inside dock hours, and a union house bills its minimum call', () => {
    expect(venueProblems(venue, [load('A')], new Map([['A', at(300, 420)]]))[0]).toMatchObject({ kind: 'dock_hours' });
    expect(venueProblems(venue, [load('A')], new Map([['A', at(360, 1380)]]))).toEqual([]);
    expect(billedMinutes(venue, 90)).toBe(240);
    expect(billedMinutes(venue, 300)).toBe(300);
    expect(billedMinutes({ ...venue, unionHouse: false }, 90)).toBe(90);
  });
});

/** A closer 16:00–16:45 and an AV rig: load-in the day before, load-out 30 min after the closer. */
async function show() {
  const event = await makeEvent();
  const ballroom = await prisma.room.create({ data: { eventId: event.id, name: 'Ballroom', ceilingFt: 24, rigPoints: 12, rigPointLbs: 1000, powerAmps: 400 } });
  const salon = await prisma.room.create({ data: { eventId: event.id, name: 'Salon', ceilingFt: 12, powerAmps: 100 } });
  const closer = await makeSession(event.id, ballroom.id, D1, 960, 1005);
  await publishAgenda(event.id, fixedClock(`${D1}T12:00:00Z`));
  const built = await previewCascade(event.id, { rebase: true });
  await commitCascade(event.id, { rebase: true }, built.moved);
  const venue = await saveVenue(HOUSE);
  await setEventVenue(event.id, venue.id);
  const av = await prisma.vendor.create({ data: { name: 'Brightline AV' } });
  const rig = { vendorId: av.id, roomId: ballroom.id, trucks: 2, truckFt: 48, rigPoints: 8, rigPointLbs: 750, powerAmps: 400, ceilingFt: 20 };
  const loadIn = await planLoad(event.id, { ...rig, kind: 'load_in', durationMin: 360, when: { ...blank, day: D0, startMin: 480 } });
  const loadOut = await planLoad(event.id, { ...rig, kind: 'load_out', durationMin: 240, when: { ...blank, anchorId: closer.id, anchorEdge: 'end', offsetMin: 30 } });
  return { event, ballroom, salon, closer, venue, av, rig, loadIn, loadOut };
}

describe('load slots', () => {
  it('are production cues: the load-out follows the closer, and the plan shows the billed call', async () => {
    const { event, loadIn, loadOut } = await show();
    expect(loadIn.label).toBe('Load-in: Brightline AV');
    const plan = await loadPlan(event.id);
    expect(plan.loads.map((l) => [l.row.label, l.row.day, l.row.startMin, l.row.endMin, l.billedMin])).toEqual([
      ['Load-in: Brightline AV', D0, 480, 840, 360],
      ['Load-out: Brightline AV', D1, 1035, 1275, 240],
    ]);
    expect(loadOut.id).toBe(plan.loads[1]!.cueId);
  });

  it('a change that pushes the load-out past dock close is refused by the cascade, naming the dock', async () => {
    const { event, loadOut } = await show();
    // Hold the load-out 3 h after the closer: 19:45 + 4 h runs to 23:45; the dock closes 23:00.
    const change = { edits: [{ cueId: loadOut.id, offsetMin: 180 }] };
    const preview = await previewCascade(event.id, change);
    expect(preview.problems).toEqual([expect.objectContaining({ kind: 'dock_hours', message: expect.stringContaining('the Lakeshore Grand dock is open 6:00–23:00') })]);
    await expect(commitCascade(event.id, change, preview.moved)).rejects.toBeInstanceOf(CascadeBlocked);
    expect((await prisma.cue.findUniqueOrThrow({ where: { id: loadOut.id } })).offsetMin).toBe(30);
  });

  it('moving a rig into a room that cannot hang it is refused (a rain call is a room move)', async () => {
    const { event, salon, loadOut } = await show();
    const preview = await previewCascade(event.id, { edits: [{ cueId: loadOut.id, roomId: salon.id }] });
    expect(preview.problems.map((p) => p.message)).toEqual([
      '"Load-out: Brightline AV" needs 8 rigging points; Salon has 0',
      '"Load-out: Brightline AV" draws 400 A; Salon has 100 A of house power',
      '"Load-out: Brightline AV" needs 20 ft of trim; Salon\'s ceiling is 12 ft',
    ]);
  });

  it('a slot that overfills the dock is refused, and nothing is written', async () => {
    const { event, rig } = await show();
    const florals = await prisma.vendor.create({ data: { name: 'Petal & Stem' } });
    await expect(planLoad(event.id, { ...rig, vendorId: florals.id, kind: 'load_in', trucks: 1, truckFt: 26, rigPoints: 0, durationMin: 60, when: { ...blank, day: D0, startMin: 600 } }))
      .rejects.toThrow(/puts 3 trucks at the Lakeshore Grand dock at 10:00 .* \(with "Load-in: Brightline AV"\); it has 2 bays/);
    expect(await prisma.cue.count()).toBe(2);
    expect(await prisma.loadSlot.count()).toBe(2);
  });

  it('refuses a slot at an event with no venue profile', async () => {
    const event = await makeEvent();
    const room = await prisma.room.create({ data: { eventId: event.id, name: 'Hall' } });
    const av = await prisma.vendor.create({ data: { name: 'AV' } });
    await expect(planLoad(event.id, { kind: 'load_in', vendorId: av.id, roomId: room.id, trucks: 1, truckFt: 26, durationMin: 60, when: { ...blank, day: D1, startMin: 480 } }))
      .rejects.toThrow('the event has no venue profile');
    await expect(planLoad(event.id, { kind: 'load_in', vendorId: av.id, roomId: room.id, trucks: 0, truckFt: 26, durationMin: 60, when: { ...blank, day: D1, startMin: 480 } }))
      .rejects.toBeInstanceOf(VenueRefused);
  });
});

describe('profile edits re-check what is planned', () => {
  it('a venue edit that breaks a planned slot is refused whole; one that fits lands', async () => {
    const { venue } = await show();
    await expect(saveVenue({ ...HOUSE, dockCloseMin: 1260 }, venue.id)).rejects.toThrow(/"Load-out: Brightline AV" runs 17:15–21:15 .*; the Lakeshore Grand dock is open 6:00–21:00/);
    await expect(saveVenue({ ...HOUSE, maxTruckFt: 40 }, venue.id)).rejects.toBeInstanceOf(CascadeBlocked);
    expect((await prisma.venue.findUniqueOrThrow({ where: { id: venue.id } })).maxTruckFt).toBe(48);
    await saveVenue({ ...HOUSE, dockCloseMin: 1290, wifiMbps: 1000 }, venue.id);
    expect((await prisma.venue.findUniqueOrThrow({ where: { id: venue.id } })).wifiMbps).toBe(1000);
    await expect(saveVenue({ ...HOUSE, dockOpenMin: 1400 }, venue.id)).rejects.toBeInstanceOf(VenueRefused);
  });

  it('derating a room under a planned rig is refused', async () => {
    const { ballroom } = await show();
    await expect(setRoomSpec(ballroom.id, { ceilingFt: 24, rigPoints: 12, rigPointLbs: 500, powerAmps: 400 })).rejects.toThrow('rated 500 lb');
    await setRoomSpec(ballroom.id, { ceilingFt: 30, rigPoints: 16, rigPointLbs: 1000, powerAmps: 600 });
  });

  it('an ordinary cue never meets the venue check', async () => {
    const { event, ballroom } = await show();
    await addCue(event.id, ballroom.id, { ...blank, label: 'Midnight strike', durationMin: 60, day: D1, startMin: 1380 });
  });
});
