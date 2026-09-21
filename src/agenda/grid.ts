import { prisma } from '../db';
import { fromDbDate, toDbDate, type LocalDate } from '../time';

/** An edit the draft grid cannot hold. Conflicts are not this: they are allowed in the draft and block publish. */
export class GridEditRefused extends Error {}

export type SessionInput = {
  id?: string; title: string; day: LocalDate; roomId: string;
  startMin: number; endMin: number; speakerIds: string[];
};

/**
 * Create or update a draft session. The draft is free to conflict (publish
 * refuses it); what is refused here is a session that cannot belong to the
 * event at all — another event's room or speaker, a day outside the event.
 */
export async function saveSession(eventId: string, input: SessionInput) {
  const { id, speakerIds, day, ...fields } = input;
  const title = fields.title.trim();
  if (!title) throw new GridEditRefused('A session needs a title');
  if (!(fields.startMin < fields.endMin)) throw new GridEditRefused('A session must end after it starts');

  return prisma.$transaction(async (tx) => {
    const event = await tx.event.findUniqueOrThrow({ where: { id: eventId } });
    if (day < fromDbDate(event.startDate) || day > fromDbDate(event.endDate)) throw new GridEditRefused(`${day} is outside ${event.name}`);
    if (!(await tx.room.count({ where: { id: fields.roomId, eventId } }))) throw new GridEditRefused('That room is not in this event');
    if ((await tx.speaker.count({ where: { id: { in: speakerIds }, eventId } })) !== new Set(speakerIds).size) {
      throw new GridEditRefused('A speaker is not in this event');
    }
    const data = { ...fields, title, day: toDbDate(day) };
    const speakers = { create: [...new Set(speakerIds)].map((speakerId) => ({ speakerId })) };
    if (!id) return tx.session.create({ data: { ...data, eventId, speakers } });
    const { count } = await tx.session.updateMany({ where: { id, eventId }, data });
    if (count !== 1) throw new GridEditRefused(`No session ${id} in this event`);
    return tx.session.update({ where: { id }, data: { speakers: { deleteMany: {}, ...speakers } } });
  });
}

/** Remove a draft session. Published versions keep it; the next publish drops it. */
export async function deleteSession(eventId: string, id: string) {
  const { count } = await prisma.session.deleteMany({ where: { id, eventId } });
  if (count !== 1) throw new GridEditRefused(`No session ${id} in this event`);
}
