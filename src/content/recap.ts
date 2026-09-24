import { createHash } from 'node:crypto';
import type { PublicSession } from '../agenda/publish';
import type { Clock } from '../clock';
import { prisma } from '../db';
import { hashToken, linkLive, newToken } from '../portal';
import { currentManifest, type Manifest } from './distribution';
import { ContentRefused, MAX_UPLOAD_BYTES, type Upload } from './pipeline';

/**
 * Post-show distribution to attendees (P1-2, D-031). Production uploads a
 * recording per published session; each attendee gets their own recap link.
 * What a link serves is the last *built* attendees package — what the
 * producer sent — intersected with the manifest built *now*, which has just
 * been through the consent gate. So a speaker who withdraws consent after the
 * build is gone from every recap page and download at once, before anyone
 * rebuilds, and a newly released asset waits for the producer's rebuild.
 */
export const RECAP_GRACE_DAYS = 90;

export async function addRecording(eventId: string, sessionId: string, file: Upload, clock: Clock) {
  if (!file.bytes.length) throw new ContentRefused('Choose a file to upload');
  if (file.bytes.length > MAX_UPLOAD_BYTES) throw new ContentRefused(`The file is over the ${MAX_UPLOAD_BYTES / 1024 / 1024} MB upload limit`);
  if (!/^(video|audio)\//.test(file.mimeType)) throw new ContentRefused('A recording must be a video or audio file');
  const agenda = await prisma.agendaVersion.findFirst({ where: { eventId }, orderBy: { number: 'desc' } });
  if (!(agenda?.snapshot as PublicSession[] | undefined)?.some((s) => s.id === sessionId)) throw new ContentRefused('That session is not on the published agenda');
  const number = (await prisma.sessionRecording.count({ where: { sessionId } })) + 1;
  return prisma.sessionRecording.create({
    data: {
      eventId, sessionId, number, filename: file.filename, mimeType: file.mimeType, bytes: Uint8Array.from(file.bytes),
      sha256: createHash('sha256').update(file.bytes).digest('hex'), uploadedAt: clock.now(),
    },
  });
}

/** Issue or reissue one attendee's link; a reissue kills the old one. The raw token is returned once. */
export async function issueRecapLink(eventId: string, attendeeId: string) {
  const { token, hash } = newToken();
  const { count } = await prisma.attendee.updateMany({ where: { id: attendeeId, eventId }, data: { recapTokenHash: hash } });
  if (!count) throw new ContentRefused('No such attendee on this event');
  return token;
}

/** A link for every attendee who has none yet. Existing links are left alone. */
export async function issueMissingRecapLinks(eventId: string) {
  const without = await prisma.attendee.findMany({ where: { eventId, recapTokenHash: null }, orderBy: { name: 'asc' }, select: { id: true, name: true } });
  const links = [];
  for (const a of without) links.push({ name: a.name, token: await issueRecapLink(eventId, a.id) });
  return links;
}

export async function revokeRecapLink(eventId: string, attendeeId: string) {
  await prisma.attendee.updateMany({ where: { id: attendeeId, eventId }, data: { recapTokenHash: null } });
}

/** What every recap link on the event serves right now: sent, and still released. */
export async function recapFiles(eventId: string) {
  const last = await prisma.distributionPackage.findFirst({ where: { eventId, audience: 'attendees' }, orderBy: { number: 'desc' } });
  if (!last) return [];
  const live = new Set((await currentManifest(eventId, { audience: 'attendees' })).manifest.entries.map((e) => e.versionId));
  return (last.manifest as Manifest).entries.filter((e) => live.has(e.versionId));
}

/** The live link's attendee, or null — a bad, revoked or expired link all look the same. */
async function attendeeOf(token: string, clock: Clock) {
  if (!token) return null;
  const a = await prisma.attendee.findUnique({
    where: { recapTokenHash: hashToken(token) },
    include: { event: { select: { name: true, endDate: true, timezone: true } } },
  });
  return a && linkLive(a.event, clock, RECAP_GRACE_DAYS) ? a : null;
}

export async function resolveRecap(token: string, clock: Clock) {
  const a = await attendeeOf(token, clock);
  return a && { attendee: a.name, event: a.event.name, files: await recapFiles(a.eventId) };
}

/** One file through a recap link, logged against the attendee; null unless it is on their page right now. */
export async function recapDownload(token: string, fileId: string, clock: Clock) {
  const a = await attendeeOf(token, clock);
  if (!a) return null;
  const entry = (await recapFiles(a.eventId)).find((e) => e.versionId === fileId);
  if (!entry) return null;
  const file = entry.kind === 'recording'
    ? await prisma.sessionRecording.findUnique({ where: { id: fileId }, select: { filename: true, mimeType: true, bytes: true } })
    : await prisma.contentVersion.findUnique({ where: { id: fileId }, select: { filename: true, mimeType: true, bytes: true } });
  if (!file) return null;
  await prisma.recapDownload.create({ data: { attendeeId: a.id, fileId, at: clock.now() } });
  return file;
}
