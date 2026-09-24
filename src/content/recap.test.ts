import { beforeEach, describe, expect, it } from 'vitest';
import { publishAgenda } from '../agenda/publish';
import { setConsent } from '../bureau/bureau';
import { withheld, withheldAll, type AssetKind } from '../bureau/consent';
import { fixedClock } from '../clock';
import { prisma } from '../db';
import { makeDeck, makeEvent, makeSession, makeSpeaker, resetDb } from '../test/harness';
import { buildPackage, packageStatus } from './distribution';
import { approve } from './lock';
import { addRecording, issueMissingRecapLinks, issueRecapLink, recapDownload, recapFiles, resolveRecap, revokeRecapLink } from './recap';

const clock = fixedClock('2026-10-15T15:00:00Z');
const D1 = '2026-10-13';
const attendees = { audience: 'attendees' } as const;
const mp4 = (name = 'keynote.mp4') => ({ filename: name, mimeType: 'video/mp4', bytes: new Uint8Array([7, 7]) });
const locked = async (speakerId: string, kind: 'deck' | 'video' = 'deck') => {
  const v = await makeDeck(speakerId, 'passed', undefined, kind);
  await approve(v.id, clock);
  return v;
};
const yes = { recordSession: true, distributeDeck: true, publishVideo: true };

beforeEach(resetDb);

async function attendee(eventId: string, name = 'Jo Park') {
  await prisma.registration.upsert({ where: { eventId_attendeeType: { eventId, attendeeType: 'General' } }, create: { eventId, attendeeType: 'General', registered: 10, capacity: 10 }, update: {} });
  return prisma.attendee.create({ data: { eventId, attendeeType: 'General', name, email: `${name.replace(' ', '.').toLowerCase()}@example.test` } });
}

describe('attendees package — decks, videos and recordings, the no-path sweep (hard rule 6)', () => {
  it('no combination of consent lets an unreleased asset of any kind into the manifest, built or current', async () => {
    const event = await makeEvent();
    const room = await prisma.room.create({ data: { eventId: event.id, name: 'Ballroom A' } });
    const combos = [null, ...[0, 1, 2, 3, 4, 5, 6, 7].map((n) => ({ recordSession: !!(n & 1), distributeDeck: !!(n & 2), publishVideo: !!(n & 4) }))];
    const files: { id: string; kind: AssetKind; owners: string[] }[] = [];
    const speakerIds: string[] = [];
    for (const [i, consent] of combos.entries()) {
      const s = await makeSpeaker(event.id, { name: `Speaker ${String.fromCharCode(65 + i)}` });
      if (consent) await setConsent(s.id, consent, clock);
      speakerIds.push(s.id);
      const session = await makeSession(event.id, room.id, D1, 480 + i * 60, 510 + i * 60, [s.id]);
      files.push({ id: (await locked(s.id)).id, kind: 'deck', owners: [s.id] }, { id: (await locked(s.id, 'video')).id, kind: 'video', owners: [s.id] });
      files.push({ id: session.id, kind: 'recording', owners: [s.id] });
    }
    // A panel of every speaker (one fully-consenting speaker is not enough), and a session nobody can consent for.
    files.push({ id: (await makeSession(event.id, room.id, D1, 1020, 1050, speakerIds)).id, kind: 'recording', owners: speakerIds });
    files.push({ id: (await makeSession(event.id, room.id, D1, 1080, 1110)).id, kind: 'recording', owners: [] });
    await publishAgenda(event.id, clock);
    for (const f of files) if (f.kind === 'recording') f.id = (await addRecording(event.id, f.id, mp4(), clock)).id;

    const built = await buildPackage(event.id, attendees, clock);
    const status = await packageStatus(event.id, attendees);
    const stored = JSON.stringify(built.manifest);
    const rows = new Map((await prisma.speaker.findMany({ where: { eventId: event.id } })).map((r) => [r.id, r]));
    for (const f of files) {
      const reason = withheldAll(f.owners.map((id) => rows.get(id)!), f.kind);
      const released = reason === null;
      expect({ ...f, inStored: stored.includes(f.id), inCurrent: status.manifest.entries.some((e) => e.versionId === f.id) })
        .toEqual({ ...f, inStored: released, inCurrent: released });
    }
    // Recorded combos: 4 say yes to decks, 4 to videos, 2 to both record and publish; the panel and the empty session never release.
    const count = (k: string) => status.manifest.entries.filter((e) => e.kind === k).length;
    expect([count('deck'), count('video'), count('recording')]).toEqual([4, 4, 2]);
    expect(status.withheld).toContainEqual(expect.objectContaining({ label: 'Session recording', reason: withheld(rows.get(speakerIds[0]!)!, 'recording') }));
  });
});

describe('recordings', () => {
  it('are refused unless video or audio on a published session, and are append-only', async () => {
    const event = await makeEvent();
    const room = await prisma.room.create({ data: { eventId: event.id, name: 'Ballroom A' } });
    const session = await makeSession(event.id, room.id, D1, 540, 600);
    await expect(addRecording(event.id, session.id, mp4(), clock)).rejects.toThrow('not on the published agenda');
    await publishAgenda(event.id, clock);
    await expect(addRecording(event.id, session.id, { ...mp4('x.pdf'), mimeType: 'application/pdf' }, clock)).rejects.toThrow('video or audio');
    await expect(addRecording((await makeEvent()).id, session.id, mp4(), clock)).rejects.toThrow('not on the published agenda');
    const r1 = await addRecording(event.id, session.id, mp4(), clock);
    expect((await addRecording(event.id, session.id, mp4('take2.mp4'), clock)).number).toBe(2);
    await expect(prisma.sessionRecording.update({ where: { id: r1.id }, data: { filename: 'y' } })).rejects.toThrow();
  });
});

describe('recap links', () => {
  async function shipped() {
    const event = await makeEvent();
    const room = await prisma.room.create({ data: { eventId: event.id, name: 'Ballroom A' } });
    const dana = await makeSpeaker(event.id, { name: 'Dana Reyes' });
    await setConsent(dana.id, yes, clock);
    const deck = await locked(dana.id);
    await makeSession(event.id, room.id, D1, 540, 600, [dana.id]);
    await publishAgenda(event.id, clock);
    await buildPackage(event.id, attendees, clock);
    const jo = await attendee(event.id);
    return { event, dana, deck, jo, token: await issueRecapLink(event.id, jo.id) };
  }

  it('serve the built package, log each download, and drop a withdrawn speaker at once — no rebuild needed', async () => {
    const { event, dana, deck, jo, token } = await shipped();
    expect((await resolveRecap(token, clock))!.files.map((f) => f.versionId)).toEqual([deck.id]);
    expect((await recapDownload(token, deck.id, clock))!.filename).toBe('deck-v1.pdf');
    expect(await prisma.recapDownload.count({ where: { attendeeId: jo.id, fileId: deck.id } })).toBe(1);

    await setConsent(dana.id, { ...yes, distributeDeck: false }, clock);
    expect(await recapFiles(event.id)).toEqual([]);
    expect((await resolveRecap(token, clock))!.files).toEqual([]);
    expect(await recapDownload(token, deck.id, clock)).toBeNull();
    expect(await prisma.recapDownload.count()).toBe(1);
  });

  it('a newly released asset waits for the producer\'s rebuild, and nothing outside the package downloads', async () => {
    const { event, dana, token } = await shipped();
    const video = await locked(dana.id, 'video');
    expect((await resolveRecap(token, clock))!.files).toHaveLength(1);
    expect(await recapDownload(token, video.id, clock)).toBeNull();
    await buildPackage(event.id, attendees, clock);
    expect((await resolveRecap(token, clock))!.files).toHaveLength(2);
  });

  it('die on revoke, reissue, or 90 days after the show; bad links and other events\' attendees look the same', async () => {
    const { event, jo, token } = await shipped();
    expect(await resolveRecap(token, fixedClock('2027-01-12T15:00:00Z'))).not.toBeNull(); // day 90 after 2026-10-14
    expect(await resolveRecap(token, fixedClock('2027-01-13T15:00:00Z'))).toBeNull();
    expect(await resolveRecap('nope', clock)).toBeNull();
    const again = await issueRecapLink(event.id, jo.id);
    expect(await resolveRecap(token, clock)).toBeNull();
    await revokeRecapLink(event.id, jo.id);
    expect(await resolveRecap(again, clock)).toBeNull();
    await expect(issueRecapLink((await makeEvent()).id, jo.id)).rejects.toThrow('No such attendee');
  });

  it('bulk issue covers only attendees without a link', async () => {
    const { event } = await shipped();
    await attendee(event.id, 'Ana Lee');
    expect((await issueMissingRecapLinks(event.id)).map((l) => l.name)).toEqual(['Ana Lee']);
    expect(await issueMissingRecapLinks(event.id)).toEqual([]);
  });
});
