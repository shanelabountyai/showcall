import type { Clock } from './clock';
import { prisma } from './db';
import { hashToken } from './portal';

/**
 * Rate limits for the public portals (K5, SEC-07). Fixed-window counters in
 * Postgres, so a limit holds across every serverless instance and survives a
 * cold start. One atomic upsert per hit: no read-then-write race. A fixed
 * window allows up to twice the limit across a window edge; at these sizes
 * that burst does not matter.
 */
export const LIMITS = {
  /** Uploads, comments, receipts, COIs and budget answers through one portal link. Generous for a person, a wall for a script filling the database. */
  portalWritePerLink: { limit: 30, windowMs: 15 * 60_000 },
  /** Portal page loads, downloads and streams from one address, valid link or not. */
  portalReadPerIp: { limit: 600, windowMs: 15 * 60_000 },
} as const;

export type Limit = { limit: number; windowMs: number };

/** Refused for going over a limit. Nothing was written. */
export class RateLimited extends Error {
  constructor() { super('Too many requests through this link. Wait a few minutes and try again.'); }
}

/** Counts one hit against `key`. True when the hit is within the limit. */
export async function hit(key: string, { limit, windowMs }: Limit, clock: Clock): Promise<boolean> {
  const windowStart = new Date(Math.floor(clock.now().getTime() / windowMs) * windowMs);
  const [row] = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimit" ("key", "windowStart", "count") VALUES (${key}, ${windowStart}, 1)
    ON CONFLICT ("key", "windowStart") DO UPDATE SET "count" = "RateLimit"."count" + 1
    RETURNING "count"`;
  return row!.count <= limit;
}

/** One write through a portal link; throws `RateLimited` past the limit. Keyed by the link's hash, never the raw token. */
export async function portalWrite(token: string, clock: Clock) {
  if (!(await hit(`portal-write:${hashToken(token)}`, LIMITS.portalWritePerLink, clock))) throw new RateLimited();
}

/** The caller's address as the platform reports it. Vercel sets x-forwarded-for itself; elsewhere it is best effort. */
export function clientIp(headers: Headers) {
  return headers.get('x-forwarded-for')?.split(',')[0]?.trim() || headers.get('x-real-ip')?.trim() || 'unknown';
}

/** One portal read from `headers`' address. False past the limit: the caller answers as it would a bad link. */
export const portalRead = (headers: Headers, clock: Clock) => hit(`portal-read:${clientIp(headers)}`, LIMITS.portalReadPerIp, clock);

/** Deletes counters whose window ended over a day ago; nothing reads them once the window passes. */
export async function sweepRateLimits(clock: Clock) {
  const { count } = await prisma.rateLimit.deleteMany({ where: { windowStart: { lt: new Date(clock.now().getTime() - 86_400_000) } } });
  return count;
}
