import type { Frame, Missed } from './stream';

/**
 * What an open view holds (D-038, LV-4): the highest seq it has applied, the
 * projection at that seq, and the "while you were away" entries it has been
 * told about. Pure, so the hook in app/live-stream.tsx is a thin shell and the
 * rules are tested here.
 *
 * - A frame at or below the held seq is dropped: a repeat is a no-op.
 * - Live mode replaces on an equal seq: a minute frame (D-046) carries the
 *   same seq and newer projected times.
 * - Missed entries are kept once each, by seq, even from a frame that is
 *   otherwise dropped (a reconnect can land after a fallback refresh already
 *   moved the seq); a dismissed entry never comes back.
 */
export type HeldState<T> = {
  seq: number;
  data: T;
  missed: Missed[];
  dismissed: number[];
  /** Frames received on the channel, applied or dropped. The e2e reads it to prove a crew stream sent nothing. */
  frames: number;
  /** Epoch ms of the last frame received, for "as of HH:MM". */
  lastFrameAt: number;
};

export function hold<T>(first: Frame<T>, at: number): HeldState<T> {
  return { seq: first.seq, data: first.data, missed: [], dismissed: [], frames: 0, lastFrameAt: at };
}

export function applyFrame<T>(s: HeldState<T>, f: Frame<T>, opts: { at: number; replaceOnEqual?: boolean; fromChannel?: boolean }): HeldState<T> {
  const fresh = (f.missed ?? []).filter((m) => !s.missed.some((x) => x.seq === m.seq) && !s.dismissed.includes(m.seq));
  const missed = fresh.length ? [...s.missed, ...fresh].sort((a, b) => a.seq - b.seq) : s.missed;
  const counted = opts.fromChannel === false ? s.frames : s.frames + 1;
  const applies = f.seq > s.seq || (f.seq === s.seq && !!opts.replaceOnEqual);
  return {
    ...s,
    ...(applies && { seq: f.seq, data: f.data }),
    missed,
    frames: counted,
    lastFrameAt: opts.fromChannel === false ? s.lastFrameAt : opts.at,
  };
}

export function dismissMissed<T>(s: HeldState<T>): HeldState<T> {
  return { ...s, missed: [], dismissed: [...s.dismissed, ...s.missed.map((m) => m.seq)] };
}

export type LinkStatus = 'live' | 'reconnecting' | 'offline';

/** The status chip's words (LV-7). `asOf` is the venue-local HH:MM of the last frame. */
export function statusText(status: LinkStatus, asOf: string) {
  if (status === 'live') return 'live';
  if (status === 'reconnecting') return `reconnecting… (as of ${asOf})`;
  return 'offline: refreshing every 5 s';
}
