import { createHash, timingSafeEqual } from 'node:crypto';

const digest = (s: string) => createHash('sha256').update(s).digest();

/**
 * Whether a call to `/api/cron/*` may run. Vercel sends `CRON_SECRET` as a
 * bearer token; the comparison is constant-time, like the demo gate's. With no
 * secret set, only a non-production server answers (dev, e2e).
 */
export function cronAllowed(authorization: string | null, env: Partial<Record<string, string>>): boolean {
  const secret = env.CRON_SECRET;
  if (!secret) return env.NODE_ENV !== 'production';
  return authorization !== null && timingSafeEqual(digest(authorization), digest(`Bearer ${secret}`));
}
