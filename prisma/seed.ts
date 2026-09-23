/**
 * Seed: one two-day, three-track conference for Showcall Productions.
 * Synthetic people and companies only. Day 1 is today on the venue's clock,
 * so live mode has a show in progress: every row already due has a GO from
 * its room's stage manager, running a little later as the day goes.
 *
 * Wipes the database first. Local only — db.ts refuses a cloud URL.
 */
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { saveSession } from '../src/agenda/grid';
import { publishAgenda } from '../src/agenda/publish';
import { advance, LIFECYCLE, setConsent, setProfile } from '../src/bureau/bureau';
import { issueCallSheets } from '../src/callsheet/callsheet';
import { sendDueReminders, setLeadDays } from '../src/chase/chase';
import { DAY, fixedClock, systemClock } from '../src/clock';
import { buildPackage } from '../src/content/distribution';
import { approve } from '../src/content/lock';
import { addDeliverable, addRule, addSponsor, issuePortalToken, submitVersion } from '../src/content/pipeline';
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

// Bureau (P0-4): profile, honorarium, contract, consent and rehearsals, spread
// across the lifecycle and advanced through the real guards in
// src/bureau/bureau.ts — the seed proves the machine rather than writing the
// state column. Lucia Varga is released with mixed consent, so S-9's
// distribution builder has a speaker who said no to something.
const bureauPlan: Record<string, {
  target: (typeof LIFECYCLE)[number]; honorariumCents?: number; bio?: string;
  rehearsal?: keyof typeof room; consent?: { recordSession: boolean; distributeDeck: boolean; publishVideo: boolean };
}> = {
  'Ingrid Solberg': { target: 'confirmed' },
  'Tomás Aguilar': { target: 'confirmed' },
  'Keiko Brandt': { target: 'contracted', honorariumCents: 350_00 },
  'Ravi Menon': { target: 'contracted', honorariumCents: 275_00 },
  'Hollis Grant': { target: 'content_complete', honorariumCents: 400_00, bio: 'Chief value officer, twelve years leading payer-provider partnerships.' },
  'Nadia Farouk': { target: 'rehearsed', honorariumCents: 450_00, bio: 'VP of ambient care technology; frequent keynote on interoperability.', rehearsal: 'Ballroom A' },
  'Owen Castellano': { target: 'showed', honorariumCents: 320_00, bio: 'Director of supply chain resilience for a five-state health system.', rehearsal: 'Salon B' },
  'Lucia Varga': {
    target: 'released', honorariumCents: 500_00, bio: 'Board member and governance advisor across three regional health systems.', rehearsal: 'Salon C',
    consent: { recordSession: true, distributeDeck: true, publishVideo: false },
  },
};
// Content turn-in (P0-5, D-015/D-016): the default rule set, two sponsors, and
// an approved, locked deck for every speaker at or past content_complete —
// which the guard requires. Hollis Grant's deck shows the loop: v1 failed on
// fonts, v2–v5 are revisions, v6 is the locked show file — so the Phase 2
// gate's late upload is the PRD's "11pm v7". The brand-template check is `manual`, so every deck is
// *needs review* until a producer's approval resolves it.
const MB = 1024 * 1024;
const rules: [Parameters<typeof addRule>[1], Parameters<typeof addRule>[2], object, string][] = [
  ['deck', 'max_bytes', { max: 100 * MB }, 'Keep the deck under 100 MB — compress large images or link videos instead of embedding them.'],
  ['deck', 'file_type', { types: ['pdf', 'pptx'] }, 'Send the deck as a PDF or a PowerPoint (.pptx) file.'],
  ['deck', 'aspect_ratio', { ratio: 16 / 9, tolerance: 0.01 }, 'Set the slide size to 16:9 widescreen (Design → Slide Size) and export again.'],
  ['deck', 'fonts_embedded', {}, 'Embed your fonts when exporting (PowerPoint: File → Options → Save → Embed fonts; PDF: "PDF/A" or "embed all fonts").'],
  ['deck', 'manual', {}, 'Production checks the deck against the event brand template.'],
  ['logo', 'file_type', { types: ['png'] }, 'Send the logo as a PNG with a transparent background.'],
  ['logo', 'min_pixels', { width: 1000 }, 'The logo must be at least 1000 pixels wide — export it larger from the original artwork.'],
  ['banner', 'manual', {}, 'Production checks the banner against the event brand template.'],
  ['video', 'max_bytes', { max: 2048 * MB }, 'Keep the video under 2 GB — export at 1080p.'],
  ['video', 'codec_allowlist', { codecs: ['avc1', 'hvc1'] }, 'Export the video as H.264 or H.265 (HEVC) MP4.'],
];
for (const [kind, check, params, fix] of rules) await addRule(event.id, kind, check, params, fix);

// Turn-in lead times (P0-5 chase): days before the owner's first call. Decks
// lead longest because they must clear validation *and* a rehearsal; print
// artwork leads longer still. The deadline itself is never stored — it derives
// from the agenda, so a session move moves it (src/chase/chase.ts).
const leads: [Parameters<typeof setLeadDays>[1], number][] = [
  ['deck', 21], ['headshot', 30], ['logo', 30], ['banner', 30], ['booth_info', 14], ['video', 14],
];
for (const [kind, days] of leads) await setLeadDays(event.id, kind, days);
for (const name of ['Contoso Health', 'Fabrikam Medical Devices']) {
  const sponsor = await addSponsor(event.id, name);
  await addDeliverable(event.id, { sponsorId: sponsor.id }, 'logo', `${name} logo`);
  await addDeliverable(event.id, { sponsorId: sponsor.id }, 'banner', `${name} stage banner`);
}
async function deckPdf(title: string, fonts: boolean) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([1920, 1080]);
  page.drawRectangle({ x: 0, y: 0, width: 1920, height: 1080, color: rgb(0.1, 0.2, 0.4) });
  // Standard fonts are never embedded — exactly what the fonts rule catches.
  if (fonts) page.drawText(title, { x: 120, y: 540, size: 72, color: rgb(1, 1, 1), font: await doc.embedFont(StandardFonts.Helvetica) });
  return doc.save();
}
const portalLinks: string[] = [];

for (const [name, plan] of Object.entries(bureauPlan)) {
  const speakerId = sp[name]!;
  if (plan.honorariumCents != null) await setProfile(speakerId, { honorariumCents: plan.honorariumCents, contractSignedAt: new Date('2026-08-15'), ...(plan.bio && { bio: plan.bio }) });
  if (plan.rehearsal) {
    await saveSession(event.id, { title: `Rehearsal — ${name}`, day: d1, roomId: room[plan.rehearsal].id, startMin: at(7, 30), endMin: at(8), speakerIds: [speakerId], isRehearsal: true });
  }
  if (plan.consent) await setConsent(speakerId, plan.consent, systemClock);
  // Every speaker owes a deck from the moment they are booked: the chase
  // board can only chase a deliverable that exists, so the ones still behind
  // are the overdue rows on it.
  const deck = await addDeliverable(event.id, { speakerId }, 'deck', 'Session deck');
  if (LIFECYCLE.indexOf(plan.target) >= LIFECYCLE.indexOf('content_complete')) {
    const token = await issuePortalToken({ speakerId });
    const file = (bytes: Uint8Array, filename: string) => ({ filename, mimeType: 'application/pdf', bytes });
    if (name === 'Hollis Grant') {
      await submitVersion(token, deck.id, file(await deckPdf(name, true), 'hollis-grant-deck.pdf'), systemClock);
      for (let r = 2; r <= 5; r++) await submitVersion(token, deck.id, file(await deckPdf(name, false), `hollis-grant-deck-r${r}.pdf`), systemClock);
      portalLinks.push(`${name}: /portal/${token}`);
    }
    const final = await submitVersion(token, deck.id, file(await deckPdf(name, false), `${name.toLowerCase().replace(/\W+/g, '-')}-deck-final.pdf`), systemClock);
    await approve(final.id, systemClock);
  }
  while ((await prisma.speaker.findUniqueOrThrow({ where: { id: speakerId } })).state !== plan.target) await advance(speakerId, systemClock);
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

// A chase pass a month ago, so the outbox has history and today's board still
// owes the escalation step — the clock is injected exactly so this is possible.
const reminders = await sendDueReminders(event.id, fixedClock(new Date(systemClock.now().getTime() - 28 * DAY))).catch(() => 0);

// Every package built once, so the demo starts current and a late override shows the stale flag.
for (const r of Object.values(room)) await buildPackage(event.id, { audience: 'room', roomId: r.id }, systemClock);
await buildPackage(event.id, { audience: 'attendees' }, systemClock);

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

console.log(`Portal links (shown once; reissue from /events/${event.id}/content):\n  ${portalLinks.join('\n  ')}`);
console.log(`Seeded ${event.name}: ${d1}–${d2}, ${grid.length} sessions, ${Object.keys(bureauPlan).length} speakers advanced, ${due.length} GO marks, ${reminders} reminders. /events/${event.id}/live`);
await prisma.$disconnect();
