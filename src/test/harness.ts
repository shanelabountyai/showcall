import { prisma } from '../db';
import type { SpeakerState } from '../generated/prisma/enums';
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

export async function makeEvent(opts: { startDate?: LocalDate; endDate?: LocalDate } = {}) {
  const i = ++n;
  return prisma.event.create({
    data: {
      name: `Summit ${i}`, timezone: 'America/Chicago',
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
