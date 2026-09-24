import { prisma } from '../db';
import type { SpeakerState, ValidationOutcome } from '../generated/prisma/enums';
import { toDbDate, type LocalDate } from '../time';

export async function resetDb() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  const list = tables.map((t) => `"${t.tablename}"`).join(', ');
  if (list) await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

let n = 0;

export async function makeEvent(opts: { startDate?: LocalDate; endDate?: LocalDate; timezone?: string } = {}) {
  const i = ++n;
  return prisma.event.create({
    data: {
      name: `Summit ${i}`, timezone: opts.timezone ?? 'America/Chicago',
      startDate: toDbDate(opts.startDate ?? '2026-10-13'), endDate: toDbDate(opts.endDate ?? '2026-10-14'),
      client: { create: { name: `Client ${i}` } },
    },
  });
}

export async function makeSession(eventId: string, roomId: string, day: LocalDate, startMin: number, endMin: number, speakerIds: string[] = [], isRehearsal = false) {
  return prisma.session.create({
    data: {
      eventId, roomId, title: `Session ${++n}`, day: toDbDate(day), startMin, endMin, isRehearsal,
      speakers: { create: speakerIds.map((speakerId) => ({ speakerId })) },
    },
  });
}

export async function makeSpeaker(eventId: string, overrides: Partial<{ name: string; state: SpeakerState }> = {}) {
  return prisma.speaker.create({ data: { eventId, name: overrides.name ?? `Speaker ${++n}`, ...(overrides.state && { state: overrides.state }) } });
}

export async function makeStaff(maxMinutesPerDay = 720) {
  return prisma.staff.create({ data: { name: `Staff ${++n}`, maxMinutesPerDay } });
}

/** A deck version with one validation run, written directly — for guard tests, not the pipeline. */
export async function makeDeck(speakerId: string, outcome: ValidationOutcome, at = new Date('2026-10-01T15:00:00Z')) {
  const speaker = await prisma.speaker.findUniqueOrThrow({ where: { id: speakerId } });
  const deck = await prisma.deliverable.findFirst({ where: { speakerId, kind: 'deck' } })
    ?? await prisma.deliverable.create({ data: { eventId: speaker.eventId, speakerId, kind: 'deck', label: 'Main deck' } });
  const number = (await prisma.contentVersion.count({ where: { deliverableId: deck.id } })) + 1;
  return prisma.contentVersion.create({
    data: {
      deliverableId: deck.id, number, filename: `deck-v${number}.pdf`, mimeType: 'application/pdf',
      bytes: new Uint8Array([1]), byteSize: 1, sha256: '', facts: {}, uploadedAt: at,
      runs: { create: { outcome, results: [], at } },
    },
  });
}
