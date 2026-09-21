import { prisma } from './db';
import { toDbDate, type LocalDate } from './time';

export type EventInput = { name: string; clientName: string; timezone: string; startDate: LocalDate; endDate: LocalDate };

/** A new event, under an existing client of that name or a new one. */
export async function createEvent(input: EventInput) {
  const name = input.name.trim();
  const clientName = input.clientName.trim();
  if (!name || !clientName) throw new Error('An event needs a name and a client');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: input.timezone });
  } catch {
    throw new Error(`Unknown timezone ${input.timezone}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(input.endDate) || input.endDate < input.startDate) {
    throw new Error('An event ends on or after the day it starts');
  }
  return prisma.event.create({
    data: {
      name, timezone: input.timezone, startDate: toDbDate(input.startDate), endDate: toDbDate(input.endDate),
      client: { connectOrCreate: { where: { name: clientName }, create: { name: clientName } } },
    },
  });
}
