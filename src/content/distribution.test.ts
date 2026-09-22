import { beforeEach, describe, expect, it } from 'vitest';
import { publishAgenda } from '../agenda/publish';
import { setConsent } from '../bureau/bureau';
import { withheld } from '../bureau/consent';
import { fixedClock } from '../clock';
import { prisma } from '../db';
import { makeDeck, makeEvent, makeSession, makeSpeaker, resetDb } from '../test/harness';
import { buildPackage, currentManifest, packageStatus } from './distribution';
import { approve, override } from './lock';

const clock = fixedClock('2026-10-01T15:00:00Z');
const D1 = '2026-10-13';

beforeEach(resetDb);

async function setup() {
  const event = await makeEvent();
  const [a, b] = [
    await prisma.room.create({ data: { eventId: event.id, name: 'Ballroom A' } }),
    await prisma.room.create({ data: { eventId: event.id, name: 'Salon B' } }),
  ];
  const [dana, marcus, priya] = [
    await makeSpeaker(event.id, { name: 'Dana Reyes' }), await makeSpeaker(event.id, { name: 'Marcus Oyelaran' }), await makeSpeaker(event.id, { name: 'Priya Natarajan' }),
  ];
  // Out of order on purpose: running order comes from the agenda, not insertion.
  const late = await makeSession(event.id, a.id, D1, 660, 720, [marcus.id]);
  const keynote = await makeSession(event.id, a.id, D1, 540, 600, [dana.id]);
  await makeSession(event.id, b.id, D1, 540, 600, [priya.id]);
  const room = { audience: 'room', roomId: a.id } as const;
  return { event, a, b, dana, marcus, priya, late, keynote, room };
}

const locked = async (speakerId: string) => { const v = await makeDeck(speakerId, 'passed'); await approve(v.id, clock); return v; };

describe('room package', () => {
  it('is in running order, names each gap, and has no consent check — playback is not distribution', async () => {
    const { event, dana, marcus, room } = await setup();
    await locked(dana.id); // Dana's consent was never recorded: still plays in her own session.
    await makeDeck(marcus.id, 'passed'); // uploaded, not approved
    await publishAgenda(event.id, clock);
    const { manifest } = await currentManifest(event.id, room);
    expect(manifest.entries.map((e) => [e.startMin, e.speaker, e.version])).toEqual([[540, 'Dana Reyes', 1]]);
    expect(manifest.gaps).toEqual([expect.objectContaining({ speaker: 'Marcus Oyelaran', label: 'Main deck' })]);
  });

  it('refuses before an agenda is published, and for another event\'s room', async () => {
    const { event, room } = await setup();
    await expect(currentManifest(event.id, room)).rejects.toThrow('Publish the agenda first');
    await publishAgenda(event.id, clock);
    const other = await makeEvent();
    await expect(currentManifest(other.id, room)).rejects.toThrow();
  });

  it('checksum is stable: the same inputs give the same sha, and an unchanged package is never rebuilt', async () => {
    const { event, dana, room } = await setup();
    await locked(dana.id);
    await publishAgenda(event.id, clock);
    const first = await buildPackage(event.id, room, clock);
    expect((await currentManifest(event.id, room)).sha256).toBe(first.sha256);
    await expect(buildPackage(event.id, room, clock)).rejects.toThrow('Package 1 is already current');
    expect(await prisma.distributionPackage.count()).toBe(1);
  });
});

describe('stale packages (the staleness fixture)', () => {
  it('an override makes the package stale, naming what changed; only a rebuild clears it', async () => {
    const { event, dana, room } = await setup();
    await locked(dana.id);
    await publishAgenda(event.id, clock);
    await buildPackage(event.id, room, clock);
    expect((await packageStatus(event.id, room)).stale).toBe(false);

    const v2 = await makeDeck(dana.id, 'passed');
    expect((await packageStatus(event.id, room)).stale).toBe(false); // an upload alone is not the show file
    await override(v2.id, 'The 11pm v2', clock);
    const s = await packageStatus(event.id, room);
    expect(s.stale).toBe(true);
    expect(s.added).toEqual([expect.stringMatching(/Dana Reyes: Main deck v2$/)]);
    expect(s.removed).toEqual([expect.stringMatching(/Dana Reyes: Main deck v1$/)]);

    const rebuilt = await buildPackage(event.id, room, clock);
    expect(rebuilt).toMatchObject({ number: 2 });
    expect((await packageStatus(event.id, room)).stale).toBe(false);
  });

  it('an agenda change is stale only for the rooms it touches', async () => {
    const { event, b, dana, priya, keynote, room } = await setup();
    await locked(dana.id);
    await locked(priya.id);
    await publishAgenda(event.id, clock);
    const roomB = { audience: 'room', roomId: b.id } as const;
    await buildPackage(event.id, room, clock);
    await buildPackage(event.id, roomB, clock);

    await prisma.session.update({ where: { id: keynote.id }, data: { startMin: 555, endMin: 615 } });
    await publishAgenda(event.id, clock);
    expect((await packageStatus(event.id, room)).stale).toBe(true);
    expect((await packageStatus(event.id, roomB)).stale).toBe(false);
    await expect(buildPackage(event.id, roomB, clock)).rejects.toThrow('already current');
  });

  it('a draft speaker change does not reach the package until it is published', async () => {
    const { event, dana, marcus, keynote, room } = await setup();
    await locked(dana.id);
    await locked(marcus.id);
    await publishAgenda(event.id, clock);
    await buildPackage(event.id, room, clock);
    await prisma.sessionSpeaker.delete({ where: { sessionId_speakerId: { sessionId: keynote.id, speakerId: dana.id } } });
    expect((await packageStatus(event.id, room)).stale).toBe(false);
    await publishAgenda(event.id, clock);
    expect((await packageStatus(event.id, room)).removed).toEqual([expect.stringMatching(/Dana Reyes: Main deck v1$/)]);
  });

  it('built packages are append-only', async () => {
    const { event, dana, room } = await setup();
    await locked(dana.id);
    await publishAgenda(event.id, clock);
    const p = await buildPackage(event.id, room, clock);
    await expect(prisma.distributionPackage.update({ where: { id: p.id }, data: { sha256: 'x' } })).rejects.toThrow();
    await expect(prisma.distributionPackage.delete({ where: { id: p.id } })).rejects.toThrow();
  });
});

describe('attendees package — the consent no-path sweep (hard rule 6)', () => {
  it('no combination of consent lets an unreleased deck into the manifest, built or current', async () => {
    const event = await makeEvent();
    const room = await prisma.room.create({ data: { eventId: event.id, name: 'Ballroom A' } });
    const combos = [null, ...[0, 1, 2, 3, 4, 5, 6, 7].map((n) => ({ recordSession: !!(n & 1), distributeDeck: !!(n & 2), publishVideo: !!(n & 4) }))];
    const speakers = [];
    for (const [i, consent] of combos.entries()) {
      const s = await makeSpeaker(event.id, { name: `Speaker ${String.fromCharCode(65 + i)}` });
      if (consent) await setConsent(s.id, consent, clock);
      const v = await locked(s.id);
      await makeSession(event.id, room.id, D1, 480 + i * 60, 520 + i * 60, [s.id]);
      speakers.push({ v, row: await prisma.speaker.findUniqueOrThrow({ where: { id: s.id } }) });
    }
    await publishAgenda(event.id, clock);
    const scope = { audience: 'attendees' } as const;
    const built = await buildPackage(event.id, scope, clock);
    const status = await packageStatus(event.id, scope);
    const stored = JSON.stringify(built.manifest);

    for (const { v, row } of speakers) {
      const reason = withheld(row, 'deck');
      const inStored = stored.includes(v.id);
      const inCurrent = status.manifest.entries.some((e) => e.versionId === v.id);
      expect({ speaker: row.name, inStored, inCurrent }).toEqual({ speaker: row.name, inStored: reason === null, inCurrent: reason === null });
      if (reason) expect(status.withheld).toContainEqual({ speaker: row.name, label: 'Main deck', reason });
    }
    // 4 of the 8 recorded combos say yes to decks; the unrecorded speaker is withheld.
    expect(status.manifest.entries).toHaveLength(4);
    expect(status.withheld).toHaveLength(5);
    // The room package carries every deck: playback is not gated.
    expect((await currentManifest(event.id, { audience: 'room', roomId: room.id })).manifest.entries).toHaveLength(9);
  });

  it('a speaker withdrawing consent makes the built attendees package stale, and the rebuild drops their deck', async () => {
    const event = await makeEvent();
    const room = await prisma.room.create({ data: { eventId: event.id, name: 'Ballroom A' } });
    const s = await makeSpeaker(event.id, { name: 'Dana Reyes' });
    await setConsent(s.id, { recordSession: true, distributeDeck: true, publishVideo: true }, clock);
    const v = await locked(s.id);
    await makeSession(event.id, room.id, D1, 540, 600, [s.id]);
    await publishAgenda(event.id, clock);
    const scope = { audience: 'attendees' } as const;
    await buildPackage(event.id, scope, clock);

    await setConsent(s.id, { recordSession: true, distributeDeck: false, publishVideo: true }, clock);
    const status = await packageStatus(event.id, scope);
    expect(status.stale).toBe(true);
    expect(status.removed).toEqual([expect.stringMatching(/Dana Reyes: Main deck v1$/)]);
    const rebuilt = await buildPackage(event.id, scope, clock);
    expect(JSON.stringify(rebuilt.manifest)).not.toContain(v.id);
  });
});
