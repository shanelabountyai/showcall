import { crewLinkEvent } from '../callsheet/portal';
import { systemClock, type Clock } from '../clock';
import { prisma } from '../db';
import { localNow } from '../time';
import { buildFrame, crewHash, eventSeq, type FrameKind } from './frames';
import { pollSource, streamResponse, type Subscriber } from './stream';

/**
 * The three live endpoints (D-040), as plain functions the route files call.
 * Each picks its projection from the path alone: no route reads a role, room
 * or audience from the client. The only query parameters read anywhere here
 * are `since` (the seq a client already holds, D-048) and the test hook
 * `dropAfter`, which is honoured only under LIVE_TEST_HOOKS=1 (D-043).
 *
 * O-4 defaults: poll 1000 ms, stream life 280 s under maxDuration 300.
 */
export const LIVE_POLL_MS = 1000;
export const LIVE_MAX_MS = 280_000;
const pollMs = () => Number(process.env.LIVE_POLL_MS) || LIVE_POLL_MS;
const maxMs = () => Number(process.env.LIVE_MAX_MS) || LIVE_MAX_MS;

export const SSE_HEADERS = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-store, no-transform',
  'X-Accel-Buffering': 'no',
} as const;
export const CREW_HEADERS = { ...SSE_HEADERS, 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' } as const;

/** The seq the client holds: the `Last-Event-ID` header its own reconnect sends, else `?since=` from its first connect. */
export function lastEventId(req: Request): number | null {
  const raw = req.headers.get('last-event-id') ?? new URL(req.url).searchParams.get('since');
  if (raw === null || !/^\d{1,9}$/.test(raw.trim())) return null;
  return Number(raw.trim());
}

/** `?dropAfter=<ms>` closes the stream early, for the reconnect e2e. Inert unless LIVE_TEST_HOOKS=1. */
export function dropAfter(req: Request): number | null {
  if (process.env.LIVE_TEST_HOOKS !== '1') return null;
  const raw = new URL(req.url).searchParams.get('dropAfter');
  return raw && /^\d{1,7}$/.test(raw) ? Number(raw) : null;
}

const notFound = (headers: Record<string, string> = {}) => new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store', ...headers } });

function stream(req: Request, sub: Subscriber, clock: Clock, extra: { minuteKey?: (now: Date) => string; hash?: (d: unknown) => string }, headers: Record<string, string>) {
  const body = streamResponse(sub, {
    clock, signal: req.signal, lastEventId: lastEventId(req), maxMs: maxMs(), dropAfterMs: dropAfter(req), ...extra,
  });
  return new Response(body, { headers });
}

const subscriber = (kind: FrameKind, key: string, readSeq: () => Promise<number | null>, clock: Clock): Subscriber => ({
  source: pollSource(readSeq, pollMs()),
  build: (since) => buildFrame(kind, key, { clock, since }),
});

/** `/api/live/:eventId/runsheet`: the producer view (run sheet, call sheets, show-file state). */
export async function runsheetStream(req: Request, eventId: string, clock: Clock = systemClock) {
  if ((await eventSeq(eventId)) === null) return notFound();
  return stream(req, subscriber('runsheet', eventId, () => eventSeq(eventId), clock), clock, {}, SSE_HEADERS);
}

/** `/api/live/:eventId/live`: stage-manager live mode; also sends when the venue minute rolls (D-046). */
export async function liveStream(req: Request, eventId: string, clock: Clock = systemClock) {
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { timezone: true } });
  if (!event) return notFound();
  const minuteKey = (now: Date) => { const l = localNow(now, event.timezone); return `${l.day} ${l.min}`; };
  return stream(req, subscriber('live', eventId, () => eventSeq(eventId), clock), clock, { minuteKey }, SSE_HEADERS);
}

/**
 * `/api/live/call/:token`: one crew role's latest issued sheet (D-041). A bad,
 * replaced or expired link is a 404 before any byte; mid-stream it is
 * re-checked every poll and the stream closes. Frames go out only when this
 * role's own projection changed (D-040).
 */
export async function crewStream(req: Request, token: string, clock: Clock = systemClock) {
  if ((await crewLinkEvent(token, clock)) === null) return notFound({ 'Referrer-Policy': 'no-referrer' });
  const readSeq = async () => {
    const eventId = await crewLinkEvent(token, clock);
    return eventId === null ? null : eventSeq(eventId);
  };
  return stream(req, subscriber('crew', token, readSeq, clock), clock, { hash: crewHash }, CREW_HEADERS);
}
