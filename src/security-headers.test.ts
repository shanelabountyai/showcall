import { describe, expect, it } from 'vitest';
import config from '../next.config';

/**
 * SEC-05 and SEC-06 as configured. Next applies every matching `headers()`
 * entry in order and a later value wins for the same key, so this resolves
 * them the same way for a path. The e2e sweep checks the served portal
 * headers on the production build; this pins the config that produces them.
 */
async function headersFor(path: string) {
  const rules = await config.headers!();
  const out: Record<string, string> = {};
  for (const r of rules) {
    const prefix = r.source.replace('/:path*', '');
    if (path === prefix || path.startsWith(`${prefix}/`)) for (const h of r.headers) out[h.key.toLowerCase()] = h.value;
  }
  return out;
}

describe('security headers (next.config.ts)', () => {
  it('every page and route: not frameable, nosniff, HSTS, origin-only referrer', async () => {
    for (const path of ['/', '/events/e1/budget', '/api/live/e1/runsheet', '/events/e1/content/file/v1']) {
      const h = await headersFor(path);
      expect(h['x-frame-options']).toBe('DENY');
      expect(h['content-security-policy']).toBe("frame-ancestors 'none'");
      expect(h['x-content-type-options']).toBe('nosniff');
      expect(h['strict-transport-security']).toMatch(/^max-age=\d{8,}/);
      expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
      expect(h['cache-control']).toBeUndefined();
    }
  });

  it('portal pages keep the stricter SEC-05 set, and the portal Referrer-Policy wins', async () => {
    for (const path of ['/portal/tok', '/portal/call/tok', '/portal/recap/tok/file/f1']) {
      const h = await headersFor(path);
      expect(h['referrer-policy']).toBe('no-referrer');
      expect(h['cache-control']).toBe('no-store');
      expect(h['x-robots-tag']).toContain('noindex');
      expect(h['x-frame-options']).toBe('DENY');
    }
  });
});
