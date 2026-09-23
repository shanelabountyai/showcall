import { addLine } from '../budget/budget';
import type { Clock } from '../clock';
import { prisma, type Tx } from '../db';
import type { Prisma } from '../generated/prisma/client';
import type { AttritionChoice, GuestKind } from '../generated/prisma/enums';
import { usd } from '../money';
import { addDays, daysBetween, daysUntil, fromDbDate, localNow, shortDay, toDbDate, type LocalDate } from '../time';

/**
 * Room-block attrition (P0-5, D-020). A block is rooms × nights × rate, with
 * dated thresholds: "pick up 80% of contracted room-nights by D-30 or pay the
 * shortfall at the block rate". Everything shown is derived on read from the
 * contract, the reservations and the decision log — no stored forecast to go
 * stale. The only writes are reservations and decisions, and a decision is
 * append-only: a release hands rooms back, an accept posts its exposure to
 * the budget. Thresholds net against each other (Shane's pick): the block is
 * never charged twice for the same unsold room-night, so the budget carries
 * the worst shortfall accepted, not the sum.
 */
export class AttritionRefused extends Error {}

/** Inside this many days of a threshold, an open shortfall is an alert, not a watch. */
export const ALERT_DAYS = 14;

export type Stay = { rooms: number; arriveOn: LocalDate; departOn: LocalDate; bookedOn: LocalDate };
export type ContractNight = { night: LocalDate; rooms: number };
export type Release = { night: LocalDate; rooms: number; on: LocalDate };
export type Threshold = { id: string; dueOn: LocalDate; percent: number };
export type Contract = {
  rateCents: number; contractedOn: LocalDate; cutoffOn: LocalDate;
  nights: ContractNight[]; releases: Release[]; stays: Stay[]; thresholds: Threshold[];
  /** Room-nights already accepted onto the budget, across every threshold. */
  acceptedRoomNights: number;
};

/** `accepted`: short, but the shortfall is already on the budget. `owed`: passed short, and it is not. */
export type ThresholdState = 'met' | 'on_pace' | 'accepted' | 'watch' | 'alert' | 'owed';
export type Assessment = Threshold & {
  state: ThresholdState; daysLeft: number;
  contracted: number; required: number; pickup: number; projected: number;
  /** Room-nights short at the threshold, before netting. */
  shortfall: number;
  /** The part of the shortfall not yet on the budget, and what accepting it costs. */
  open: number; exposureCents: number;
  /** Room-nights to hand back by `releaseBy` to clear `open`; null once releasing is no longer possible. */
  release: number | null; releaseBy: LocalDate;
  /** Room-nights per week: booked so far, and still needed to make the threshold. */
  pacePerWeek: number; neededPerWeek: number | null;
};

const nightsOf = (s: { arriveOn: LocalDate; departOn: LocalDate }) => daysBetween(s.arriveOn, addDays(s.departOn, -1));
export const roomNights = (s: Stay) => s.rooms * nightsOf(s).length;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
/** "At least 80%" of an odd block rounds up: 80% of 101 room-nights is 81. */
const percentOf = (percent: number, n: number) => Math.ceil((percent * n) / 100);

/**
 * Where one block stands against each threshold, as of `today`. Pure: the
 * burn-down fixtures run against this with no database.
 */
export function assess(c: Contract, today: LocalDate): Assessment[] {
  const contractedAsOf = (d: LocalDate) => sum(c.nights.map((n) => n.rooms)) - sum(c.releases.filter((r) => r.on <= d).map((r) => r.rooms));
  const pickupAsOf = (d: LocalDate) => sum(c.stays.filter((s) => s.bookedOn <= d).map(roomNights));
  const elapsed = daysUntil(c.contractedOn, today);

  return [...c.thresholds].sort((a, b) => a.dueOn.localeCompare(b.dueOn)).map((t): Assessment => {
    const daysLeft = daysUntil(today, t.dueOn);
    const passed = daysLeft < 0;
    const asOf = passed ? t.dueOn : today;
    const contracted = contractedAsOf(asOf);
    const required = percentOf(t.percent, contracted);
    const pickup = pickupAsOf(asOf);
    const releaseBy = t.dueOn < c.cutoffOn ? t.dueOn : c.cutoffOn;
    // Pickup continues at its average pace until the threshold or the cutoff, whichever is first.
    const bookingDays = passed ? 0 : Math.max(0, daysUntil(today, releaseBy));
    const projected = elapsed > 0 ? Math.min(contracted, pickup + Math.floor((pickup * bookingDays) / elapsed)) : pickup;
    const shortfall = Math.max(0, required - projected);
    const open = Math.max(0, shortfall - c.acceptedRoomNights);
    // The largest block that the projection (plus what is already accepted) still covers.
    const covered = Math.floor((100 * (projected + c.acceptedRoomNights)) / t.percent);
    const release = passed || today > c.cutoffOn ? null : Math.max(0, contracted - covered);
    const state: ThresholdState = pickup >= required ? 'met'
      : !shortfall ? 'on_pace'
      : !open ? 'accepted'
      : passed ? 'owed'
      : daysLeft <= ALERT_DAYS ? 'alert' : 'watch';
    return {
      ...t, state, daysLeft, contracted, required, pickup, projected, shortfall, open,
      exposureCents: open * c.rateCents, release, releaseBy,
      pacePerWeek: elapsed > 0 ? (pickup * 7) / elapsed : 0,
      neededPerWeek: passed || pickup >= required ? null : ((required - pickup) * 7) / Math.max(1, daysLeft),
    };
  });
}

/** Per-night inventory: contracted, released, booked, and what is still unsold. */
export function inventory(c: Pick<Contract, 'nights' | 'releases' | 'stays'>) {
  return c.nights.map((n) => {
    const released = sum(c.releases.filter((r) => r.night === n.night).map((r) => r.rooms));
    const booked = sum(c.stays.filter((s) => nightsOf(s).includes(n.night)).map((s) => s.rooms));
    return { night: n.night, contracted: n.rooms, released, booked, unsold: n.rooms - released - booked };
  });
}

/** Which nights a release comes off: the emptiest first, so rooms people are booking stay held. */
export function splitRelease(nights: { night: LocalDate; unsold: number }[], roomNightsToRelease: number) {
  let left = roomNightsToRelease;
  const split: { night: LocalDate; rooms: number }[] = [];
  for (const n of [...nights].sort((a, b) => b.unsold - a.unsold || a.night.localeCompare(b.night))) {
    const rooms = Math.min(n.unsold, left);
    if (rooms > 0) { split.push({ night: n.night, rooms }); left -= rooms; }
  }
  if (left > 0) throw new AttritionRefused(`Only ${roomNightsToRelease - left} unsold room-nights are left to release`);
  return split;
}

/** The decision as a producer reads it. */
export function framing(a: Assessment) {
  if (!a.open) return null;
  const accept = `accept ${usd(a.exposureCents)} (${a.open} room-night${a.open === 1 ? '' : 's'} short)`;
  return a.release ? `Release ${a.release} room-night${a.release === 1 ? '' : 's'} by ${shortDay(a.releaseBy)} or ${accept}` : `Accept ${usd(a.exposureCents)}: ${a.open} room-night${a.open === 1 ? '' : 's'} short, too late to release`;
}

// ── Database ────────────────────────────────────────────────────────────────

const blockInclude = {
  hotel: { select: { name: true } },
  nights: { orderBy: { night: 'asc' }, include: { released: { include: { decision: { select: { decidedOn: true } } } } } },
  thresholds: { orderBy: { dueOn: 'asc' } },
  reservations: { orderBy: [{ arriveOn: 'asc' }, { guest: 'asc' }] },
  decisions: { orderBy: { decidedAt: 'desc' }, include: { threshold: true } },
} satisfies Prisma.RoomBlockInclude;

type LoadedBlock = NonNullable<Awaited<ReturnType<typeof loadBlock>>>;
const loadBlock = (db: Tx, blockId: string) => db.roomBlock.findUnique({ where: { id: blockId }, include: blockInclude });

function contractOf(b: LoadedBlock): Contract {
  return {
    rateCents: b.rateCents, contractedOn: fromDbDate(b.contractedOn), cutoffOn: fromDbDate(b.cutoffOn),
    nights: b.nights.map((n) => ({ night: fromDbDate(n.night), rooms: n.rooms })),
    releases: b.nights.flatMap((n) => n.released.map((r) => ({ night: fromDbDate(n.night), rooms: r.rooms, on: fromDbDate(r.decision.decidedOn) }))),
    stays: b.reservations.map((r) => ({ rooms: r.rooms, arriveOn: fromDbDate(r.arriveOn), departOn: fromDbDate(r.departOn), bookedOn: fromDbDate(r.bookedOn) })),
    thresholds: b.thresholds.map((t) => ({ id: t.id, dueOn: fromDbDate(t.dueOn), percent: t.percent })),
    acceptedRoomNights: sum(b.decisions.filter((d) => d.choice === 'accept').map((d) => d.roomNights)),
  };
}

function view(b: LoadedBlock, today: LocalDate) {
  const contract = contractOf(b);
  // Stays are built from reservations in order, so the index pairs them.
  const byKind = new Map<GuestKind, number>();
  b.reservations.forEach((r, i) => byKind.set(r.kind, (byKind.get(r.kind) ?? 0) + roomNights(contract.stays[i]!)));
  return {
    block: b, contract, today, pastCutoff: today > contract.cutoffOn,
    thresholds: assess(contract, today), nights: inventory(contract), byKind,
  };
}

/** Serialize every write to a block: inventory and netting are both read-then-write. */
const lock = (tx: Tx, blockId: string) => tx.$executeRaw`SELECT 1 FROM "RoomBlock" WHERE id = ${blockId} FOR UPDATE`;
const todayFor = async (db: Tx, eventId: string, clock: Clock) =>
  localNow(clock.now(), (await db.event.findUniqueOrThrow({ where: { id: eventId }, select: { timezone: true } })).timezone).day;

const whole = (n: number, what: string, min = 1) => {
  if (!Number.isSafeInteger(n) || n < min) throw new AttritionRefused(`${what} must be a whole number of at least ${min}`);
  return n;
};
const isDay = (d: string, what: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || fromDbDate(toDbDate(d)) !== d) throw new AttritionRefused(`${what} is not a date`);
  return d;
};

export type BlockInput = { hotelId: string; rateCents: number; contractedOn: LocalDate; cutoffOn: LocalDate; nights: ContractNight[] };

export async function createBlock(eventId: string, input: BlockInput) {
  whole(input.rateCents, 'The nightly rate in cents');
  if (input.rateCents > 2_147_483_647) throw new AttritionRefused('That nightly rate is past what a budget line can hold');
  const contractedOn = isDay(input.contractedOn, 'The contract date');
  const cutoffOn = isDay(input.cutoffOn, 'The cutoff');
  if (!input.nights.length) throw new AttritionRefused('A block needs at least one night');
  const nights = input.nights.map((n) => ({ night: isDay(n.night, 'A night'), rooms: whole(n.rooms, `Rooms on ${n.night}`) }));
  if (new Set(nights.map((n) => n.night)).size !== nights.length) throw new AttritionRefused('A night appears twice');
  const first = nights.map((n) => n.night).sort()[0]!;
  if (cutoffOn < contractedOn) throw new AttritionRefused('The cutoff cannot come before the contract was signed');
  if (cutoffOn >= first) throw new AttritionRefused(`The cutoff must fall before the first night, ${shortDay(first)}`);
  return prisma.roomBlock.create({
    data: {
      eventId, hotelId: input.hotelId, rateCents: input.rateCents, contractedOn: toDbDate(contractedOn), cutoffOn: toDbDate(cutoffOn),
      nights: { create: nights.map((n) => ({ night: toDbDate(n.night), rooms: n.rooms })) },
    },
  });
}

export async function addThreshold(blockId: string, dueOn: LocalDate, percent: number) {
  const block = await prisma.roomBlock.findUniqueOrThrow({ where: { id: blockId }, include: { nights: true } });
  isDay(dueOn, 'The threshold date');
  if (!Number.isSafeInteger(percent) || percent < 1 || percent > 100) throw new AttritionRefused('A threshold is a whole percent from 1 to 100');
  if (dueOn < fromDbDate(block.contractedOn)) throw new AttritionRefused('A threshold cannot fall before the contract was signed');
  const last = block.nights.map((n) => fromDbDate(n.night)).sort().at(-1)!;
  if (dueOn > last) throw new AttritionRefused(`A threshold cannot fall after the last night, ${shortDay(last)}`);
  if (await prisma.attritionThreshold.findUnique({ where: { blockId_dueOn: { blockId, dueOn: toDbDate(dueOn) } } })) {
    throw new AttritionRefused(`This block already has a threshold on ${shortDay(dueOn)}`);
  }
  return prisma.attritionThreshold.create({ data: { blockId, dueOn: toDbDate(dueOn), percent } });
}

export type ReservationInput = {
  kind: GuestKind; guest?: string; speakerId?: string | null; staffId?: string | null;
  rooms?: number; arriveOn: LocalDate; departOn: LocalDate;
};

/**
 * Book rooms into the block, dated today. Speaker, staff and VIP rooms come
 * out of the same inventory as attendees', and count toward pickup the same.
 */
export async function reserve(blockId: string, input: ReservationInput, clock: Clock) {
  const rooms = whole(input.rooms ?? 1, 'Rooms');
  const arriveOn = isDay(input.arriveOn, 'Arrival');
  const departOn = isDay(input.departOn, 'Departure');
  if (departOn <= arriveOn) throw new AttritionRefused('Departure must be after arrival');
  return prisma.$transaction(async (tx) => {
    await lock(tx, blockId);
    const b = await loadBlock(tx, blockId);
    if (!b) throw new AttritionRefused('No such block');
    const today = await todayFor(tx, b.eventId, clock);
    const v = view(b, today);
    if (v.pastCutoff) throw new AttritionRefused(`The cutoff was ${shortDay(v.contract.cutoffOn)}: unsold rooms went back to ${b.hotel.name}, and nothing more books into the block`);

    let guest = input.guest?.trim() ?? '';
    let speakerId: string | null = null, staffId: string | null = null;
    if (input.kind === 'speaker') {
      const s = input.speakerId && await tx.speaker.findUnique({ where: { id: input.speakerId } });
      if (!s || s.eventId !== b.eventId) throw new AttritionRefused('A speaker room needs a speaker on this event');
      [guest, speakerId] = [s.name, s.id];
    } else if (input.kind === 'staff') {
      const s = input.staffId && await tx.staff.findUnique({ where: { id: input.staffId } });
      if (!s) throw new AttritionRefused('A staff room needs a staff member');
      [guest, staffId] = [s.name, s.id];
    }
    if (!guest) throw new AttritionRefused('A room needs a guest name');

    const nights = new Map(v.nights.map((n) => [n.night, n]));
    for (const night of nightsOf({ arriveOn, departOn })) {
      const n = nights.get(night);
      if (!n) throw new AttritionRefused(`The block has no rooms on ${shortDay(night)}`);
      if (n.unsold < rooms) throw new AttritionRefused(`Only ${n.unsold} room${n.unsold === 1 ? '' : 's'} left in the block on ${shortDay(night)}`);
    }
    return tx.roomReservation.create({
      data: { blockId, kind: input.kind, guest, rooms, arriveOn: toDbDate(arriveOn), departOn: toDbDate(departOn), bookedOn: toDbDate(today), speakerId, staffId },
    });
  });
}

/**
 * Answer a threshold's alert, exactly as it was framed. `expected` is the
 * figure the producer was looking at — room-nights for a release, cents for an
 * accept — and the decision is refused if the numbers have moved since, so
 * nobody signs off on an amount they did not see.
 */
export async function decide(thresholdId: string, choice: AttritionChoice, expected: number, clock: Clock) {
  const t = await prisma.attritionThreshold.findUnique({ where: { id: thresholdId } });
  if (!t) throw new AttritionRefused('No such threshold');
  return prisma.$transaction(async (tx) => {
    await lock(tx, t.blockId);
    const b = (await loadBlock(tx, t.blockId))!;
    const today = await todayFor(tx, b.eventId, clock);
    const v = view(b, today);
    const a = v.thresholds.find((x) => x.id === thresholdId)!;
    if (!a.open) throw new AttritionRefused(`Nothing is open at the ${a.percent}% threshold on ${shortDay(a.dueOn)}: pickup and what is already accepted cover it`);
    const base = { blockId: b.id, thresholdId, decidedOn: toDbDate(today), decidedAt: clock.now() };

    if (choice === 'release') {
      if (a.release == null) throw new AttritionRefused(`Too late to release: ${a.daysLeft < 0 ? `the threshold was ${shortDay(a.dueOn)}` : `the cutoff was ${shortDay(v.contract.cutoffOn)}`}`);
      if (a.release !== expected) throw new AttritionRefused(`The numbers moved: clearing this now takes releasing ${a.release} room-nights, not ${expected}. Look again.`);
      const split = splitRelease(v.nights, a.release);
      const ids = new Map(b.nights.map((n) => [fromDbDate(n.night), n.id]));
      return tx.attritionDecision.create({
        data: { ...base, choice, roomNights: a.release, exposureCents: 0, releases: { create: split.map((s) => ({ nightId: ids.get(s.night)!, rooms: s.rooms })) } },
      });
    }

    if (a.exposureCents !== expected) throw new AttritionRefused(`The numbers moved: accepting this now costs ${usd(a.exposureCents)}, not ${usd(expected)}. Look again.`);
    const line = await addLine(b.eventId, {
      category: 'travel', vendorId: b.hotelId,
      description: `Room-block attrition — ${b.hotel.name}, ${a.percent}% by ${shortDay(a.dueOn)}: ${a.open} room-nights × ${usd(b.rateCents)}`,
      committedCents: a.exposureCents,
    }, tx);
    return tx.attritionDecision.create({ data: { ...base, choice, roomNights: a.open, exposureCents: a.exposureCents, budgetLineId: line.id } });
  });
}

/** Every block on the event, assessed as of today. */
export async function attritionBoard(eventId: string, clock: Clock) {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) throw new AttritionRefused('No such event');
  const today = localNow(clock.now(), event.timezone).day;
  const blocks = await prisma.roomBlock.findMany({ where: { eventId }, orderBy: { contractedOn: 'asc' }, include: blockInclude });
  const views = blocks.map((b) => view(b, today));
  return {
    event, today, blocks: views,
    alerts: views.flatMap((v) => v.thresholds.filter((a) => a.state === 'alert' || a.state === 'owed').map((a) => ({ block: v.block, a, says: framing(a)! }))),
  };
}
