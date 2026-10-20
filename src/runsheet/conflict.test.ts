import { beforeEach, describe, expect, it } from 'vitest';
import { publishAgenda } from '../agenda/publish';
import { prisma } from '../db';
import { resetDb } from '../test/harness';
import { clock, logOf, seqOf, smallShow } from '../test/live-show';
import { CascadeChanged, commitCascade, cueRows, previewCascade, RowChanged, type Change } from './cascade';

beforeEach(resetDb);

const revOf = async (cueId: string) => (await prisma.cue.findUniqueOrThrow({ where: { id: cueId } })).rev;

/** What one editor holds: the row's rev when it opened the form, and its preview. */
async function open(eventId: string, change: Change) {
  return { change, preview: await previewCascade(eventId, change) };
}
const land = (eventId: string, held: Awaited<ReturnType<typeof open>>) => commitCascade(eventId, held.change, held.preview.moved);

/** L1.3 (D-039): reject and refresh on a row revision, on top of preview-equals-commit. */
describe('two edits to one row', () => {
  it('(i) both load rev 0, A commits, B is refused with RowChanged naming A; one seq, one log row', async () => {
    const { event, cues } = await smallShow();
    const rev = await revOf(cues.lunch.id);
    expect(rev).toBe(0);
    const a = await open(event.id, { actor: 'Morgan Ellis', edits: [{ cueId: cues.lunch.id, rev, startMin: 725 }] });
    const b = await open(event.id, { actor: 'Priya Natarajan', edits: [{ cueId: cues.lunch.id, rev, startMin: 740 }] });
    const [seq, n] = [await seqOf(event.id), (await logOf(event.id)).length];

    await land(event.id, a);
    const refused = await land(event.id, b).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(RowChanged);
    const rc = refused as RowChanged;
    expect(rc.by).toBe('Morgan Ellis');
    expect(rc.at).toBeInstanceOf(Date);
    expect(rc.current).toMatchObject({ id: cues.lunch.id, startMin: 725, rev: 1 });
    expect(rc.message).toContain('Morgan Ellis');

    expect(await seqOf(event.id)).toBe(seq + 1);
    const log = await logOf(event.id);
    expect(log).toHaveLength(n + 1);
    expect(log.at(-1)).toMatchObject({ actor: 'Morgan Ellis', kinds: ['cue', `cue:${cues.lunch.id}`] });
    expect((await cueRows(event.id)).find((c) => c.id === cues.lunch.id)).toMatchObject({ startMin: 725, rev: 1 });
  });

  it('(ii) edits to two different, unrelated rows both land', async () => {
    const { event, cues } = await smallShow();
    const a = await open(event.id, { actor: 'A', edits: [{ cueId: cues.lunch.id, rev: await revOf(cues.lunch.id), label: 'Lunch, plated' }] });
    const b = await open(event.id, { actor: 'B', edits: [{ cueId: cues.doors.id, rev: await revOf(cues.doors.id), durationMin: 25 }] });
    const seq = await seqOf(event.id);
    await land(event.id, a);
    await land(event.id, b);
    expect(await seqOf(event.id)).toBe(seq + 2);
    const rows = await cueRows(event.id);
    expect(rows.find((c) => c.id === cues.lunch.id)).toMatchObject({ label: 'Lunch, plated', rev: 1 });
    expect(rows.find((c) => c.id === cues.doors.id)).toMatchObject({ durationMin: 25, rev: 1 });
  });

  it('(iii) A\'s edit to row 1 moves row 2\'s anchored dependant, which B previewed: CascadeChanged, not RowChanged, and nothing is written', async () => {
    const { event, cues } = await smallShow();
    const a = await open(event.id, { actor: 'A', edits: [{ cueId: cues.stageCall.id, rev: await revOf(cues.stageCall.id), startMin: 470 }] });
    const b = await open(event.id, { actor: 'B', edits: [{ cueId: cues.doors.id, rev: await revOf(cues.doors.id), offsetMin: 5 }] });
    await land(event.id, a);
    const [seq, doors] = [await seqOf(event.id), await revOf(cues.doors.id)];
    expect(doors).toBe(0); // A moved it without writing it
    const refused = await land(event.id, b).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(CascadeChanged);
    expect(refused).not.toBeInstanceOf(RowChanged);
    expect(await seqOf(event.id)).toBe(seq);
    expect(await revOf(cues.doors.id)).toBe(0);
  });

  it('(iv) a rebase between B\'s load and commit is CascadeChanged, not RowChanged', async () => {
    const { event, keynote, cues } = await smallShow();
    // Walk-in is anchored to the stage call; re-anchor it to the keynote so a rebase moves it.
    const setup = await open(event.id, { edits: [{ cueId: cues.walkIn.id, anchorId: keynote.id, anchorEdge: 'start', offsetMin: -15 }] });
    await land(event.id, setup);
    const b = await open(event.id, { actor: 'B', edits: [{ cueId: cues.walkIn.id, rev: await revOf(cues.walkIn.id), durationMin: 20 }] });

    await prisma.session.update({ where: { id: keynote.id }, data: { startMin: 555, endMin: 615 } });
    await publishAgenda(event.id, clock);
    const rebase = await open(event.id, { rebase: true });
    await land(event.id, rebase);
    expect(rebase.preview.moved.map((m) => m.id)).toContain(cues.walkIn.id);

    const seq = await seqOf(event.id);
    const refused = await land(event.id, b).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(CascadeChanged);
    expect(refused).not.toBeInstanceOf(RowChanged);
    expect(await seqOf(event.id)).toBe(seq);
  });

  it('a preview from a stale rev is refused the same way, so the editor learns before it commits', async () => {
    const { event, cues } = await smallShow();
    await land(event.id, await open(event.id, { actor: 'A', edits: [{ cueId: cues.lunch.id, rev: 0, startMin: 725 }] }));
    await expect(previewCascade(event.id, { edits: [{ cueId: cues.lunch.id, rev: 0, startMin: 740 }] })).rejects.toThrow(RowChanged);
    // Against the current rev, the same values preview and land.
    const again = await open(event.id, { actor: 'B', edits: [{ cueId: cues.lunch.id, rev: 1, startMin: 740 }] });
    await land(event.id, again);
    expect(await revOf(cues.lunch.id)).toBe(2);
  });
});
