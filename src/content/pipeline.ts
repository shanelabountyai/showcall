import { createHash } from 'node:crypto';
import type { Clock } from '../clock';
import { prisma } from '../db';
import { hashToken, linkLive, newToken } from '../portal';
import type { DeliverableKind, RuleCheck } from '../generated/prisma/enums';
import { extractFacts } from './facts';
import { evaluate } from './rules';

/**
 * Content turn-in (P0-5, D-015). The portal token is the trust boundary: a
 * speaker or sponsor holds a random link, the database holds only its
 * SHA-256, and every portal write checks that the thing being written to
 * belongs to the token's owner. Versions, validation runs and comments are
 * append-only (triggers); a new upload is a new version, never an edit.
 */
export class ContentRefused extends Error {}

/** Hard ceiling, independent of any event's rules — what the server will hold at all. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export type Owner = { speakerId: string } | { sponsorId: string };

/** A fresh link for the owner; the raw token is returned once and never stored. Reissue kills the old one. */
export async function issuePortalToken(owner: Owner) {
  const { token, hash } = newToken();
  const data = { portalTokenHash: hash };
  if ('speakerId' in owner) await prisma.speaker.update({ where: { id: owner.speakerId }, data });
  else await prisma.sponsor.update({ where: { id: owner.sponsorId }, data });
  return token;
}

const portalInclude = {
  event: { select: { name: true, endDate: true, timezone: true } },
  deliverables: {
    orderBy: { label: 'asc' },
    include: {
      versions: {
        orderBy: { number: 'desc' },
        select: {
          id: true, number: true, filename: true, byteSize: true, facts: true, uploadedAt: true,
          runs: { orderBy: { at: 'desc' } }, comments: { orderBy: { at: 'asc' } },
        },
      },
      locks: { orderBy: { number: 'desc' }, take: 1, select: { versionId: true } },
    },
  },
} as const;

/** The token's owner and what they owe, or null. Never says whether a token once existed or has expired. */
export async function resolvePortal(token: string, clock: Clock) {
  if (!token) return null;
  const portalTokenHash = hashToken(token);
  const speaker = await prisma.speaker.findUnique({ where: { portalTokenHash }, include: portalInclude });
  if (speaker) return linkLive(speaker.event, clock) ? { kind: 'speaker' as const, ...speaker } : null;
  const sponsor = await prisma.sponsor.findUnique({ where: { portalTokenHash }, include: portalInclude });
  return sponsor && linkLive(sponsor.event, clock) ? { kind: 'sponsor' as const, ...sponsor } : null;
}

const liveSelect = { id: true, event: { select: { endDate: true, timezone: true } } } as const;

async function ownerOf(token: string, clock: Clock) {
  const portalTokenHash = token ? hashToken(token) : '';
  const speaker = token ? await prisma.speaker.findUnique({ where: { portalTokenHash }, select: liveSelect }) : null;
  if (speaker && linkLive(speaker.event, clock)) return { speakerId: speaker.id, sponsorId: null };
  const sponsor = token && !speaker ? await prisma.sponsor.findUnique({ where: { portalTokenHash }, select: liveSelect }) : null;
  if (sponsor && linkLive(sponsor.event, clock)) return { speakerId: null, sponsorId: sponsor.id };
  throw new ContentRefused('This link is not valid');
}

export type Upload = { filename: string; mimeType: string; bytes: Uint8Array };

/** The portal's upload. Refused unless the deliverable is the token owner's; nothing is written on refusal. */
export async function submitVersion(token: string, deliverableId: string, file: Upload, clock: Clock) {
  const owner = await ownerOf(token, clock);
  if (file.bytes.length === 0) throw new ContentRefused('The file is empty');
  if (file.bytes.length > MAX_UPLOAD_BYTES) throw new ContentRefused(`The file is over the ${MAX_UPLOAD_BYTES / 1024 / 1024} MB upload limit`);
  const facts = await extractFacts(file.bytes, file.filename);
  const sha256 = createHash('sha256').update(file.bytes).digest('hex');

  return prisma.$transaction(async (tx) => {
    const [d] = await tx.$queryRaw<{ eventId: string; kind: DeliverableKind; speakerId: string | null; sponsorId: string | null }[]>`
      SELECT "eventId", kind, "speakerId", "sponsorId" FROM "Deliverable" WHERE id = ${deliverableId} FOR UPDATE`;
    // Same message whether the deliverable is someone else's or does not exist.
    if (!d || d.speakerId !== owner.speakerId || d.sponsorId !== owner.sponsorId) throw new ContentRefused('That deliverable is not on this link');
    const last = await tx.contentVersion.aggregate({ where: { deliverableId }, _max: { number: true } });
    const rules = await tx.validationRule.findMany({ where: { eventId: d.eventId, kind: d.kind }, orderBy: { id: 'asc' } });
    const { outcome, results } = evaluate(facts, rules);
    const at = clock.now();
    return tx.contentVersion.create({
      data: {
        deliverableId, number: (last._max.number ?? 0) + 1,
        filename: file.filename.slice(0, 255), mimeType: file.mimeType || 'application/octet-stream',
        bytes: Uint8Array.from(file.bytes), byteSize: file.bytes.length, sha256, facts, uploadedAt: at,
        runs: { create: { outcome, results, at } },
      },
      include: { runs: true },
    });
  });
}

async function addComment(versionId: string, side: 'producer' | 'submitter', body: string, requestsChanges: boolean, clock: Clock) {
  if (!body.trim()) throw new ContentRefused('A comment needs some text');
  return prisma.versionComment.create({ data: { versionId, side, body: body.trim(), requestsChanges, at: clock.now() } });
}

/** A producer's note on a version; `requestsChanges` marks it as asking for a new upload. */
export const producerComment = (versionId: string, body: string, requestsChanges: boolean, clock: Clock) =>
  addComment(versionId, 'producer', body, requestsChanges, clock);

/** The portal's reply: always the submitter side, and only on the token owner's own versions. */
export async function submitterComment(token: string, versionId: string, body: string, clock: Clock) {
  const owner = await ownerOf(token, clock);
  const v = await prisma.contentVersion.findUnique({ where: { id: versionId }, select: { deliverable: { select: { speakerId: true, sponsorId: true } } } });
  if (!v || v.deliverable.speakerId !== owner.speakerId || v.deliverable.sponsorId !== owner.sponsorId) throw new ContentRefused('That version is not on this link');
  return addComment(versionId, 'submitter', body, false, clock);
}

export async function addSponsor(eventId: string, name: string) {
  if (!name.trim()) throw new ContentRefused('A sponsor needs a name');
  return prisma.sponsor.create({ data: { eventId, name: name.trim() } });
}

export async function addDeliverable(eventId: string, owner: Owner, kind: DeliverableKind, label: string) {
  if (!label.trim()) throw new ContentRefused('A deliverable needs a label');
  const where = 'speakerId' in owner ? { id: owner.speakerId, eventId } : { id: owner.sponsorId, eventId };
  const found = 'speakerId' in owner ? await prisma.speaker.findFirst({ where }) : await prisma.sponsor.findFirst({ where });
  if (!found) throw new ContentRefused('That owner is not on this event');
  return prisma.deliverable.create({ data: { eventId, kind, label: label.trim(), ...owner } });
}

/** The params each check reads — a malformed rule would break every upload of its kind, so it is refused here. */
const PARAMS: Record<RuleCheck, Record<string, 'number' | 'list'>> = {
  max_bytes: { max: 'number' }, file_type: { types: 'list' }, aspect_ratio: { ratio: 'number', tolerance: 'number' },
  min_pixels: {}, codec_allowlist: { codecs: 'list' }, fonts_embedded: {}, manual: {},
};

export async function addRule(eventId: string, kind: DeliverableKind, check: RuleCheck, params: unknown, fix: string) {
  if (!fix.trim()) throw new ContentRefused('A rule needs a plain-language fix');
  const p = (params ?? {}) as Record<string, unknown>;
  const need = Object.entries(PARAMS[check] ?? {});
  const ok = typeof params === 'object' && !Array.isArray(params)
    && need.every(([k, t]) => t === 'number' ? typeof p[k] === 'number' : Array.isArray(p[k]) && (p[k] as unknown[]).every((x) => typeof x === 'string'))
    && ['width', 'height'].every((k) => check !== 'min_pixels' || p[k] === undefined || typeof p[k] === 'number');
  if (!PARAMS[check] || !ok) throw new ContentRefused(`A ${check} rule needs ${need.map(([k, t]) => `${k} (${t})`).join(', ') || 'no parameters beyond width/height numbers'}`);
  return prisma.validationRule.create({ data: { eventId, kind, check, params: p as object, fix: fix.trim() } });
}
