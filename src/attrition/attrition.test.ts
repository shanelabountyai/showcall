import { beforeEach, describe, expect, it } from 'vitest';
import { budgetToActuals } from '../budget/budget';
import { fixedClock } from '../clock';
import { prisma } from '../db';
import { makeEvent, makeSpeaker, makeStaff, resetDb } from '../test/harness';
import { addThreshold, assess, AttritionRefused, attritionBoard, createBlock, decide, framing, reserve, splitRelease, type Contract } from './attrition';

beforeEach(resetDb);

// The fixture block: 200 room-nights at $240, signed Jun 15, cutoff Sep 21,
// with 50% due by D-60 (Fri Aug 14) and 80% by D-30 (Sun Sep 13).
const NIGHTS = [{ night: '2026-10-12', rooms: 40 }, { night: '2026-10-13', rooms: 80 }, { night: '2026-10-14', rooms: 80 }];
const contract = (over: Partial<Contract> = {}): Contract => ({
  rateCents: 24_000, contractedOn: '2026-06-15', cutoffOn: '2026-09-21', nights: NIGHTS, releases: [],
  stays: [{ rooms: 25, arriveOn: '2026-10-12', departOn: '2026-10-14', bookedOn: '2026-07-01' }], // 50 room-nights
  thresholds: [{ id: 'd60', dueOn: '2026-08-14', percent: 50 }, { id: 'd30', dueOn: '2026-09-13', percent: 80 }],
  acceptedRoomNights: 0, ...over,
});

describe('burn-down math', () => {
  it('projects pickup at its pace to each threshold and prices the shortfall in cents', () => {
    // Aug 4: 50 room-nights in 50 days is 1 a day.
    const [d60, d30] = assess(contract(), '2026-08-04');
    expect(d60).toMatchObject({ state: 'alert', daysLeft: 10, contracted: 200, required: 100, pickup: 50, projected: 60, shortfall: 40, open: 40, exposureCents: 960_000, release: 80, releaseBy: '2026-08-14', pacePerWeek: 7, neededPerWeek: 35 });
    expect(d30).toMatchObject({ state: 'watch', daysLeft: 40, required: 160, projected: 90, shortfall: 70, exposureCents: 1_680_000, release: 88 });
    expect(framing(d60!)).toBe('Release 80 room-nights by Fri, Aug 14 or accept $9,600.00 (40 room-nights short)');
  });

  it('the release it asks for clears the shortfall exactly — one fewer does not', () => {
    const [d60] = assess(contract(), '2026-08-04');
    const releasing = (n: number) => assess(contract({ releases: [{ night: '2026-10-14', rooms: n, on: '2026-08-04' }] }), '2026-08-04')[0]!;
    expect(releasing(d60!.release!).open).toBe(0);
    expect(releasing(d60!.release! - 1).open).toBe(1);
  });

  it('a later threshold nets what an earlier one already put on the budget', () => {
    const [, d30] = assess(contract({ acceptedRoomNights: 40 }), '2026-08-04');
    expect(d30).toMatchObject({ shortfall: 70, open: 30, exposureCents: 720_000, release: 38 });
    // Releasing 38 leaves 162 contracted: 80% is 130, projection 90 — short 40, all already accepted.
    const after = assess(contract({ acceptedRoomNights: 40, releases: [{ night: '2026-10-14', rooms: 38, on: '2026-08-04' }] }), '2026-08-04')[1]!;
    expect([after.shortfall, after.open]).toEqual([40, 0]);
  });

  it('a passed threshold is judged on the day it fell: later bookings and releases do not rewrite it', () => {
    const c = contract({
      stays: [...contract().stays, { rooms: 30, arriveOn: '2026-10-12', departOn: '2026-10-14', bookedOn: '2026-08-16' }],
      releases: [{ night: '2026-10-14', rooms: 20, on: '2026-08-15' }],
    });
    const [d60, d30] = assess(c, '2026-08-20');
    expect(d60).toMatchObject({ state: 'owed', daysLeft: -6, contracted: 200, pickup: 50, projected: 50, shortfall: 50, release: null });
    expect(framing(d60!)).toBe('Accept $12,000.00: 50 room-nights short, too late to release');
    expect(d30).toMatchObject({ contracted: 180, pickup: 110 });
  });

  it('past the cutoff nothing more books, so the projection is what is booked, and nothing can be released', () => {
    const c = contract({ thresholds: [{ id: 'late', dueOn: '2026-10-01', percent: 80 }] });
    // Sep 15, before cutoff: six more booking days at the pace (50 in 92 days).
    expect(assess(c, '2026-09-15')[0]).toMatchObject({ projected: 53, release: 134, releaseBy: '2026-09-21' });
    expect(assess(c, '2026-09-25')[0]).toMatchObject({ state: 'alert', projected: 50, shortfall: 110, release: null });
  });

  it('"at least 80%" rounds up, and on the day the contract is signed there is no pace to project', () => {
    const c = contract({ nights: [{ night: '2026-10-12', rooms: 101 }], stays: [{ rooms: 80, arriveOn: '2026-10-12', departOn: '2026-10-13', bookedOn: '2026-06-15' }], thresholds: [{ id: 't', dueOn: '2026-09-13', percent: 80 }] });
    expect(assess(c, '2026-06-15')[0]).toMatchObject({ required: 81, projected: 80, shortfall: 1, pacePerWeek: 0 });
  });

  it('pickup at or over the requirement is met, however little time is left', () => {
    const c = contract({ stays: [{ rooms: 50, arriveOn: '2026-10-12', departOn: '2026-10-14', bookedOn: '2026-07-01' }] });
    expect(assess(c, '2026-08-14')[0]).toMatchObject({ state: 'met', open: 0, release: 0, neededPerWeek: null });
    expect(framing(assess(c, '2026-08-14')[0]!)).toBeNull();
  });

  it('a release comes off the emptiest nights first, and never more than is unsold', () => {
    const nights = [{ night: '2026-10-12', unsold: 15 }, { night: '2026-10-13', unsold: 55 }, { night: '2026-10-14', unsold: 55 }];
    expect(splitRelease(nights, 70)).toEqual([{ night: '2026-10-13', rooms: 55 }, { night: '2026-10-14', rooms: 15 }]);
    expect(() => splitRelease(nights, 126)).toThrow('Only 125 unsold room-nights');
  });
});

const at = (day: string) => fixedClock(`${day}T17:00:00Z`);

async function setup() {
  const event = await makeEvent({ startDate: '2026-10-13', endDate: '2026-10-14' });
  const hotel = await prisma.vendor.create({ data: { name: 'Lakeview Grand' } });
  const block = await createBlock(event.id, { hotelId: hotel.id, rateCents: 24_000, contractedOn: '2026-06-15', cutoffOn: '2026-09-21', nights: NIGHTS });
  const d60 = await addThreshold(block.id, '2026-08-14', 50);
  const d30 = await addThreshold(block.id, '2026-09-13', 80);
  return { event, hotel, block, d60, d30 };
}

/** The pure fixture's 50 room-nights, booked on Jul 1. */
const book50 = (blockId: string) => reserve(blockId, { kind: 'attendee', guest: 'Hotel link pickup', rooms: 25, arriveOn: '2026-10-12', departOn: '2026-10-14' }, at('2026-07-01'));

describe('blocks and reservations', () => {
  it('refuses a contract that cannot be one', async () => {
    const { event, hotel, block } = await setup();
    const base = { hotelId: hotel.id, rateCents: 24_000, contractedOn: '2026-06-15', cutoffOn: '2026-09-21', nights: NIGHTS };
    for (const bad of [{ rateCents: 240.5 }, { cutoffOn: '2026-10-12' }, { cutoffOn: '2026-06-01' }, { nights: [] }, { nights: [...NIGHTS, NIGHTS[0]!] }, { nights: [{ night: '2026-10-12', rooms: 0 }] }]) {
      await expect(createBlock(event.id, { ...base, ...bad })).rejects.toThrow(AttritionRefused);
    }
    for (const [day, pct] of [['2026-08-14', 60], ['2026-09-01', 0], ['2026-09-01', 101], ['2026-10-15', 80], ['2026-06-01', 80]] as const) {
      await expect(addThreshold(block.id, day, pct)).rejects.toThrow(AttritionRefused);
    }
  });

  it('speaker, staff and VIP rooms draw from the block and count toward pickup', async () => {
    const { event, block } = await setup();
    const speaker = await makeSpeaker(event.id, { name: 'Dr. Amara Osei' });
    const staff = await makeStaff();
    const clock = at('2026-07-10');
    await reserve(block.id, { kind: 'attendee', guest: 'Hotel link pickup', rooms: 37, arriveOn: '2026-10-12', departOn: '2026-10-13' }, clock);
    const r = await reserve(block.id, { kind: 'speaker', speakerId: speaker.id, arriveOn: '2026-10-12', departOn: '2026-10-15' }, clock);
    await reserve(block.id, { kind: 'staff', staffId: staff.id, arriveOn: '2026-10-12', departOn: '2026-10-14' }, clock);
    await reserve(block.id, { kind: 'vip', guest: 'Client CEO', arriveOn: '2026-10-12', departOn: '2026-10-13' }, clock);
    expect(r.guest).toBe('Dr. Amara Osei');

    // Oct 12 had 40: the speaker, the staffer and the VIP took the last three.
    await expect(reserve(block.id, { kind: 'attendee', guest: 'Late', arriveOn: '2026-10-12', departOn: '2026-10-13' }, clock)).rejects.toThrow('Only 0 rooms left in the block on Mon, Oct 12');
    const [view] = (await attritionBoard(event.id, clock)).blocks;
    expect(Object.fromEntries(view!.byKind)).toEqual({ attendee: 37, speaker: 3, staff: 2, vip: 1 });
    expect(view!.thresholds[0]!.pickup).toBe(43);
    expect(view!.nights.map((n) => n.unsold)).toEqual([0, 78, 79]);
  });

  it('refuses rooms the block does not have, after the cutoff, and for someone else\'s speaker', async () => {
    const { block } = await setup();
    const other = await makeEvent();
    const stranger = await makeSpeaker(other.id);
    const stay = { arriveOn: '2026-10-14', departOn: '2026-10-16' };
    await expect(reserve(block.id, { kind: 'attendee', guest: 'A', ...stay }, at('2026-07-01'))).rejects.toThrow('no rooms on Thu, Oct 15');
    await expect(reserve(block.id, { kind: 'attendee', guest: 'A', arriveOn: '2026-10-12', departOn: '2026-10-13' }, at('2026-09-22'))).rejects.toThrow(/cutoff was Mon, Sep 21: unsold rooms went back to Lakeview Grand/);
    await expect(reserve(block.id, { kind: 'speaker', speakerId: stranger.id, arriveOn: '2026-10-12', departOn: '2026-10-13' }, at('2026-07-01'))).rejects.toThrow('speaker on this event');
    await expect(reserve(block.id, { kind: 'vip', guest: ' ', arriveOn: '2026-10-12', departOn: '2026-10-13' }, at('2026-07-01'))).rejects.toThrow('guest name');
  });

  it('the database refuses a speaker room with no speaker, even past the module', async () => {
    const { block } = await setup();
    const d = new Date('2026-10-12');
    await expect(prisma.roomReservation.create({ data: { blockId: block.id, kind: 'speaker', guest: 'x', arriveOn: d, departOn: new Date('2026-10-13'), bookedOn: d } })).rejects.toThrow(/RoomReservation_check/);
  });
});

describe('decisions', () => {
  it('a release hands the rooms back, clears the alert, and is logged for good', async () => {
    const { event, block, d60 } = await setup();
    await book50(block.id);
    const clock = at('2026-08-04');
    await expect(decide(d60.id, 'release', 79, clock)).rejects.toThrow('releasing 80 room-nights, not 79');
    const decision = await decide(d60.id, 'release', 80, clock);

    const [view] = (await attritionBoard(event.id, clock)).blocks;
    expect(view!.thresholds[0]).toMatchObject({ state: 'on_pace', contracted: 120, open: 0 });
    // Emptiest night first: Oct 14 had nothing booked.
    expect(view!.nights.map((n) => [n.night, n.released])).toEqual([['2026-10-12', 0], ['2026-10-13', 0], ['2026-10-14', 80]]);
    await expect(prisma.attritionDecision.update({ where: { id: decision.id }, data: { roomNights: 1 } })).rejects.toThrow(/append-only/);
    await expect(prisma.blockRelease.deleteMany({ where: { decisionId: decision.id } })).rejects.toThrow(/append-only/);
    await expect(decide(d60.id, 'release', 0, clock)).rejects.toThrow('Nothing is open');
  });

  it('accepting posts the exposure to the budget against the hotel; a later threshold posts only its increment', async () => {
    const { event, hotel, block, d60, d30 } = await setup();
    await book50(block.id);
    const clock = at('2026-08-04');
    await expect(decide(d60.id, 'accept', 900_000, clock)).rejects.toThrow('costs $9,600.00, not $9,000.00');
    await decide(d60.id, 'accept', 960_000, clock);
    await decide(d30.id, 'accept', 720_000, clock);
    await expect(decide(d30.id, 'accept', 0, clock)).rejects.toThrow('Nothing is open');

    const budget = await budgetToActuals(event.id);
    expect(budget.lines.map((l) => [l.category, l.vendorId, l.committedCents])).toEqual([
      ['travel', hotel.id, 960_000],
      ['travel', hotel.id, 720_000],
    ]);
    // The worst shortfall (70 room-nights at D-30) × $240, never the sum of both thresholds' shortfalls.
    expect(budget.total.committed).toBe(70 * 24_000);
    expect(budget.lines[0]!.description).toBe('Room-block attrition — Lakeview Grand, 50% by Fri, Aug 14: 40 room-nights × $240.00');
  });

  it('a passed threshold can still be accepted but no longer released', async () => {
    const { event, block, d60 } = await setup();
    await book50(block.id);
    const clock = at('2026-08-20');
    const board = await attritionBoard(event.id, clock);
    expect(board.alerts.map((a) => a.says)).toEqual(['Accept $12,000.00: 50 room-nights short, too late to release']);
    await expect(decide(d60.id, 'release', 100, clock)).rejects.toThrow('Too late to release: the threshold was Fri, Aug 14');
    await decide(d60.id, 'accept', 1_200_000, clock);
    expect((await attritionBoard(event.id, clock)).blocks[0]!.thresholds[0]!.state).toBe('accepted');
  });

  it('the database refuses an accept with no budget line behind it', async () => {
    const { block, d60 } = await setup();
    await expect(prisma.attritionDecision.create({
      data: { blockId: block.id, thresholdId: d60.id, choice: 'accept', roomNights: 1, exposureCents: 24_000, decidedOn: new Date('2026-08-04'), decidedAt: new Date() },
    })).rejects.toThrow(/AttritionDecision_check/);
  });
});
