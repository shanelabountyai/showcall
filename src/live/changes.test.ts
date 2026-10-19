import { beforeEach, describe, expect, it } from 'vitest';
import { publishAgenda } from '../agenda/publish';
import { approve } from '../content/lock';
import { prisma } from '../db';
import { CascadeBlocked, commitCascade } from '../runsheet/cascade';
import { makeSpeaker, resetDb, makeDeck } from '../test/harness';
import { clock, commit, gate, smallShow, logOf, seqOf, untilSomeoneWaits } from '../test/live-show';

beforeEach(resetDb);

/**
 * L1.1 (D-037): one change sequence per show, bumped by trigger, one per
 * committing transaction, in commit order. These run against Postgres: the
 * ordering is the database's, so nothing here can be faked.
 */
describe('show change log and sequence', () => {
  it('(i) a cascade commit moving several cues writes exactly one ShowChange and bumps the seq by 1', async () => {
    const { event, cues } = await smallShow();
    const [seq, log] = [await seqOf(event.id), await logOf(event.id)];
    expect(seq).toBe(log.length); // gapless from the first write
    const result = await commit(event.id, { edits: [{ cueId: cues.stageCall.id, startMin: 470 }] });
    expect(result.moved.map((m) => m.id).sort()).toEqual([cues.stageCall.id, cues.doors.id, cues.walkIn.id].sort());

    expect(await seqOf(event.id)).toBe(seq + 1);
    const after = await logOf(event.id);
    expect(after).toHaveLength(log.length + 1);
    expect(after.at(-1)).toMatchObject({ seq: seq + 1, kinds: ['cue', `cue:${cues.stageCall.id}`] });
  });

  it('(ii) two concurrent transactions on one event get seqs in commit order; a reader between the commits sees the first only', async () => {
    const { event, cues } = await smallShow();
    const base = await seqOf(event.id);
    const [wrote1, hold1, hold2, wrote2] = [gate(), gate(), gate(), gate()];

    const tx1 = prisma.$transaction(async (tx) => {
      await tx.cue.update({ where: { id: cues.lunch.id }, data: { label: 'Lunch service (one)' } });
      wrote1.open();
      await hold1.done;
    }, { timeout: 15_000 });
    // tx 1 has written and holds the event row; tx 2 now queues behind it.
    await wrote1.done;
    const tx2 = prisma.$transaction(async (tx) => {
      await tx.cue.update({ where: { id: cues.stageCall.id }, data: { label: 'Stage call (two)' } });
      wrote2.open();
      await hold2.done;
    }, { timeout: 15_000 });
    await untilSomeoneWaits();
    expect(await seqOf(event.id)).toBe(base);

    hold1.open();
    await tx1;
    await wrote2.done;
    expect(await seqOf(event.id)).toBe(base + 1);
    expect((await logOf(event.id)).map((c) => c.seq).at(-1)).toBe(base + 1);

    hold2.open();
    await tx2;
    const log = await logOf(event.id);
    expect(await seqOf(event.id)).toBe(base + 2);
    expect(log.find((c) => c.kinds.includes(`cue:${cues.lunch.id}`) && c.seq > base)?.seq).toBe(base + 1);
    expect(log.find((c) => c.kinds.includes(`cue:${cues.stageCall.id}`) && c.seq > base)?.seq).toBe(base + 2);
  });

  it('(iii) a refused cascade (CascadeBlocked) leaves the seq and the log unchanged', async () => {
    const { event, cues } = await smallShow();
    const [seq, n] = [await seqOf(event.id), (await logOf(event.id)).length];
    await expect(commitCascade(event.id, { edits: [{ cueId: cues.lunch.id, startMin: 1430 }] }, [])).rejects.toThrow(CascadeBlocked);
    expect(await seqOf(event.id)).toBe(seq);
    expect(await logOf(event.id)).toHaveLength(n);
  });

  it('(iv) UPDATE and DELETE on ShowChange are refused, including a kind appended by another transaction', async () => {
    const { event } = await smallShow();
    const [row] = await logOf(event.id);
    await expect(prisma.showChange.update({ where: { id: row!.id }, data: { actor: 'someone else' } })).rejects.toThrow(/append-only/);
    await expect(prisma.showChange.delete({ where: { id: row!.id } })).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRaw`UPDATE "ShowChange" SET kinds = kinds || ARRAY['forged'] WHERE id = ${row!.id}`).rejects.toThrow(/append-only/);
    expect(await prisma.showChange.findUniqueOrThrow({ where: { id: row!.id } })).toEqual(row);
  });

  it('(v) writes on two events give independent sequences', async () => {
    const a = await smallShow();
    const b = await smallShow();
    const [sa, sb] = [await seqOf(a.event.id), await seqOf(b.event.id)];
    await commit(a.event.id, { edits: [{ cueId: a.cues.lunch.id, startMin: 730 }] });
    await commit(a.event.id, { edits: [{ cueId: a.cues.lunch.id, startMin: 740 }] });
    expect(await seqOf(a.event.id)).toBe(sa + 2);
    expect(await seqOf(b.event.id)).toBe(sb);
    expect((await logOf(b.event.id)).map((c) => c.seq)).toEqual(Array.from({ length: sb }, (_, i) => i + 1));
  });

  it('(vi) an upload after lock bumps the seq of the deliverable\'s event, and the lock itself is a change', async () => {
    const { event } = await smallShow();
    const speaker = await makeSpeaker(event.id);
    const v1 = await makeDeck(speaker.id, 'passed');
    const seq = await seqOf(event.id);
    await approve(v1.id, clock);
    expect(await seqOf(event.id)).toBe(seq + 1);
    expect((await logOf(event.id)).at(-1)?.kinds).toEqual(['lock']);
    await makeDeck(speaker.id, 'passed'); // v2, after lock: kept, never the show file
    expect(await seqOf(event.id)).toBe(seq + 2);
    expect((await logOf(event.id)).at(-1)?.kinds).toEqual(['upload']);
  });

  it('an issue and a receipt each bump; a publish and the rebase onto it are two changes', async () => {
    const { event } = await smallShow();
    const seq = await seqOf(event.id);
    const role = await prisma.callRole.findFirstOrThrow({ where: { eventId: event.id, name: 'A1 Audio' } });
    const issue = await prisma.callSheetIssue.create({ data: { roleId: role.id, number: 1, agendaVersion: 1, content: {}, issuedAt: clock.now() } });
    await prisma.callSheetReceipt.create({ data: { issueId: issue.id, confirmedAt: clock.now() } });
    expect((await logOf(event.id)).slice(-2).map((c) => c.kinds)).toEqual([['issue'], ['receipt']]);
    await prisma.event.update({ where: { id: event.id }, data: { runSheetVersion: 1 } }); // the same version: not a change
    expect(await seqOf(event.id)).toBe(seq + 2);

    await publishAgenda(event.id, clock);
    await commit(event.id, { rebase: true });
    expect(await seqOf(event.id)).toBe(seq + 4);
    expect((await logOf(event.id)).slice(-2).map((c) => c.kinds)).toEqual([['publish'], ['rebase']]);
  });
});
