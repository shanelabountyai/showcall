import { describe, expect, it } from 'vitest';
import { fixedClock } from '../clock';
import { localNow } from '../time';
import { nextFrame, parseSse, pollSource, streamResponse, type Frame, type Missed, type StreamOptions, type Subscriber } from './stream';

/**
 * L1.5 (D-038, D-043, D-046), pure: a scripted source whose sleep moves a
 * fixed clock instead of waiting. No database; this file runs anywhere.
 */
const POLL = 1000;

/**
 * A show whose seq follows `script`, one entry per poll (the last repeats),
 * and whose log has one entry per seq. `goneAt`: from that poll on, the
 * subscriber is gone (a reissued crew link).
 */
function scripted(script: number[], opts: { start: number; goneAt?: number }) {
  const clock = fixedClock('2026-10-13T15:00:00Z');
  let tick = 0;
  let seq = opts.start;
  const source = pollSource(
    async () => (opts.goneAt !== undefined && tick >= opts.goneAt ? null : seq),
    POLL,
    async (ms) => { clock.advance(ms); seq = script[Math.min(tick, script.length - 1)]!; tick++; },
  );
  const sub: Subscriber = {
    source,
    async build(since) {
      const missed: Missed[] | undefined = since === null ? undefined
        : Array.from({ length: seq - since }, (_, i) => ({ seq: since + i + 1, kinds: ['cue'], actor: 'Morgan Ellis', at: '2026-10-13T15:00:00.000Z' }));
      return { seq, data: { rows: `sheet at ${seq}`, minute: localNow(clock.now(), 'America/Chicago').min }, ...(missed && { missed }) };
    },
  };
  return { clock, sub };
}

async function drain(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += dec.decode(value, { stream: true });
  }
  return parseSse(text);
}

const run = (s: ReturnType<typeof scripted>, extra: Partial<StreamOptions> = {}) =>
  drain(streamResponse(s.sub, { clock: s.clock, signal: new AbortController().signal, lastEventId: null, maxMs: 10 * POLL, ...extra }));
const minuteKey = (now: Date) => String(localNow(now, 'America/Chicago').min);

describe('nextFrame', () => {
  it('sends when the seq moved past what was sent, or the minute rolled; never for a seq at or below it', () => {
    expect(nextFrame(3, 4, false)).toBe(true);
    expect(nextFrame(4, 4, false)).toBe(false);
    expect(nextFrame(5, 4, false)).toBe(false);
    expect(nextFrame(4, 4, true)).toBe(true);
  });
});

describe('the stream loop', () => {
  it('(i) a scripted series of writes gives frames strictly increasing in seq, with no repeats', async () => {
    const { events, retry } = await run(scripted([1, 1, 2, 2, 2, 5, 6, 6, 6, 7], { start: 1 }));
    expect(retry).toBe(2000);
    expect(events.map((e) => e.id)).toEqual([1, 2, 5, 6, 7]);
    for (const e of events) expect(e.data.seq).toBe(e.id);
  });

  it('(ii) resuming with Last-Event-ID 3 at seq 5 sends one frame, seq 5, with exactly seqs 4 and 5 missed', async () => {
    const { events } = await run(scripted([5], { start: 5 }), { lastEventId: 3, maxMs: 3 * POLL });
    expect(events).toHaveLength(1);
    expect(events[0]!.data.seq).toBe(5);
    expect(events[0]!.data.missed?.map((m) => m.seq)).toEqual([4, 5]);
  });

  it('(iii) resuming at the current seq sends nothing until the next change, and that change carries no missed list', async () => {
    const { events } = await run(scripted([5, 5, 5, 6], { start: 5 }), { lastEventId: 5, maxMs: 6 * POLL });
    expect(events.map((e) => e.id)).toEqual([6]);
    expect(events[0]!.data.missed).toBeUndefined();
  });

  it('(iv) a minute rollover on live sends a frame with an unchanged seq', async () => {
    const s = scripted([4], { start: 4 });
    s.clock.set('2026-10-13T15:00:58Z');
    const { events } = await run(s, { minuteKey, maxMs: 3 * POLL });
    expect(events.map((e) => e.id)).toEqual([4, 4]);
    const [a, b] = events.map((e) => (e.data.data as { minute: number }).minute);
    expect(b).toBe(a! + 1);
  });

  it('(v) the loop stops at the max life, by the injected clock', async () => {
    const s = scripted([1], { start: 1 });
    const t0 = s.clock.now().getTime();
    await run(s, { maxMs: 280_000 });
    expect(s.clock.now().getTime() - t0).toBe(280_000);
  });

  it('writes a keepalive comment after 15 s without a frame', async () => {
    const { comments } = await run(scripted([1], { start: 1 }), { maxMs: 31 * POLL });
    expect(comments).toEqual(['keepalive', 'keepalive']);
  });

  it('a crew stream (hash) sends its projection on connect, then only when the projection changed', async () => {
    // Seqs 4 and 5 are other roles' changes: this projection's hash does not move until 6.
    const hash = (d: unknown) => String(Number((d as { rows: string }).rows.split(' ').at(-1)) >= 6);
    const { events } = await run(scripted([3, 4, 5, 5, 6], { start: 3 }), { lastEventId: 3, maxMs: 6 * POLL, hash });
    expect(events.map((e) => e.id)).toEqual([3, 6]);
  });

  it('a revoked subscriber closes within one poll of the revocation (L1.6, fake source)', async () => {
    const s = scripted([2], { start: 2, goneAt: 3 });
    const t0 = s.clock.now().getTime();
    const { events } = await run(s, { maxMs: 100 * POLL });
    expect(events.map((e) => e.id)).toEqual([2]);
    // Revoked as the third poll's sleep ended (t0 + 3 polls); closed by that same read.
    expect(s.clock.now().getTime() - t0).toBe(3 * POLL);
  });

  it('closes on abort', async () => {
    const clock = fixedClock('2026-10-13T15:00:00Z');
    const ac = new AbortController();
    let polls = 0;
    const sub: Subscriber = {
      source: pollSource(async () => 1, POLL, async (ms) => { clock.advance(ms); if (++polls === 5) ac.abort(); }),
      build: async () => ({ seq: 1, data: {} }),
    };
    const { events } = await drain(streamResponse(sub, { clock, signal: ac.signal, lastEventId: null, maxMs: Number.MAX_SAFE_INTEGER }));
    expect(events.map((e) => e.id)).toEqual([1]);
    expect(polls).toBe(5);
  });

  it('dropAfter closes the stream early when the route passes it', async () => {
    const s = scripted([1], { start: 1 });
    const t0 = s.clock.now().getTime();
    await run(s, { dropAfterMs: 2 * POLL, maxMs: 280_000 });
    expect(s.clock.now().getTime() - t0).toBe(2 * POLL);
  });

  it('frames parse back to what was sent', () => {
    const f: Frame = { seq: 9, data: { a: 1 }, missed: [{ seq: 9, kinds: ['go'], actor: '', at: 'x' }] };
    expect(parseSse(`retry: 2000\n\nid: 9\ndata: ${JSON.stringify(f)}\n\n: keepalive\n\n`)).toEqual({ events: [{ id: 9, data: f }], comments: ['keepalive'], retry: 2000 });
  });
});
