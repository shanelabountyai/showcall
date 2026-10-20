import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { publishAgenda } from '../agenda/publish';
import { issueCallSheets } from '../callsheet/callsheet';
import { issueCrewLink } from '../callsheet/portal';
import { prisma } from '../db';
import { addCue, commitCascade, previewCascade, type Change } from '../runsheet/cascade';
import type { CueSpec } from '../runsheet/cues';
import { makeEvent, makeSession, resetDb } from '../test/harness';
import { clock, today } from '../test/live-show';
import { listen, request } from '../test/sse';
import { addDays } from '../time';
import * as crewRoute from '../../app/api/live/call/[token]/route';
import type { Frame } from './stream';

beforeEach(resetDb);
afterEach(() => { vi.unstubAllEnvs(); });

const blank = { day: null, startMin: null, anchorId: null, anchorEdge: null, offsetMin: 0, endById: null, endByEdge: null, endByOffsetMin: 0 } as const;
const commit = async (eventId: string, change: Change) => commitCascade(eventId, change, (await previewCascade(eventId, change)).moved);

/**
 * A two-day show, three rooms, four roles. Every label, room, role and note is
 * distinct and none is inside another, so the sweep can look for each one in
 * every frame it must not reach (built as callsheet.test.ts builds its list).
 */
async function sweepShow() {
  const d1 = today(), d2 = addDays(d1, 1);
  const event = await makeEvent({ startDate: d1, endDate: d2 });
  const room = async (name: string) => prisma.room.create({ data: { eventId: event.id, name } });
  const [ballroom, terrace, kitchen] = [await room('Grand Ballroom'), await room('Rooftop Terrace'), await room('Service Kitchen')];
  const speaker = await prisma.speaker.create({ data: { eventId: event.id, name: 'Dana Okafor' } });
  const keynote = await makeSession(event.id, ballroom.id, d1, 540, 600, [speaker.id]);
  const gala = await makeSession(event.id, terrace.id, d2, 1140, 1320);
  await prisma.session.update({ where: { id: keynote.id }, data: { title: 'Opening keynote' } });
  await prisma.session.update({ where: { id: gala.id }, data: { title: 'Awards gala' } });
  await publishAgenda(event.id, clock);
  await commit(event.id, { rebase: true });

  const cue = (r: { id: string }, label: string, s: Partial<CueSpec>) => addCue(event.id, r.id, { ...blank, durationMin: 10, label, ...s });
  const cues = {
    walkIn: await cue(ballroom, 'Walk-in playlist', { anchorId: keynote.id, anchorEdge: 'start', offsetMin: -15, durationMin: 15 }),
    lectern: await cue(ballroom, 'Lectern mic swap', { anchorId: keynote.id, anchorEdge: 'end', durationMin: 5 }),
    houseLights: await cue(ballroom, 'House to half', { anchorId: keynote.id, anchorEdge: 'start', offsetMin: -1 }),
    centerpieces: await cue(terrace, 'Centerpieces in', { day: d2, startMin: 900, durationMin: 60 }),
    floralStrike: await cue(terrace, 'Floral strike', { anchorId: gala.id, anchorEdge: 'end', durationMin: 30 }),
    plated: await cue(kitchen, 'Plated lunch fire', { day: d1, startMin: 720, durationMin: 60 }),
    coffee: await cue(kitchen, 'Afternoon coffee urns', { day: d1, startMin: 900, durationMin: 30 }),
  };
  const role = (name: string, reportTo: string) => prisma.callRole.create({ data: { eventId: event.id, name, reportTo } });
  const roles = {
    florist: await role('Florist', 'Loading dock B, ask for Priya'),
    audio: await role('A1 Audio', 'FOH mix position'),
    sm: await role('Stage manager', 'Production office, level 2'),
    catering: await role('Catering', 'Service corridor C'),
  };
  const tags: Record<keyof typeof roles, (keyof typeof cues)[]> = {
    florist: ['centerpieces', 'floralStrike'],
    audio: ['walkIn', 'lectern'],
    sm: ['walkIn', 'houseLights'],
    catering: ['plated', 'coffee'],
  };
  await prisma.cueRole.createMany({ data: Object.entries(tags).flatMap(([r, cs]) => cs.map((c) => ({ roleId: roles[r as keyof typeof roles].id, cueId: cues[c].id }))) });
  await issueCallSheets(event.id, clock);
  const rooms = { walkIn: ballroom, lectern: ballroom, houseLights: ballroom, centerpieces: terrace, floralStrike: terrace, plated: kitchen, coffee: kitchen };
  return { event, keynote, gala, speaker, cues, roles, tags, rooms };
}

type Show = Awaited<ReturnType<typeof sweepShow>>;

/** Every string that belongs to somebody; a role may see only its own. */
function lists(show: Show, key: keyof Show['roles']) {
  const { cues, roles, tags, rooms, keynote, gala, speaker } = show;
  const everything = [
    ...Object.values(cues).flatMap((c) => [c.label, c.id]),
    ...Object.values(roles).flatMap((r) => [r.name, r.reportTo, r.id]),
    ...new Set(Object.values(rooms).map((r) => r.name)),
    'Opening keynote', 'Awards gala', speaker.name, keynote.id, gala.id,
  ];
  const own = tags[key];
  const allowed = [roles[key].name, roles[key].reportTo, roles[key].id, ...own.flatMap((c) => [cues[c].label, cues[c].id, rooms[c].name])];
  return { everything, allowed, forbidden: everything.filter((s) => !allowed.includes(s)) };
}

/** Open every role's crew stream through the real route handler. */
async function openAll(show: Show) {
  const out = {} as Record<keyof Show['roles'], ReturnType<typeof listen>>;
  for (const key of Object.keys(show.roles) as (keyof Show['roles'])[]) {
    const token = await issueCrewLink(show.event.id, show.roles[key].id);
    const { ac, req } = request(`http://localhost/api/live/call/${token}`);
    out[key] = listen(await crewRoute.GET(req, { params: Promise.resolve({ token }) }), ac);
  }
  for (const s of Object.values(out)) await s.until(() => true);
  return out;
}

/** Find every forbidden string in every frame of every role. */
function hits(show: Show, frames: Record<keyof Show['roles'], Frame[]>) {
  return (Object.keys(frames) as (keyof Show['roles'])[]).flatMap((key) => {
    const { forbidden } = lists(show, key);
    return frames[key].flatMap((f) => forbidden.filter((s) => JSON.stringify(f).includes(s)).map((s) => `${show.roles[key].name} frame ${f.seq}: "${s}"`));
  });
}

/** L1.9d (i), hard rule 7 on the channel (D-040): every role, every frame, nothing foreign; no frame at all when its own sheet did not change. */
describe('crew streams: no over-disclosure on the live channel', () => {
  it('sweep: a Catering-only move and issue, then an A1-Audio-only move and issue', async () => {
    vi.stubEnv('LIVE_POLL_MS', '100');
    const show = await sweepShow();
    const { event, cues } = show;
    const lists0 = lists(show, 'florist');
    expect(new Set(lists0.everything).size).toBe(lists0.everything.length);
    for (const a of lists0.everything) for (const b of lists0.everything) if (a !== b) expect(b.includes(a), `"${b}" contains "${a}"`).toBe(false);

    const streams = await openAll(show);
    try {
      await commit(event.id, { edits: [{ cueId: cues.coffee.id, startMin: 910 }] });
      await issueCallSheets(event.id, clock);
      await streams.catering.until((f) => JSON.stringify(f).includes('"number":2'));
      await commit(event.id, { edits: [{ cueId: cues.lectern.id, offsetMin: 5 }] });
      await issueCallSheets(event.id, clock);
      await streams.audio.until((f) => JSON.stringify(f).includes('"number":2'));
      await new Promise((r) => setTimeout(r, 500)); // a few more polls for anything that should not come
    } finally {
      await Promise.all(Object.values(streams).map((s) => s.close()));
    }

    const frames = Object.fromEntries(Object.entries(streams).map(([k, s]) => [k, s.frames()])) as Record<keyof Show['roles'], Frame[]>;
    expect(hits(show, frames)).toEqual([]);
    // The connect frame, plus one per change to the role's own sheet; nothing for anyone else's.
    expect(Object.fromEntries(Object.entries(frames).map(([k, fs]) => [k, fs.length]))).toEqual({ florist: 1, audio: 2, sm: 1, catering: 2 });
    // And each role's own cues are there: the sweep is looking at real frames.
    for (const key of Object.keys(frames) as (keyof Show['roles'])[]) {
      const last = JSON.stringify(frames[key].at(-1));
      for (const c of show.tags[key]) expect(last).toContain(show.cues[c].id);
    }
  }, 30_000);

  it('the sweep can fail: a frame built from the producer run sheet instead of the issued sheet is caught', async () => {
    const show = await sweepShow();
    const { loadRunSheet } = await import('../runsheet/cascade');
    const leaky = { seq: 1, data: await loadRunSheet(show.event.id) } as Frame;
    const found = hits(show, { florist: [leaky], audio: [leaky], sm: [leaky], catering: [leaky] });
    expect(found.length).toBeGreaterThan(0);
    expect(found.some((h) => h.startsWith('Florist') && h.includes('Plated lunch fire'))).toBe(true);
  });
});
