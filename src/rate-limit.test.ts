import { beforeEach, describe, expect, it } from 'vitest';
import { fixedClock } from './clock';
import { prisma } from './db';
import { clientIp, hit, LIMITS, portalRead, portalWrite, RateLimited, sweepRateLimits } from './rate-limit';
import { resetDb } from './test/harness';

beforeEach(resetDb);

describe('rate limits (K5, SEC-07)', () => {
  it('counts hits per key in a fixed window held in Postgres, and a new window starts fresh', async () => {
    const clock = fixedClock('2026-10-01T15:00:00Z');
    const lim = { limit: 3, windowMs: 60_000 };
    expect(await Promise.all([1, 2, 3].map(() => hit('k', lim, clock)))).toEqual([true, true, true]);
    expect(await hit('k', lim, clock)).toBe(false);
    expect(await hit('other', lim, clock)).toBe(true);
    clock.advance(60_000);
    expect(await hit('k', lim, clock)).toBe(true);
  });

  it('the N+1th write through one portal link in the window is refused; another link is not affected', async () => {
    const clock = fixedClock('2026-10-01T15:00:00Z');
    for (let i = 0; i < LIMITS.portalWritePerLink.limit; i++) await portalWrite('link-a', clock);
    await expect(portalWrite('link-a', clock)).rejects.toBeInstanceOf(RateLimited);
    await expect(portalWrite('link-b', clock)).resolves.toBeUndefined();
    // The raw token is never stored.
    expect((await prisma.rateLimit.findMany()).some((r) => r.key.includes('link-a'))).toBe(false);
  });

  it('reads are counted per address, from x-forwarded-for when the platform sets it', async () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }))).toBe('203.0.113.7');
    expect(clientIp(new Headers({ 'x-real-ip': '198.51.100.2' }))).toBe('198.51.100.2');
    expect(clientIp(new Headers())).toBe('unknown');
    const clock = fixedClock('2026-10-01T15:00:00Z');
    const h = new Headers({ 'x-forwarded-for': '203.0.113.7' });
    await prisma.rateLimit.create({ data: { key: 'portal-read:203.0.113.7', windowStart: new Date(Math.floor(clock.now().getTime() / LIMITS.portalReadPerIp.windowMs) * LIMITS.portalReadPerIp.windowMs), count: LIMITS.portalReadPerIp.limit } });
    expect(await portalRead(h, clock)).toBe(false);
    expect(await portalRead(new Headers({ 'x-forwarded-for': '203.0.113.8' }), clock)).toBe(true);
  });

  it('the sweep drops windows that ended over a day ago', async () => {
    const clock = fixedClock('2026-10-01T15:00:00Z');
    await hit('old', LIMITS.portalWritePerLink, clock);
    clock.advance(2 * 86_400_000);
    await hit('new', LIMITS.portalWritePerLink, clock);
    expect(await sweepRateLimits(clock)).toBe(1);
    expect((await prisma.rateLimit.findMany()).map((r) => r.key)).toEqual(['new']);
  });
});
