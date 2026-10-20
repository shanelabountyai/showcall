import { parseSse, type Frame } from '../live/stream';

/**
 * Read an open SSE response in the background, as a browser would, so a test
 * can make writes while the stream runs and look at every frame afterwards.
 */
export function listen(res: Response, ac: AbortController) {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let text = '';
  let ended = false;
  const done = (async () => {
    try {
      for (;;) {
        const { done: d, value } = await reader.read();
        if (d) break;
        text += dec.decode(value, { stream: true });
      }
    } catch { /* aborted */ }
    ended = true;
  })();
  const frames = (): Frame[] => parseSse(text).events.map((e) => e.data);
  return {
    frames,
    raw: () => text,
    ended: () => ended,
    done,
    /** Resolves once a frame matching `pred` has arrived; rejects after `ms`. */
    async until(pred: (f: Frame) => boolean, ms = 5_000) {
      const t0 = performance.now();
      while (performance.now() - t0 < ms) {
        if (frames().some(pred)) return;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error(`No matching frame within ${ms} ms; got seqs ${frames().map((f) => f.seq).join(', ') || 'none'}`);
    },
    async close() { ac.abort(); await done; },
  };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A GET with an abort handle, the way the route handlers receive it. */
export function request(url: string, headers: Record<string, string> = {}) {
  const ac = new AbortController();
  return { ac, req: new Request(url, { headers, signal: ac.signal }) };
}
