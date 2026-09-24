import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * The deployed demo's shared password (D-032), checked by proxy.ts on every
 * request — pages, server actions, file routes and portals alike. HTTP Basic,
 * any username. Stands in for SEC-01 until the app has users: anyone holding
 * the password is a producer.
 */
export type Gate = 'open' | 'allowed' | 'challenge' | 'misconfigured';

const digest = (s: string) => createHash('sha256').update(s).digest();

export function gate(authorization: string | null, env: Partial<Record<string, string>>): Gate {
  const password = env.DEMO_ACCESS_PASSWORD;
  // On Vercel a missing password fails closed; locally (dev, e2e) there is no gate.
  if (!password) return env.VERCEL ? 'misconfigured' : 'open';
  if (!authorization?.startsWith('Basic ')) return 'challenge';
  const decoded = Buffer.from(authorization.slice(6), 'base64').toString();
  const given = decoded.slice(decoded.indexOf(':') + 1);
  return decoded.includes(':') && timingSafeEqual(digest(given), digest(password)) ? 'allowed' : 'challenge';
}
