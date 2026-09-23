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
import { addThreshold, createBlock, reserve } from '../src/attrition/attrition';
import { addLine, takeSnapshot, updateLine } from '../src/budget/budget';
import { addVendor, recordDoc, sendComplianceNags } from '../src/budget/compliance';
import { addSchemaLine, createRfp, enterQuote, setQuantity, setRegistration } from '../src/rfp/rfp';
import { sendDueReminders, setLeadDays } from '../src/chase/chase';
import { createPlan, escalateDue } from '../src/contingency/contingency';
import { DAY, fixedClock, systemClock } from '../src/clock';
import { buildPackage } from '../src/content/distribution';
import { approve } from '../src/content/lock';
import { issueCrewLink } from '../src/callsheet/portal';
import { addDeliverable, addRule, addSponsor, issuePortalToken, submitVersion } from '../src/content/pipeline';
import { prisma } from '../src/db';
import { createEvent } from '../src/events';
import { addCue, commitCascade, loadRunSheet, previewCascade } from '../src/runsheet/cascade';
import type { CueSpec } from '../src/runsheet/cues';
import { assign } from '../src/staffing/staffing';
import { planLoad, saveVenue, setEventVenue } from '../src/venue/venue';
import { resetDb } from '../src/test/harness';
import { addDays, daysBetween, fromDbDate, localNow, toDbDate } from '../src/time';

if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed in production');

const TZ = 'America/Chicago';
const at = (h: number, m = 0) => h * 60 + m;

await resetDb();
const today = localNow(systemClock.now(), TZ);
const [d1, d2] = daysBetween(today.day, fromDbDate(new Date(toDbDate(today.day).getTime() + 86_400_000))) as [string, string];

const event = await createEvent({ name: 'Northwind Leadership Summit', clientName: 'Northwind Health Partners', timezone: TZ, startDate: d1, endDate: d2 });
const room = {} as Record<'Ballroom A' | 'Salon B' | 'Salon C' | 'Lakeview Terrace', { id: string }>;
// Venue profile (D-024): the house facts every load slot is planned against. Open air has no ceiling.
const venue = await saveVenue({ name: 'Lakeshore Grand Conference Center', dockBays: 2, dockOpenMin: at(6), dockCloseMin: at(23), maxTruckFt: 48, wifiMbps: 500, unionHouse: true, minCallMin: 240 });
await setEventVenue(event.id, venue.id);
for (const [name, strikeMinutes, resetMinutes, ceilingFt, rigPoints, rigPointLbs, powerAmps] of [
  ['Ballroom A', 5, 10, 24, 12, 1000, 400], ['Salon B', 5, 5, 12, 0, 0, 100], ['Salon C', 5, 5, 12, 0, 0, 100], ['Lakeview Terrace', 5, 5, null, 0, 0, 60],
] as const) {
  room[name] = await prisma.room.create({ data: { eventId: event.id, name, strikeMinutes, resetMinutes, ceilingFt, rigPoints, rigPointLbs, powerAmps } });
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
const doors: Record<string, string> = {};
for (const day of [d1, d2]) {
  const keynote = session[`${day} Ballroom A ${at(9)}`]!;
  doors[day] = (await cue('Ballroom A', 'Doors open', 30, { anchorId: keynote, anchorEdge: 'start', offsetMin: -30 }, ['Doors & Registration'])).id;
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
// The closing reception is outdoors, which is what the rain call (below) is about.
const reception = await cue('Lakeview Terrace', 'Closing reception', 90, { day: d2, startMin: at(17) }, ['Catering', 'Doors & Registration']);
// House crew rules (D-027): ten straight-time hours, a meal inside six, $25 a started half hour after that.
// Doors & Registration runs 8:30–18:30 on day 2, exactly ten hours, so the rain call's later reception is overtime.
await prisma.crewRules.create({ data: { eventId: event.id, overtimeAfterMin: 600, mealWithinMin: 360, mealBreakMin: 30, mealPenaltyCents: 25_00, mealPenaltyStepMin: 30 } });
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
const staffId: Record<string, string> = {};
for (const [name, maxMinutesPerDay, role, r, startMin, endMin] of crew) {
  const person = await prisma.staff.create({ data: { name, maxMinutesPerDay } });
  for (const day of [d1, d2]) await assign({ staffId: person.id, eventId: event.id, roomId: r && room[r].id, day, startMin, endMin, role });
  if (role === 'stage_manager') sm[r!] = person.id;
  staffId[name] = person.id;
}

// A call due before today's keynote, so a demo run later in the day shows it
// overdue and escalated; made before the GO marks so it is called like any row.
await createPlan(event.id, {
  title: 'Doors hold, day 1', trigger: 'Security sweep of Ballroom A not signed off by 8:25', ownerId: staffId['Priya Natarajan']!,
  decideBy: { roomId: room['Ballroom A'].id, day: null, startMin: null, anchorId: doors[d1]!, anchorEdge: 'start', offsetMin: -5 },
  branches: [
    { label: 'Open on time', cueEdits: [] },
    { label: 'Hold doors 10 minutes', cueEdits: [{ cueId: doors[d1]!, offsetMin: -20, durationMin: 20 }] },
  ],
});

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

// Budget and vendors. Brightline's COI lapses on day 1 and Petal & Stem has no
// W-9, so the compliance worklist has real debts; a change order after the
// client-approved snapshot gives the view some drift to show.
const vendor = {} as Record<'Lakeshore Catering' | 'Brightline AV' | 'Petal & Stem', { id: string }>;
for (const name of ['Lakeshore Catering', 'Brightline AV', 'Petal & Stem'] as const) vendor[name] = await addVendor(name);
// Load slots (D-024): the AV rig loads in the day before and out after the
// reception, so the rain call pushes the load-out 30 minutes with it.
const avRig = { vendorId: vendor['Brightline AV'].id, roomId: room['Ballroom A'].id, trucks: 2, truckFt: 48, rigPoints: 8, rigPointLbs: 750, powerAmps: 400, ceilingFt: 20 };
await planLoad(event.id, { ...avRig, kind: 'load_in', durationMin: 360, when: { ...blank, day: addDays(d1, -1), startMin: at(8) } });
await planLoad(event.id, { vendorId: vendor['Petal & Stem'].id, roomId: room['Ballroom A'].id, kind: 'load_in', trucks: 1, truckFt: 26, durationMin: 60, when: { ...blank, day: d1, startMin: at(6) } });
await planLoad(event.id, { ...avRig, kind: 'load_out', durationMin: 180, when: { ...blank, anchorId: reception.id, anchorEdge: 'end', offsetMin: 30 } });
await recordDoc(vendor['Lakeshore Catering'].id, 'coi', addDays(d1, -200), addDays(d1, 165));
await recordDoc(vendor['Lakeshore Catering'].id, 'w9', addDays(d1, -200), null);
await recordDoc(vendor['Brightline AV'].id, 'coi', addDays(d1, -365), d1);
await recordDoc(vendor['Brightline AV'].id, 'w9', addDays(d1, -365), null);
await recordDoc(vendor['Petal & Stem'].id, 'coi', addDays(d1, -30), addDays(d1, 335));
// The crew portal (D-026): these roles' links take their vendor's COI, so Brightline can send its renewal.
await prisma.callRole.update({ where: { id: roles['A1 Audio'].id }, data: { vendorId: vendor['Brightline AV'].id } });
await prisma.callRole.update({ where: { id: roles['Catering'].id }, data: { vendorId: vendor['Lakeshore Catering'].id } });
portalLinks.push(`A1 Audio crew (Brightline AV): /portal/call/${await issueCrewLink(event.id, roles['A1 Audio'].id)}`);
const line = async (category: Parameters<typeof addLine>[1]['category'], description: string, dollars: number, v?: keyof typeof vendor, clientBillable = true) =>
  addLine(event.id, { category, description, committedCents: dollars * 100, vendorId: v && vendor[v].id, clientBillable });
await line('venue', 'Ballroom and salons, two days', 48_000);
const led = await line('av', 'LED wall and switcher', 18_000, 'Brightline AV');
await line('av', 'Breakout audio packages', 6_400, 'Brightline AV');
const lunch = await line('catering', 'Lunch, 420 covers × 2 days', 30_240, 'Lakeshore Catering');
await line('catering', 'Crew meals', 1_800, 'Lakeshore Catering', false);
await line('decor', 'Stage florals', 2_600, 'Petal & Stem');
await line('talent', 'Keynote honoraria', 25_000);
await takeSnapshot(event.id, 'Client-approved v1', fixedClock(new Date(systemClock.now().getTime() - 21 * DAY)));
await updateLine(led.id, { committedCents: 19_850_00, actualCents: 9_925_00 }); // change order: second IMAG camera; deposit invoiced
await updateLine(lunch.id, { actualCents: 15_120_00 });
// The rain call: due 10:00 on day 2, anchored to the reception, so moving the
// reception moves the deadline. S-17 executes it; the rain branch moves the
// reception into Ballroom A after the closer and re-issues only the sheets it touches.
await createPlan(event.id, {
  title: 'Rain call: closing reception', trigger: 'NWS forecast ≥ 40% chance of rain 17:00–19:00, or lightning within 10 miles', ownerId: staffId['Morgan Ellis']!,
  decideBy: { roomId: room['Lakeview Terrace'].id, day: null, startMin: null, anchorId: reception.id, anchorEdge: 'start', offsetMin: -420 },
  branches: [
    { label: 'Dry: hold on the terrace', cueEdits: [] },
    {
      label: 'Rain: move to Ballroom A', cueEdits: [{ cueId: reception.id, roomId: room['Ballroom A'].id, startMin: at(17, 30) }],
      costDeltaCents: 3_800_00, costCategory: 'production', costVendorId: vendor['Brightline AV'].id,
      notices: [
        { vendorId: vendor['Lakeshore Catering'].id, body: 'Reception service moves to Ballroom A at 17:30; bars set by 17:15.' },
        { vendorId: vendor['Petal & Stem'].id, body: 'Terrace florals move to the Ballroom A cocktail rounds.' },
        { vendorId: vendor['Brightline AV'].id, body: 'Flip Ballroom A to reception audio after the closer: two wireless, background music.' },
      ],
    },
  ],
});
const escalations = await escalateDue(event.id, systemClock);
const nags = await sendComplianceNags(event.id, fixedClock(new Date(systemClock.now().getTime() - 10 * DAY))).catch(() => 0);

// A second event, 40 days out, so the room block has a decision coming due:
// 280 room-nights at $239, 50% by D-60 met, 80% by D-30 ten days away and
// projecting 19 short. Pickup is booked on the days it happened.
const s1 = addDays(d1, 40);
const kickoff = await createEvent({ name: 'Northwind Fall Sales Kickoff', clientName: 'Northwind Health Partners', timezone: TZ, startDate: s1, endDate: addDays(s1, 1) });
const hotel = await addVendor('Lakeview Grand Hotel');
await recordDoc(hotel.id, 'coi', addDays(d1, -150), addDays(d1, 215));
await recordDoc(hotel.id, 'w9', addDays(d1, -150), null);
const hotelBlock = await createBlock(kickoff.id, {
  hotelId: hotel.id, rateCents: 23_900, contractedOn: addDays(d1, -120), cutoffOn: addDays(s1, -21),
  nights: [{ night: addDays(s1, -1), rooms: 40 }, { night: s1, rooms: 120 }, { night: addDays(s1, 1), rooms: 120 }],
});
await addThreshold(hotelBlock.id, addDays(s1, -60), 50);
await addThreshold(hotelBlock.id, addDays(s1, -30), 80);
const onDay = (n: number) => fixedClock(`${addDays(d1, n)}T17:00:00Z`);
const stay = (arrive: number, nights: number) => ({ arriveOn: addDays(s1, arrive), departOn: addDays(s1, arrive + nights) });
await reserve(hotelBlock.id, { kind: 'attendee', guest: 'Hotel link — early registrants', rooms: 40, ...stay(-1, 3) }, onDay(-100));
await reserve(hotelBlock.id, { kind: 'attendee', guest: 'Hotel link — regional teams', rooms: 30, ...stay(0, 2) }, onDay(-50));
for (const name of ['Priya Castellanos', 'Jonah Whitfield']) {
  const speakerId = (await prisma.speaker.create({ data: { eventId: kickoff.id, name } })).id;
  await reserve(hotelBlock.id, { kind: 'speaker', speakerId, ...stay(0, 2) }, onDay(-10));
}
for (const s of await prisma.staff.findMany({ orderBy: { name: 'asc' }, take: 2 })) await reserve(hotelBlock.id, { kind: 'staff', staffId: s.id, ...stay(0, 2) }, onDay(-8));
await reserve(hotelBlock.id, { kind: 'vip', guest: 'Northwind CEO', ...stay(0, 2) }, onDay(-5));

// RFPs: line-item schemas as data, the kickoff's registration (260), and a
// catering RFP with three quotes — the cheapest leaves the afternoon break
// out, and the lowest complete one comes from a vendor whose COI lapses on
// day 1, so awarding it is flagged. S-15 awards it.
const SCHEMA = {
  catering: [['Breakfast', 'per_head'], ['Lunch', 'per_head'], ['Afternoon break', 'per_head'], ['Service staff', 'each'], ['Linens', 'flat'], ['Delivery & setup', 'flat']],
  av: [['Projectors', 'each'], ['LED wall', 'flat'], ['Audio package', 'flat'], ['Technicians', 'each'], ['Delivery & setup', 'flat']],
  decor: [['Centerpieces', 'each'], ['Stage florals', 'flat'], ['Delivery & setup', 'flat']],
} as const;
for (const [category, lines] of Object.entries(SCHEMA)) for (const [label, basis] of lines) await addSchemaLine(category as keyof typeof SCHEMA, label, basis);
for (const [type, registered, capacity] of [['Sales reps', 215, 250], ['Regional managers', 30, 30], ['Guests', 15, 20]] as const) await setRegistration(kickoff.id, type, registered, capacity);
const rfp = await createRfp(kickoff.id, 'catering', 'Kickoff catering', onDay(-12));
const rfpItems = await prisma.rfpItem.findMany({ where: { rfpId: rfp.id }, orderBy: { position: 'asc' } });
await setQuantity(rfpItems.find((i) => i.label === 'Service staff')!.id, 12);
const harvest = await addVendor('Harvest Table Co.');
await recordDoc(harvest.id, 'coi', addDays(d1, -90), addDays(d1, 275));
await recordDoc(harvest.id, 'w9', addDays(d1, -90), null);
const summit = await addVendor('Summit Hospitality Group');
await recordDoc(summit.id, 'coi', addDays(s1, -365), s1);
await recordDoc(summit.id, 'w9', addDays(s1, -365), null);
type Ans = Record<string, number | 'excluded'>; // a label maps to its extra cost in dollars, or is excluded; unlisted is included
const quote = (vendorId: string, baseDollars: number, basePerHead: boolean, ans: Ans, day: number) => enterQuote(rfp.id, {
  vendorId, baseCents: baseDollars * 100, basePerHead, receivedOn: addDays(d1, day),
  lines: rfpItems.map((i) => { const a = ans[i.label]; return a == null ? { itemId: i.id, inclusion: 'included' as const } : a === 'excluded' ? { itemId: i.id, inclusion: a } : { itemId: i.id, inclusion: 'extra' as const, unitCents: a * 100 }; }),
});
await quote(vendor['Lakeshore Catering'].id, 72, true, { 'Service staff': 300 }, -8);
await quote(harvest.id, 66, true, { 'Afternoon break': 'excluded', Linens: 450, 'Delivery & setup': 600 }, -6);
await quote(summit.id, 20_500, false, { 'Afternoon break': 6 }, -4);

console.log(`Portal links (shown once; reissue from /events/${event.id}/content):\n  ${portalLinks.join('\n  ')}`);
console.log(`Seeded ${event.name}: ${d1}–${d2}, ${grid.length} sessions, ${Object.keys(bureauPlan).length} speakers advanced, ${due.length} GO marks, ${reminders} reminders, ${nags} compliance nags, ${escalations} escalations. /events/${event.id}/live`);
console.log(`Seeded ${kickoff.name}: ${s1}, one room block with an attrition decision due, a catering RFP with three quotes. /events/${kickoff.id}/rooms`);
await prisma.$disconnect();
