import { inflateSync } from 'node:zlib';
import { beforeEach, describe, expect, it } from 'vitest';
import { publishAgenda } from '../agenda/publish';
import { fixedClock } from '../clock';
import { prisma } from '../db';
import { addCue, commitCascade, previewCascade } from '../runsheet/cascade';
import type { CueSpec } from '../runsheet/cues';
import { makeEvent, makeSession, resetDb } from '../test/harness';
import { callSheetStatus, CallSheetsBlocked, issueCallSheets, renderCallSheetPdf, type CallSheet } from './callsheet';

const D1 = '2026-10-13', D2 = '2026-10-14';
const clock = fixedClock('2026-10-01T15:00:00Z');
const blank = { durationMin: 0, day: null, startMin: null, anchorId: null, anchorEdge: null, offsetMin: 0, endById: null, endByEdge: null, endByOffsetMin: 0 } as const;
const spec = (label: string, s: Partial<CueSpec>): Omit<CueSpec, 'id'> => ({ ...blank, label, ...s });

beforeEach(resetDb);

const rebase = async (eventId: string) => {
  const p = await previewCascade(eventId, { rebase: true });
  await commitCascade(eventId, { rebase: true }, p.moved);
};

/**
 * A two-day show with four roles. Every label, name and note is distinct, so
 * the sweep can look for each one on every sheet it must not reach.
 */
async function scriptedShow() {
  const event = await makeEvent();
  const ballroom = await prisma.room.create({ data: { eventId: event.id, name: 'Ballroom A' } });
  const terrace = await prisma.room.create({ data: { eventId: event.id, name: 'Rooftop Terrace' } });
  const speaker = await prisma.speaker.create({ data: { eventId: event.id, name: 'Dana Okafor' } });
  const keynote = await makeSession(event.id, ballroom.id, D1, 540, 600, [speaker.id]);
  const gala = await makeSession(event.id, terrace.id, D2, 1140, 1320);
  await prisma.session.update({ where: { id: keynote.id }, data: { title: 'Opening keynote' } });
  await prisma.session.update({ where: { id: gala.id }, data: { title: 'Awards gala' } });
  await publishAgenda(event.id, clock);
  await rebase(event.id);

  const cue = (room: string, label: string, s: Partial<CueSpec>) => addCue(event.id, room, spec(label, s));
  const cues = {
    walkIn: await cue(ballroom.id, 'Walk-in playlist', { anchorId: keynote.id, anchorEdge: 'start', offsetMin: -15, durationMin: 15 }),
    lectern: await cue(ballroom.id, 'Lectern mic swap', { anchorId: keynote.id, anchorEdge: 'end', durationMin: 5 }),
    centerpieces: await cue(terrace.id, 'Centerpieces in', { day: D2, startMin: 900, durationMin: 60 }),
    toast: await cue(terrace.id, 'Toast order: chair, then treasurer', { anchorId: gala.id, anchorEdge: 'start', offsetMin: 30, durationMin: 10 }),
    floralStrike: await cue(terrace.id, 'Floral strike', { anchorId: gala.id, anchorEdge: 'end', durationMin: 30 }),
    houseLights: await cue(ballroom.id, 'House to half', { anchorId: keynote.id, anchorEdge: 'start', offsetMin: -1 }),
  };
  const role = (name: string, reportTo: string) => prisma.callRole.create({ data: { eventId: event.id, name, reportTo } });
  const roles = {
    florist: await role('Florist', 'Loading dock B, ask for Priya'),
    audio: await role('A1 Audio', 'FOH mix position'),
    sm: await role('Stage manager', 'Production office, level 2'),
    catering: await role('Catering', 'Service corridor C'),
  };
  const tags: [keyof typeof roles, (keyof typeof cues)[]][] = [
    ['florist', ['centerpieces', 'floralStrike']],
    ['audio', ['walkIn', 'lectern', 'toast']],
    ['sm', ['walkIn', 'toast', 'floralStrike', 'houseLights']],
    ['catering', []],
  ];
  await prisma.cueRole.createMany({ data: tags.flatMap(([r, cs]) => cs.map((c) => ({ roleId: roles[r].id, cueId: cues[c].id }))) });
  const moveKeynote = async (by: number) => {
    await prisma.session.update({ where: { id: keynote.id }, data: { startMin: { increment: by }, endMin: { increment: by } } });
    await publishAgenda(event.id, clock);
  };
  return { event, keynote, gala, speaker, cues, roles, tags, moveKeynote };
}

/** Every string drawn on the PDF's pages: pdf-lib writes standard-font text as WinAnsi `<hex> Tj` in Flate streams. */
function pdfText(bytes: Uint8Array) {
  const raw = Buffer.from(bytes).toString('latin1');
  const out: string[] = [];
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let body: string;
    try { body = inflateSync(Buffer.from(m[1]!, 'latin1')).toString('latin1'); } catch { body = m[1]!; }
    for (const t of body.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)) out.push(Buffer.from(t[1]!, 'hex').toString('latin1').replace(/\x96/g, '–').replace(/\x97/g, '—'));
  }
  return out.join('\n');
}

const latestIssues = async (eventId: string) => {
  const roles = await prisma.callRole.findMany({ where: { eventId }, include: { issues: { orderBy: { number: 'desc' } } } });
  return new Map(roles.map((r) => [r.name, r.issues]));
};

describe('call sheets: no over-disclosure (hard rule 7)', () => {
  it('sweep: every role sees exactly its cues and nothing that belongs to anyone else, in the issue and the PDF', async () => {
    const { event, keynote, gala, speaker, cues, roles, tags } = await scriptedShow();
    await issueCallSheets(event.id, clock);
    const issues = await latestIssues(event.id);

    const everything = [
      ...Object.values(cues).map((c) => c.label),
      ...Object.values(roles).flatMap((r) => [r.name, r.reportTo]),
      'Opening keynote', 'Awards gala', speaker.name, keynote.id, gala.id,
    ];
    expect(new Set(everything).size).toBe(everything.length);

    for (const [key, tagged] of tags) {
      const role = roles[key];
      const allowed = [role.name, role.reportTo, ...tagged.map((c) => cues[c].label)];
      const forbidden = everything.filter((s) => !allowed.includes(s));
      const [issue] = issues.get(role.name)!;
      const sheet = issue!.content as CallSheet;
      const json = JSON.stringify(sheet);
      const text = pdfText(await renderCallSheetPdf(event.name, issue!, null));

      expect(sheet.rows.map((r) => r.cueId).sort(), role.name).toEqual(tagged.map((c) => cues[c].id).sort());
      for (const row of sheet.rows) expect(Object.keys(row).sort()).toEqual(['cueId', 'day', 'endMin', 'label', 'room', 'startMin']);
      for (const s of allowed.filter(Boolean)) expect(text, `${role.name} PDF shows "${s}"`).toContain(s);
      for (const s of forbidden) {
        expect(json, `${role.name} issue leaks "${s}"`).not.toContain(s);
        expect(text, `${role.name} PDF leaks "${s}"`).not.toContain(s);
      }
    }
  });

  it('a tag on another event\'s cue never reaches the sheet', async () => {
    const a = await scriptedShow();
    const b = await scriptedShow();
    await prisma.cueRole.create({ data: { roleId: a.roles.catering.id, cueId: b.cues.toast.id } });
    await issueCallSheets(a.event.id, clock);
    const [catering] = (await latestIssues(a.event.id)).get('Catering')!;
    expect((catering!.content as CallSheet).rows).toEqual([]);
  });
});

describe('call-sheet issues', () => {
  it('keynote moves 15 min: stale until rebased, then only the affected roles re-issue, with exact diffs', async () => {
    const { event, cues, moveKeynote } = await scriptedShow();
    expect((await issueCallSheets(event.id, clock)).map((i) => i.issue.number)).toEqual([1, 1, 1, 1]);
    expect(await issueCallSheets(event.id, clock)).toEqual([]);

    await moveKeynote(15);
    expect((await callSheetStatus(event.id)).map((s) => [s.role, s.stale])).toEqual([
      ['A1 Audio', true], ['Catering', true], ['Florist', true], ['Stage manager', true],
    ]);
    await expect(issueCallSheets(event.id, clock)).rejects.toThrow(/rebase it onto v2/);
    await expect(issueCallSheets(event.id, clock)).rejects.toBeInstanceOf(CallSheetsBlocked);

    await rebase(event.id);
    const reissued = await issueCallSheets(event.id, clock);
    expect(reissued.map((i) => [i.issue.number, (i.issue.content as CallSheet).role])).toEqual([[2, 'A1 Audio'], [2, 'Stage manager']]);
    const audio = reissued[0]!.diff;
    expect(audio).toMatchObject({ added: [], removed: [] });
    expect(audio.changed.map((c) => [c.to.cueId, c.from.startMin, c.to.startMin])).toEqual([
      [cues.walkIn.id, 525, 540], [cues.lectern.id, 600, 615],
    ]);
    expect(reissued[1]!.diff.changed.map((c) => c.to.label)).toEqual(['Walk-in playlist', 'House to half']);
    expect(reissued.every((i) => i.issue.agendaVersion === 2)).toBe(true);
    expect((await callSheetStatus(event.id)).map((s) => [s.role, s.lastIssue, s.stale, s.changes])).toEqual([
      ['A1 Audio', 2, false, null], ['Catering', 1, false, null], ['Florist', 1, false, null], ['Stage manager', 2, false, null],
    ]);
  });

  it('untagging a cue and changing report-to show in the diff and on the PDF', async () => {
    const { event, cues, roles } = await scriptedShow();
    await issueCallSheets(event.id, clock);
    await prisma.cueRole.delete({ where: { cueId_roleId: { cueId: cues.centerpieces.id, roleId: roles.florist.id } } });
    await prisma.callRole.update({ where: { id: roles.florist.id }, data: { reportTo: 'Loading dock C' } });

    const [status] = (await callSheetStatus(event.id)).filter((s) => s.role === 'Florist');
    expect(status!.changes).toMatchObject({ added: [], changed: [], removed: [{ label: 'Centerpieces in' }], reportTo: { from: 'Loading dock B, ask for Priya', to: 'Loading dock C' } });

    await issueCallSheets(event.id, clock);
    const [second, first] = (await latestIssues(event.id)).get('Florist')!;
    const text = pdfText(await renderCallSheetPdf(event.name, second!, first!));
    expect(text).toContain('Changed since issue 1');
    expect(text).toContain('Removed: Centerpieces in, was 15:00–16:00 Wed, Oct 14, Rooftop Terrace');
    expect(text).toContain('Wed, Oct 14 — call 22:00');
    expect(text).toContain('22:00–22:30 · Rooftop Terrace · Floral strike');
    expect(pdfText(await renderCallSheetPdf(event.name, first!, null))).not.toContain('Changed since');
  });

  it('issues are append-only', async () => {
    const { event } = await scriptedShow();
    const [{ issue }] = (await issueCallSheets(event.id, clock)) as [{ issue: { id: string } }, ...unknown[]];
    await expect(prisma.callSheetIssue.update({ where: { id: issue.id }, data: { number: 9 } })).rejects.toThrow(/append-only/);
    await expect(prisma.callSheetIssue.delete({ where: { id: issue.id } })).rejects.toThrow(/append-only/);
  });
});
