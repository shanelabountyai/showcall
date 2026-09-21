/**
 * Seed: one two-day, three-track conference for Showcall Productions.
 * Synthetic people and companies only. Day 1 is today on the venue's clock,
 * so live mode has a show in progress: every row already due has a GO from
 * its room's stage manager, running a little later as the day goes.
 *
 * Wipes the database first. Local only — db.ts refuses a cloud URL.
 */
import { saveSession } from '../src/agenda/grid';
import { publishAgenda } from '../src/agenda/publish';
import { issueCallSheets } from '../src/callsheet/callsheet';
import { systemClock } from '../src/clock';
import { prisma } from '../src/db';
import { createEvent } from '../src/events';
import { addCue, commitCascade, loadRunSheet, previewCascade } from '../src/runsheet/cascade';
import type { CueSpec } from '../src/runsheet/cues';
import { assign } from '../src/staffing/staffing';
import { resetDb } from '../src/test/harness';
import { daysBetween, fromDbDate, localNow, toDbDate } from '../src/time';

if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed in production');

const TZ = 'America/Chicago';
const at = (h: number, m = 0) => h * 60 + m;

await resetDb();
const today = localNow(systemClock.now(), TZ);
const [d1, d2] = daysBetween(today.day, fromDbDate(new Date(toDbDate(today.day).getTime() + 86_400_000))) as [string, string];

const event = await createEvent({ name: 'Northwind Leadership Summit', clientName: 'Northwind Health Partners', timezone: TZ, startDate: d1, endDate: d2 });
const room = {} as Record<'Ballroom A' | 'Salon B' | 'Salon C', { id: string }>;
for (const [name, strikeMinutes, resetMinutes] of [['Ballroom A', 5, 10], ['Salon B', 5, 5], ['Salon C', 5, 5]] as const) {
  room[name] = await prisma.room.create({ data: { eventId: event.id, name, strikeMinutes, resetMinutes } });
}

const speakerNames = ['Dana Reyes', 'Marcus Oyelaran', 'Ingrid Solberg', 'Tomás Aguilar', 'Keiko Brandt', 'Ravi Menon', 'Hollis Grant', 'Nadia Farouk', 'Owen Castellano', 'Lucia Varga'];
const sp = Object.fromEntries(await Promise.all(speakerNames.map(async (name) => [name, (await prisma.speaker.create({ data: { eventId: event.id, name } })).id] as const)));

// [day, room, start, end, title, speakers] — three tracks: strategy, operations, technology.
type Row = [string, keyof typeof room, number, number, string, string[]];
const grid: Row[] = [];
for (const [day, n, keynote, closer, [a, b, c, d, e, f]] of [
  [d1, 1, 'Opening keynote: Care at the speed of trust', 'Day 1 wrap', ['Dana Reyes', 'Marcus Oyelaran', 'Ingrid Solberg', 'Tomás Aguilar', 'Keiko Brandt', 'Ravi Menon']],
  [d2, 2, 'Keynote: The next five years of value-based care', 'Closing general session', ['Hollis Grant', 'Nadia Farouk', 'Owen Castellano', 'Lucia Varga', 'Dana Reyes', 'Ingrid Solberg']],
] as const) {
  grid.push(
    [day, 'Ballroom A', at(9), at(10), keynote, [a]],
    [day, 'Ballroom A', at(10, 30), at(11, 15), `Strategy ${n}.1: Portfolio bets`, [b]],
    [day, 'Ballroom A', at(11, 30), at(12, 15), `Strategy ${n}.2: Payer partnerships`, [c]],
    [day, 'Ballroom A', at(13, 30), at(14, 15), `Strategy ${n}.3: Board-level metrics`, [d]],
    [day, 'Ballroom A', at(14, 30), at(15, 15), `Strategy ${n}.4: Fireside chat`, [a, b]],
    [day, 'Ballroom A', at(16), at(16, 45), closer, [a]],
    [day, 'Salon B', at(10, 30), at(11, 15), `Operations ${n}.1: Staffing models`, [e]],
    [day, 'Salon B', at(11, 30), at(12, 15), `Operations ${n}.2: Supply chain resilience`, [f]],
    [day, 'Salon B', at(13, 30), at(14, 15), `Operations ${n}.3: Panel — the discharge handoff`, [e, f]],
    [day, 'Salon B', at(14, 30), at(15, 15), `Operations ${n}.4: Workshop`, []],
    [day, 'Salon C', at(10, 30), at(11, 15), `Technology ${n}.1: Interoperability in practice`, [d]],
    [day, 'Salon C', at(11, 30), at(12, 15), `Technology ${n}.2: Ambient documentation`, [b]],
    [day, 'Salon C', at(13, 30), at(14, 15), `Technology ${n}.3: Data governance`, [c]],
    [day, 'Salon C', at(14, 30), at(15, 15), `Technology ${n}.4: Demo hour`, []],
  );
}
const session: Record<string, string> = {};
for (const [day, r, startMin, endMin, title, speakers] of grid) {
  session[`${day} ${r} ${startMin}`] = (await saveSession(event.id, { title, day, roomId: room[r].id, startMin, endMin, speakerIds: speakers.map((s) => sp[s]!) })).id;
}

await publishAgenda(event.id, systemClock);
const rebase = await previewCascade(event.id, { rebase: true });
await commitCascade(event.id, { rebase: true }, rebase.moved);

// Production cues, anchored so the S-6 demo (keynote moves 15 minutes) cascades through them.
const blank: Omit<CueSpec, 'id' | 'label' | 'durationMin'> = { day: null, startMin: null, anchorId: null, anchorEdge: null, offsetMin: 0, endById: null, endByEdge: null, endByOffsetMin: 0 };
const roles = {} as Record<'A1 Audio' | 'Catering' | 'Doors & Registration', { id: string }>;
for (const [name, reportTo] of [['A1 Audio', 'FOH position, Ballroom A'], ['Catering', 'Loading dock B'], ['Doors & Registration', 'Registration desk, main entrance']] as const) {
  roles[name] = await prisma.callRole.create({ data: { eventId: event.id, name, reportTo } });
}
async function cue(r: keyof typeof room, label: string, durationMin: number, spec: Partial<typeof blank>, tags: (keyof typeof roles)[]) {
  const c = await addCue(event.id, room[r].id, { ...blank, ...spec, label, durationMin });
  await prisma.cueRole.createMany({ data: tags.map((t) => ({ cueId: c.id, roleId: roles[t].id })) });
  return c;
}
for (const day of [d1, d2]) {
  const keynote = session[`${day} Ballroom A ${at(9)}`]!;
  await cue('Ballroom A', 'Doors open', 30, { anchorId: keynote, anchorEdge: 'start', offsetMin: -30 }, ['Doors & Registration']);
  await cue('Ballroom A', 'Walk-in music', 15, { anchorId: keynote, anchorEdge: 'start', offsetMin: -15 }, ['A1 Audio']);
  await cue('Ballroom A', 'Lectern mic swap', 5, { anchorId: keynote, anchorEdge: 'end' }, ['A1 Audio']);
  await cue('Ballroom A', 'Lunch service', 60, { day, startMin: at(12, 20) }, ['Catering']);
  await cue('Ballroom A', 'Stage reset for closer', 20, {
    anchorId: session[`${day} Ballroom A ${at(14, 30)}`], anchorEdge: 'end', offsetMin: 5,
    endById: session[`${day} Ballroom A ${at(16)}`], endByEdge: 'start',
  }, ['A1 Audio']);
  await cue('Salon B', 'Panel mics set', 10, { anchorId: session[`${day} Salon B ${at(13, 30)}`], anchorEdge: 'start', offsetMin: -10 }, ['A1 Audio']);
  await cue('Salon C', 'Afternoon coffee', 30, { anchorId: session[`${day} Salon C ${at(14, 30)}`], anchorEdge: 'end' }, ['Catering']);
}
await issueCallSheets(event.id, systemClock);

// Staff and day-of roles. Stage managers own a room; the producer and TD are event-wide.
const crew: [string, number, 'producer' | 'stage_manager' | 'technical_director' | 'crew', keyof typeof room | null, number, number][] = [
  ['Morgan Ellis', 720, 'producer', null, at(7), at(18)],
  ['Priya Natarajan', 720, 'stage_manager', 'Ballroom A', at(7, 30), at(17, 30)],
  ['Theo Lindqvist', 720, 'stage_manager', 'Salon B', at(8), at(16)],
  ['Rosa Delgado', 720, 'stage_manager', 'Salon C', at(8), at(16)],
  ['Sam Okafor', 720, 'technical_director', null, at(7), at(17)],
  ['Jun Watanabe', 600, 'crew', 'Ballroom A', at(7), at(17)],
  ['Casey Brennan', 600, 'crew', 'Salon B', at(8), at(16)],
  ['Avery Holt', 480, 'crew', null, at(8), at(16)],
];
const sm: Record<string, string> = {};
for (const [name, maxMinutesPerDay, role, r, startMin, endMin] of crew) {
  const person = await prisma.staff.create({ data: { name, maxMinutesPerDay } });
  for (const day of [d1, d2]) await assign({ staffId: person.id, eventId: event.id, roomId: r && room[r].id, day, startMin, endMin, role });
  if (role === 'stage_manager') sm[r!] = person.id;
}

// GO marks for today: every row already due, called by its room's SM, drifting later through the day.
const now = localNow(systemClock.now(), TZ);
const due = (await loadRunSheet(event.id)).rows.filter((r) => r.day === now.day && r.startMin <= now.min);
const drift: Record<string, number> = {};
for (const row of due) {
  drift[row.room] = Math.min((drift[row.room] ?? 0) + (row.room === 'Ballroom A' ? 2 : 1), 12);
  const actualMin = Math.min(row.startMin + drift[row.room]!, now.min);
  await prisma.liveMark.create({
    data: {
      eventId: event.id, roomId: room[row.room as keyof typeof room].id, staffId: sm[row.room]!, rowId: row.id,
      day: toDbDate(now.day), plannedMin: row.startMin, actualMin, markedAt: new Date(systemClock.now().getTime() - (now.min - actualMin) * 60_000),
    },
  });
}

console.log(`Seeded ${event.name}: ${d1}–${d2}, ${grid.length} sessions, ${due.length} GO marks. /events/${event.id}/live`);
await prisma.$disconnect();
