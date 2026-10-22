import { describe, expect, it } from 'vitest';
import { fixedClock } from './clock';
import { hashToken, LINK_GRACE_DAYS, linkLive, newToken } from './portal';
import { toDbDate } from './time';

describe('portal tokens', () => {
  it('a new token is 32 random bytes, and the database only ever sees its SHA-256', () => {
    const { token, hash } = newToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashToken(token));
    expect(hash).not.toContain(token);
  });

  it('never repeats a token', () => {
    const seen = new Set(Array.from({ length: 200 }, () => newToken().token));
    expect(seen.size).toBe(200);
  });

  it('hashes deterministically', () => {
    expect(hashToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('linkLive (SEC-05, D-026)', () => {
  // The event's last day is Wed 14 Oct 2026, in Chicago (CDT, UTC-5).
  const event = { endDate: toDbDate('2026-10-14'), timezone: 'America/Chicago' };

  it('a link works through the grace days after the last day, by the venue clock', () => {
    expect(LINK_GRACE_DAYS).toBe(7);
    expect(linkLive(event, fixedClock('2026-10-01T15:00:00Z'))).toBe(true); // before the show
    expect(linkLive(event, fixedClock('2026-10-14T15:00:00Z'))).toBe(true); // show day
    expect(linkLive(event, fixedClock('2026-10-22T04:59:00Z'))).toBe(true); // 23:59 on Oct 21, Chicago
  });

  it('dies at venue midnight after the last grace day, not at UTC midnight', () => {
    expect(linkLive(event, fixedClock('2026-10-22T00:30:00Z'))).toBe(true); // UTC says the 22nd; Chicago still says the 21st
    expect(linkLive(event, fixedClock('2026-10-22T05:00:00Z'))).toBe(false); // 00:00 on Oct 22, Chicago
    expect(linkLive(event, fixedClock('2027-01-01T00:00:00Z'))).toBe(false);
  });

  it('honours a different grace (recaps carry their own)', () => {
    expect(linkLive(event, fixedClock('2026-10-15T15:00:00Z'), 0)).toBe(false);
    expect(linkLive(event, fixedClock('2026-10-15T04:59:00Z'), 0)).toBe(true); // 23:59 on the 14th, Chicago
    expect(linkLive(event, fixedClock('2026-11-10T15:00:00Z'), 30)).toBe(true);
  });

  it('a venue east of UTC expires earlier in UTC terms', () => {
    const tokyo = { endDate: toDbDate('2026-10-14'), timezone: 'Asia/Tokyo' };
    expect(linkLive(tokyo, fixedClock('2026-10-21T14:59:00Z'))).toBe(true); // 23:59 on Oct 21, Tokyo
    expect(linkLive(tokyo, fixedClock('2026-10-21T15:00:00Z'))).toBe(false); // 00:00 on Oct 22, Tokyo
  });
});
