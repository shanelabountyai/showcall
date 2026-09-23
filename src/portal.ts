import { createHash, randomBytes } from 'node:crypto';
import type { Clock } from './clock';
import { addDays, fromDbDate, localNow } from './time';

/**
 * Portal links (S-8 content, S-21 crew). The link is the only credential: the
 * database holds its SHA-256, and the raw token is shown once. A link dies a
 * week after its event's last day (SEC-05, D-026), so a leaked one does not
 * work forever; an expired link is the same 404 as a bad one.
 */
export const LINK_GRACE_DAYS = 7;

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function newToken() {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

export const linkLive = (event: { endDate: Date; timezone: string }, clock: Clock) =>
  localNow(clock.now(), event.timezone).day <= addDays(fromDbDate(event.endDate), LINK_GRACE_DAYS);
