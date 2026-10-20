import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../db';
import { loadRunSheet } from '../runsheet/cascade';
import { resetDb } from '../test/harness';
import { clock, commit, seqOf, smallShow } from '../test/live-show';
import { listen, request } from '../test/sse';
import { buildFrame, type ProducerData } from './frames';
import { runsheetStream } from './routes';

beforeEach(resetDb);
afterEach(() => { vi.unstubAllEnvs(); });

const lunchLabel = (data: unknown) => (data as ProducerData).cues.find((c) => c.label.startsWith('Lunch'))!.label;

/** L1.5 against Postgres (D-038, D-043). */
describe('frames', () => {
  it('(vi) the frame and its seq come from one snapshot: a write committed between the seq read and the projection read is not in it', async () => {
    vi.stubEnv('LIVE_TEST_HOOKS', '1');
    const { event, cues } = await smallShow();
    const seq = await seqOf(event.id);
    const frame = await buildFrame('runsheet', event.id, {
      clock, since: null,
      hooks: { afterSeqRead: async () => { await prisma.cue.update({ where: { id: cues.lunch.id }, data: { label: 'Lunch service (moved)' } }); } },
    });
    expect(frame!.seq).toBe(seq);
    expect(lunchLabel(frame!.data)).toBe('Lunch service');
    expect(await seqOf(event.id)).toBe(seq + 1); // the write did commit

    const next = await buildFrame('runsheet', event.id, { clock, since: null });
    expect(next!.seq).toBe(seq + 1);
    expect(lunchLabel(next!.data)).toBe('Lunch service (moved)');
  });

  it('the snapshot hook is inert without LIVE_TEST_HOOKS=1', async () => {
    vi.stubEnv('LIVE_TEST_HOOKS', '');
    const { event } = await smallShow();
    let called = false;
    await buildFrame('runsheet', event.id, { clock, since: null, hooks: { afterSeqRead: async () => { called = true; } } });
    expect(called).toBe(false);
  });

  it('a producer frame resumed from an older seq carries the log after it, once each, with the actor', async () => {
    const { event, cues } = await smallShow();
    const since = await seqOf(event.id);
    await commit(event.id, { actor: 'Morgan Ellis', edits: [{ cueId: cues.lunch.id, startMin: 730 }] });
    await commit(event.id, { actor: 'Priya Natarajan', edits: [{ cueId: cues.doors.id, durationMin: 25 }] });
    const frame = await buildFrame('runsheet', event.id, { clock, since });
    expect(frame!.seq).toBe(since + 2);
    expect(frame!.missed!.map((m) => [m.seq, m.actor])).toEqual([[since + 1, 'Morgan Ellis'], [since + 2, 'Priya Natarajan']]);
    expect((await buildFrame('runsheet', event.id, { clock, since: since + 2 }))!.missed).toBeUndefined();
  });

  it('no database connection is held between polls: 12 open streams on a 10-connection pool, and a page read still completes', async () => {
    vi.stubEnv('LIVE_POLL_MS', '50');
    const { event, cues } = await smallShow();
    const seq = await seqOf(event.id);
    const streams = await Promise.all(Array.from({ length: 12 }, async () => {
      const { ac, req } = request(`http://localhost/api/live/${event.id}/runsheet`);
      return listen(await runsheetStream(req, event.id, clock), ac);
    }));
    try {
      await Promise.all(streams.map((s) => s.until((f) => f.seq === seq)));
      const t0 = performance.now();
      await loadRunSheet(event.id);
      expect(performance.now() - t0).toBeLessThan(5_000);
      // And every stream still moves: one write reaches all twelve.
      await commit(event.id, { edits: [{ cueId: cues.lunch.id, startMin: 735 }] });
      await Promise.all(streams.map((s) => s.until((f) => f.seq === seq + 1)));
    } finally {
      await Promise.all(streams.map((s) => s.close()));
    }
  }, 30_000);
});
