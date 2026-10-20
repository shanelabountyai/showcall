import type { Clock } from '../clock';

/**
 * The live channel's loop (D-038, D-043, D-046). Pure apart from what it is
 * handed: a `LiveSource` that says what the show's committed seq is, a
 * `build` that reads a subscriber's whole projection at one snapshot, a clock
 * and a sleep. Nothing here touches the database, so the same loop runs in a
 * route handler and in a unit test with a scripted source.
 *
 * Wire format: Server-Sent Events. Every frame is `id: <seq>` and one JSON
 * line `{ seq, data, missed? }`. A client holds the highest seq it has seen
 * and drops anything at or below it, so a repeated frame is a no-op and a
 * skipped one costs nothing (the next one carries everything).
 */
export type Missed = { seq: number; kinds: string[]; actor: string; at: string };
export type Frame<T = unknown> = { seq: number; data: T; missed?: Missed[] };

/**
 * The seam O-1 swaps (D-043). Option A polls Postgres: wait one interval, read
 * the seq. Option C would wait for a poke instead. `null` means the subscriber
 * is gone (the event, or a crew link that was reissued or expired): close.
 */
export interface LiveSource {
  current(): Promise<number | null>;
  waitForChange(afterSeq: number, signal: AbortSignal): Promise<number | null>;
}

export type Sleep = (ms: number, signal: AbortSignal) => Promise<void>;

export const realSleep: Sleep = (ms, signal) => new Promise((resolve) => {
  if (signal.aborted) return resolve();
  const t = setTimeout(done, ms);
  function done() { clearTimeout(t); signal.removeEventListener('abort', done); resolve(); }
  signal.addEventListener('abort', done, { once: true });
});

/** Option A: one short query per interval, no connection held between them (D-043). */
export function pollSource(readSeq: () => Promise<number | null>, pollMs: number, sleep: Sleep = realSleep): LiveSource {
  return {
    current: readSeq,
    async waitForChange(_afterSeq, signal) {
      await sleep(pollMs, signal);
      return signal.aborted ? null : readSeq();
    },
  };
}

/** Whether a poll sends: the seq moved past what this stream last sent, or (live mode) the minute rolled. */
export function nextFrame(held: number, current: number, minuteRolled: boolean) {
  return current > held || minuteRolled;
}

export type StreamOptions = {
  clock: Clock;
  signal: AbortSignal;
  /** The seq the client holds: `Last-Event-ID`, else `?since=`, else null (a first visit). */
  lastEventId: number | null;
  maxMs: number;
  keepaliveMs?: number;
  /** Live mode (D-046): a key that changes when the venue minute rolls; a change sends a frame at the same seq. */
  minuteKey?: (now: Date) => string;
  /**
   * Crew (D-040): send only when the projection's hash changed, never because
   * another role's seq moved; and always send the current projection on connect.
   */
  hash?: (data: unknown) => string;
  /** Test hook (D-043): close after this long. The route passes it only under LIVE_TEST_HOOKS=1. */
  dropAfterMs?: number | null;
};

export type Subscriber = {
  source: LiveSource;
  /** The whole projection with its seq, from one snapshot. `since` asks for the log after it (producer views). null: gone. */
  build(since: number | null): Promise<Frame | null>;
};

const encoder = new TextEncoder();
export const sseFrame = (f: Frame) => `id: ${f.seq}\ndata: ${JSON.stringify(f)}\n\n`;

/**
 * The response body for one subscriber. Writes `retry: 2000`, then the current
 * frame at once if the client is behind (or new), then a frame per seq move
 * (and per minute for live), a keepalive comment every 15 s, and closes at
 * `maxMs`, on abort, or when the source says the subscriber is gone.
 */
export function streamResponse(sub: Subscriber, opts: StreamOptions): ReadableStream<Uint8Array> {
  const { clock } = opts;
  const keepaliveMs = opts.keepaliveMs ?? 15_000;
  const stop = new AbortController();
  const onAbort = () => stop.abort();
  if (opts.signal.aborted) stop.abort();
  else opts.signal.addEventListener('abort', onAbort, { once: true });

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const startedAt = clock.now().getTime();
      let lastWrite = startedAt;
      const elapsed = () => clock.now().getTime() - startedAt;
      const write = (s: string) => {
        if (stop.signal.aborted) return;
        controller.enqueue(encoder.encode(s));
        lastWrite = clock.now().getTime();
      };
      let sentHash: string | null = null;
      const send = (f: Frame) => {
        if (opts.hash) sentHash = opts.hash(f.data);
        write(sseFrame(f));
      };

      try {
        write('retry: 2000\n\n');
        const held = opts.lastEventId;
        const now = await sub.source.current();
        if (now === null) return;
        // `seen` is the seq this stream has dealt with, sent or not.
        let seen = held ?? -1;
        let minute = opts.minuteKey?.(clock.now());
        if (opts.hash || held === null || held < now) {
          const first = await sub.build(held !== null && held < now ? held : null);
          if (!first) return;
          send(first);
          seen = first.seq;
        } else {
          seen = Math.max(seen, now);
        }

        while (!stop.signal.aborted) {
          if (elapsed() >= opts.maxMs) break;
          if (opts.dropAfterMs != null && elapsed() >= opts.dropAfterMs) break;
          const current = await sub.source.waitForChange(seen, stop.signal);
          if (stop.signal.aborted || current === null) break;
          const key = opts.minuteKey?.(clock.now());
          const rolled = key !== undefined && key !== minute;
          if (nextFrame(seen, current, rolled)) {
            const f = await sub.build(null);
            if (!f) break;
            seen = Math.max(seen, f.seq);
            minute = key;
            if (!opts.hash || opts.hash(f.data) !== sentHash) send(f);
          }
          if (clock.now().getTime() - lastWrite >= keepaliveMs) write(': keepalive\n\n');
        }
      } catch (e) {
        if (!stop.signal.aborted) controller.error(e);
        return;
      } finally {
        opts.signal.removeEventListener('abort', onAbort);
      }
      try { controller.close(); } catch { /* already closed by a cancel */ }
    },
    cancel() {
      stop.abort();
    },
  });
}

/** Parse an SSE body into events and comments: for tests and the leak sweep. */
export function parseSse(text: string) {
  const events: { id: number | null; data: Frame }[] = [];
  const comments: string[] = [];
  let retry: number | null = null;
  for (const block of text.split('\n\n')) {
    if (!block.trim()) continue;
    let id: number | null = null;
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith(':')) comments.push(line.slice(1).trim());
      else if (line.startsWith('id: ')) id = Number(line.slice(4));
      else if (line.startsWith('data: ')) data.push(line.slice(6));
      else if (line.startsWith('retry: ')) retry = Number(line.slice(7));
    }
    if (data.length) events.push({ id, data: JSON.parse(data.join('\n')) as Frame });
  }
  return { events, comments, retry };
}
