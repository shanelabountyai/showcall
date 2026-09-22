import type { Clock } from '../clock';
import { prisma, type Tx } from '../db';
import type { SpeakerState } from '../generated/prisma/enums';

/**
 * The speaker lifecycle (P0-4): invited → confirmed → contracted →
 * content_complete → rehearsed → showed → released. Each forward step is
 * guarded by the data it claims, so the state is a machine, not a label; the
 * guard messages double as S-10's missing-item flags. `advance` refuses a
 * skip. A step back is a producer's correction, not a guarded transition: it
 * needs a reason instead, and every move — forward or back — is appended to
 * `SpeakerTransition` (append-only, like AgendaVersion and LiveMark).
 */
export const LIFECYCLE = ['invited', 'confirmed', 'contracted', 'content_complete', 'rehearsed', 'showed', 'released'] as const satisfies readonly SpeakerState[];

/** A transition the lifecycle cannot hold. Nothing was written. */
export class SpeakerRefused extends Error {}

export type GuardCtx = {
  honorariumCents: number | null; contractSignedAt: Date | null; bio: string;
  consentRecordedAt: Date | null; hasRehearsal: boolean; hasSession: boolean;
};

/** What `to` requires, or null if `ctx` already satisfies it. */
const GUARDS: Partial<Record<SpeakerState, (ctx: GuardCtx) => string | null>> = {
  contracted: (c) => (c.honorariumCents == null || c.contractSignedAt == null) ? 'needs an honorarium and a signed contract' : null,
  content_complete: (c) => (!c.bio.trim()) ? 'needs a bio' : null,
  rehearsed: (c) => (!c.hasRehearsal) ? 'needs a booked rehearsal slot' : null,
  showed: (c) => (!c.hasSession) ? 'is not on the agenda' : null,
  released: (c) => (c.consentRecordedAt == null) ? 'needs consent recorded' : null,
};

/** What is blocking the next step from `current`, or null if there is nothing to do (already released, or the next step is earned). For display — reuses the same guard table `advance` enforces. */
export function nextStepBlocked(current: SpeakerState, ctx: GuardCtx): { to: SpeakerState; reason: string } | null {
  const i = LIFECYCLE.indexOf(current);
  if (i === LIFECYCLE.length - 1) return null;
  const to = LIFECYCLE[i + 1]!;
  const reason = GUARDS[to]?.(ctx);
  return reason ? { to, reason } : null;
}

async function loadCtx(tx: Tx, speakerId: string): Promise<GuardCtx> {
  const [speaker, sessions] = await Promise.all([
    tx.speaker.findUniqueOrThrow({ where: { id: speakerId } }),
    tx.sessionSpeaker.findMany({ where: { speakerId }, include: { session: { select: { isRehearsal: true } } } }),
  ]);
  return {
    honorariumCents: speaker.honorariumCents, contractSignedAt: speaker.contractSignedAt, bio: speaker.bio,
    consentRecordedAt: speaker.consentRecordedAt,
    hasRehearsal: sessions.some((s) => s.session.isRehearsal),
    hasSession: sessions.some((s) => !s.session.isRehearsal),
  };
}

/** Advance one step. Refuses a skip, and refuses with the guard's own reason if `to` isn't earned yet. */
export async function advance(speakerId: string, clock: Clock) {
  return prisma.$transaction(async (tx) => {
    const [row] = await tx.$queryRaw<{ name: string; state: SpeakerState }[]>`
      SELECT name, state FROM "Speaker" WHERE id = ${speakerId} FOR UPDATE`;
    if (!row) throw new SpeakerRefused(`No speaker ${speakerId}`);
    const { name, state: current } = row;
    const i = LIFECYCLE.indexOf(current);
    if (i === LIFECYCLE.length - 1) throw new SpeakerRefused(`${name} is already released`);
    const to = LIFECYCLE[i + 1]!;
    const reason = GUARDS[to]?.(await loadCtx(tx, speakerId));
    if (reason) throw new SpeakerRefused(`${name} cannot become ${to}: ${reason}`);
    await tx.speaker.update({ where: { id: speakerId }, data: { state: to } });
    return tx.speakerTransition.create({ data: { speakerId, from: current, to, at: clock.now() } });
  });
}

/** A producer's correction: back to an earlier state, with a reason. Guards do not run — the correction is what fixes a wrong one. */
export async function revert(speakerId: string, to: SpeakerState, reason: string, clock: Clock) {
  if (!reason.trim()) throw new SpeakerRefused('A step back needs a reason');
  return prisma.$transaction(async (tx) => {
    const speaker = await tx.speaker.findUnique({ where: { id: speakerId } });
    if (!speaker) throw new SpeakerRefused(`No speaker ${speakerId}`);
    if (LIFECYCLE.indexOf(to) >= LIFECYCLE.indexOf(speaker.state)) {
      throw new SpeakerRefused(`${speaker.name} is already at or before ${to}`);
    }
    await tx.speaker.update({ where: { id: speakerId }, data: { state: to } });
    return tx.speakerTransition.create({ data: { speakerId, from: speaker.state, to, reason: reason.trim(), at: clock.now() } });
  });
}

export type ProfileInput = { bio?: string; avNeeds?: string; honorariumCents?: number | null; contractSignedAt?: Date | null; headshotUrl?: string | null };

export function setProfile(speakerId: string, input: ProfileInput) {
  return prisma.speaker.update({ where: { id: speakerId }, data: input });
}

export type ConsentInput = { recordSession: boolean; distributeDeck: boolean; publishVideo: boolean };

/** Stamps `consentRecordedAt`, so "recorded" can never drift from the flags it describes. */
export function setConsent(speakerId: string, input: ConsentInput, clock: Clock) {
  return prisma.speaker.update({
    where: { id: speakerId },
    data: {
      consentRecordSession: input.recordSession, consentDistributeDeck: input.distributeDeck, consentPublishVideo: input.publishVideo,
      consentRecordedAt: clock.now(),
    },
  });
}
