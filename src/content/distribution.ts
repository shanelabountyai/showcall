import { createHash } from 'node:crypto';
import type { PublicSession } from '../agenda/publish';
import { releasable } from '../bureau/consent';
import type { Clock } from '../clock';
import { prisma, type Tx } from '../db';
import type { Audience } from '../generated/prisma/enums';
import { ContentRefused } from './pipeline';

/**
 * Distribution packages (D-016). A *room* package is the playback set for
 * one room: each published session's speakers' locked decks and videos, in
 * running order, with a named gap for anything not locked. No consent check —
 * playback is the presenter's own session, not distribution. An *attendees*
 * package is the post-show deck bundle, and every entry passes `releasable`
 * first: a withheld deck is not in the manifest at all (hard rule 6).
 *
 * A package is stale by content (D-009): stale when the manifest built now
 * has another checksum than the last build. Only a rebuild clears it.
 */
export type Entry = {
  sessionId: string; day: string; startMin: number; session: string; room: string;
  speaker: string; label: string; kind: string; versionId: string; version: number; filename: string; sha256: string;
};
export type Gap = { sessionId: string; session: string; speaker: string; label: string };
/** Key order is fixed by construction, so JSON.stringify is canonical and the checksum is stable. */
export type Manifest = { entries: Entry[]; gaps: Gap[] };
export type Scope = { audience: 'room'; roomId: string } | { audience: 'attendees' };

const checksum = (m: Manifest) => createHash('sha256').update(JSON.stringify(m)).digest('hex');

/** What the package would hold if built now. `withheld` is for the producer's eyes and never stored. */
export async function currentManifest(eventId: string, scope: Scope, db: Tx = prisma) {
  const agenda = await db.agendaVersion.findFirst({ where: { eventId }, orderBy: { number: 'desc' } });
  if (!agenda) throw new ContentRefused('Publish the agenda first — packages follow its running order');
  let sessions = agenda.snapshot as PublicSession[];
  if (scope.audience === 'room') {
    const room = await db.room.findFirst({ where: { id: scope.roomId, eventId } });
    if (!room) throw new ContentRefused('That room is not on this event');
    sessions = sessions.filter((s) => s.room === room.name);
  }
  sessions = [...sessions].sort((a, b) => a.day.localeCompare(b.day) || a.startMin - b.startMin || a.room.localeCompare(b.room));

  const kinds = scope.audience === 'room' ? ['deck', 'video'] as const : ['deck'] as const;
  // Speakers as published, so a draft swap does not reach a package until it is published.
  const found = await db.speaker.findMany({
    where: { eventId, id: { in: sessions.flatMap((s) => s.speakerIds ?? []) } },
    include: {
      deliverables: {
        where: { kind: { in: [...kinds] } }, orderBy: { label: 'asc' },
        include: { locks: { orderBy: { number: 'desc' }, take: 1, include: { version: { select: { id: true, number: true, filename: true, sha256: true } } } } },
      },
    },
  });
  const byId = new Map(found.map((sp) => [sp.id, sp]));

  const entries: (Entry & { speakerOf: (typeof found)[number] })[] = [];
  const gaps: Gap[] = [];
  for (const s of sessions) {
    // Snapshots published before D-016 carry no speaker ids, and contribute nothing.
    const speakers = (s.speakerIds ?? []).flatMap((id) => byId.get(id) ?? []);
    for (const sp of speakers) for (const d of sp.deliverables) {
      const v = d.locks[0]?.version;
      if (!v) { gaps.push({ sessionId: s.id, session: s.title, speaker: sp.name, label: d.label }); continue; }
      entries.push({
        sessionId: s.id, day: s.day, startMin: s.startMin, session: s.title, room: s.room,
        speaker: sp.name, label: d.label, kind: d.kind, versionId: v.id, version: v.number, filename: v.filename, sha256: v.sha256,
        speakerOf: sp,
      });
    }
  }
  const strip = ({ speakerOf: _, ...e }: (typeof entries)[number]): Entry => e;

  if (scope.audience === 'room') {
    const manifest: Manifest = { entries: entries.map(strip), gaps };
    return { agendaVersion: agenda.number, manifest, sha256: checksum(manifest), withheld: [] };
  }
  // Attendees: one copy of each deck, then the consent gate. Unlocked decks are simply not ready.
  const unique = entries.filter((e, i) => entries.findIndex((x) => x.versionId === e.versionId) === i);
  const gate = releasable(unique, (e) => e.speakerOf, 'deck');
  const manifest: Manifest = { entries: gate.released.map(strip), gaps: [] };
  const withheld = gate.withheld.map(({ item, reason }) => ({ speaker: item.speaker, label: item.label, reason }));
  return { agendaVersion: agenda.number, manifest, sha256: checksum(manifest), withheld };
}

const scopeWhere = (eventId: string, scope: Scope) => ({ eventId, audience: scope.audience as Audience, roomId: scope.audience === 'room' ? scope.roomId : null });

const line = (e: Entry | Gap) => 'versionId' in e ? `${e.session} — ${e.speaker}: ${e.label} v${e.version}` : `${e.session} — ${e.speaker}: ${e.label} (not locked)`;

/** The last build, the manifest now, and whether they differ — with what changed, line by line. */
export async function packageStatus(eventId: string, scope: Scope) {
  const [now, last] = await Promise.all([
    currentManifest(eventId, scope),
    prisma.distributionPackage.findFirst({ where: scopeWhere(eventId, scope), orderBy: { number: 'desc' } }),
  ]);
  const before = last ? [...(last.manifest as Manifest).entries, ...(last.manifest as Manifest).gaps].map(line) : [];
  const after = [...now.manifest.entries, ...now.manifest.gaps].map(line);
  return {
    ...now, last,
    stale: !last || last.sha256 !== now.sha256,
    added: after.filter((l) => !before.includes(l)),
    removed: before.filter((l) => !after.includes(l)),
  };
}

/** Build the next package. Refused when nothing changed since the last build — an unchanged package is never rebuilt. */
export async function buildPackage(eventId: string, scope: Scope, clock: Clock) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Event" WHERE id = ${eventId} FOR UPDATE`;
    const now = await currentManifest(eventId, scope, tx);
    const last = await tx.distributionPackage.findFirst({ where: scopeWhere(eventId, scope), orderBy: { number: 'desc' } });
    if (last?.sha256 === now.sha256) throw new ContentRefused(`Package ${last.number} is already current — nothing to rebuild`);
    return tx.distributionPackage.create({
      data: { ...scopeWhere(eventId, scope), number: (last?.number ?? 0) + 1, agendaVersion: now.agendaVersion, manifest: now.manifest, sha256: now.sha256, builtAt: clock.now() },
    });
  });
}
