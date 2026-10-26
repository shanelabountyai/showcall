'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { systemClock } from '@/src/clock';
import { applyFrame, dismissMissed, hold, statusText, type HeldState, type LinkStatus } from '@/src/live/client-state';
import type { Frame, Missed } from '@/src/live/stream';
import { hhmm, localNow } from '@/src/time';
import { Poll } from './events/[eventId]/live/poll';

/**
 * The live channel in the browser (LV-4, LV-7, D-043). One `EventSource` per
 * view. The page renders the frame at seq N on the server and the stream
 * opens with `?since=N` (D-048); the browser's own reconnects send
 * `Last-Event-ID`. Frame rules live in src/live/client-state.ts.
 *
 * - A hidden tab closes its stream and reopens it on show, catching up like
 *   any reconnect: a tab left open overnight holds no function instance.
 * - After three failed reconnects in a row the page falls back to the old
 *   5 s refresh (`Poll`) while the stream keeps retrying (the browser's own
 *   retry, or ours when it gives up, and at once when the network returns);
 *   the first frame back unmounts it.
 */
export function useLiveStream<T>(url: string, initial: Frame<T>, opts: { replaceOnEqual?: boolean } = {}) {
  const [state, setState] = useState<HeldState<T>>(() => hold(initial, systemClock.now().getTime()));
  const [status, setStatus] = useState<LinkStatus>('live');
  const held = useRef(state.seq);
  // eslint-disable-next-line react-hooks/refs -- the stream effect reads the latest seq on reopen without re-subscribing; moving this write into an effect changes reconnect timing (D-052)
  held.current = state.seq;
  const replace = !!opts.replaceOnEqual;

  // A server re-render (an action's redirect, or the Poll fallback) brings a newer first frame.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- merges a newer server-rendered first frame into live state; the merge needs the previous state, so it cannot be derived during render (D-052)
    setState((s) => applyFrame(s, initial, { at: 0, replaceOnEqual: replace, fromChannel: false }));
  }, [initial, replace]);

  useEffect(() => {
    let es: EventSource | null = null;
    let failures = 0;
    let slow: ReturnType<typeof setTimeout> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    // The last seq this view heard on the channel. A reopen resumes from it, not from a
    // page re-render's seq, so "while you were away" lists what the channel missed.
    let heard = held.current;
    const open = () => {
      clearTimeout(retry);
      es?.close();
      const u = new URL(url, window.location.href);
      u.searchParams.set('since', String(heard));
      const source = new EventSource(u);
      es = source;
      source.onopen = () => { failures = 0; clearTimeout(slow); setStatus('live'); };
      source.onmessage = (e: MessageEvent<string>) => {
        const frame = JSON.parse(e.data) as Frame<T>;
        heard = Math.max(heard, frame.seq);
        setState((s) => applyFrame(s, frame, { at: systemClock.now().getTime(), replaceOnEqual: replace }));
        failures = 0;
        setStatus('live');
      };
      source.onerror = () => {
        failures += 1;
        clearTimeout(slow);
        if (failures >= 3) setStatus('offline');
        // A planned close at the end of a stream's life reconnects within the 2 s retry: no flash.
        else slow = setTimeout(() => setStatus((st) => (st === 'live' ? 'reconnecting' : st)), 3000);
        // The browser retries by itself unless it gave up (a 404, or a network it calls futile); then we do.
        if (source.readyState === EventSource.CLOSED) retry = setTimeout(() => { if (!document.hidden) open(); }, failures >= 3 ? 5000 : 2000);
      };
    };
    const close = () => { clearTimeout(retry); es?.close(); es = null; };
    const onVisibility = () => {
      if (document.hidden) close();
      else if (!es) open();
    };
    const onOnline = () => { if (!document.hidden && (!es || es.readyState !== EventSource.OPEN)) open(); };
    if (!document.hidden) open();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
      clearTimeout(slow);
      close();
    };
  }, [url, replace]);

  return { state, status, dismiss: () => setState((s) => dismissMissed(s)) };
}

type Live<T> = ReturnType<typeof useLiveStream<T>> & { timeZone: string };
const LiveContext = createContext<Live<unknown> | null>(null);

/** One stream for a page; components under it read the current frame with `useLive`. */
export function LiveProvider<T>({ url, initial, timeZone, replaceOnEqual, children }: { url: string; initial: Frame<T>; timeZone: string; replaceOnEqual?: boolean; children: ReactNode }) {
  const live = useLiveStream<T>(url, initial, { replaceOnEqual });
  return <LiveContext.Provider value={{ ...(live as Live<unknown>), timeZone }}>{children}</LiveContext.Provider>;
}

export function useLive<T>() {
  const live = useContext(LiveContext);
  if (!live) throw new Error('useLive outside a LiveProvider');
  return live as Live<T>;
}

/**
 * `live`, `reconnecting… (as of HH:MM)` or `offline: refreshing every 5 s`.
 * HH:MM is the venue time of the last frame, so an SM can tell how old the
 * screen is. Not a `role="status"`: pages already use that for their own news.
 */
export function LiveChip() {
  const { state, status, timeZone } = useLive();
  const asOf = hhmm(localNow(new Date(state.lastFrameAt || systemClock.now().getTime()), timeZone).min);
  return (
    <>
      <p aria-live="polite" data-testid="live-chip" data-status={status} data-seq={state.seq} data-frames={state.frames}>
        <small>● {statusText(status, asOf)}</small>
      </p>
      {status === 'offline' && <Poll ms={5000} />}
    </>
  );
}

/** "While you were away": the log entries a reconnect caught up, each once, until dismissed (producer views only, D-038). */
export function MissedList({ describe }: { describe?: (m: Missed) => string }) {
  const { state, dismiss, timeZone } = useLive();
  if (state.missed.length === 0) return null;
  return (
    <section aria-label="While you were away">
      <h2>While you were away</h2>
      <ul>
        {state.missed.map((m) => (
          <li key={m.seq}>
            {hhmm(localNow(new Date(m.at), timeZone).min)} · {m.actor || 'someone'} · {describe ? describe(m) : m.kinds.filter((k) => !k.includes(':')).join(', ')}
          </li>
        ))}
      </ul>
      <button type="button" onClick={dismiss}>Dismiss</button>
    </section>
  );
}
