import { systemClock } from '@/src/clock';
import { escalateAll } from '@/src/contingency/contingency';

/**
 * The escalation sweep (D-022). Deployed, Vercel calls it hourly (vercel.json,
 * D-032: a per-minute call would keep the free Neon compute awake). Idempotent: it sends only what is owed now, once per
 * deadline. Vercel sends CRON_SECRET as a bearer token; without one set, only
 * a local server answers.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const allowed = secret ? req.headers.get('authorization') === `Bearer ${secret}` : process.env.NODE_ENV !== 'production';
  if (!allowed) return new Response('Unauthorized', { status: 401 });
  return Response.json({ escalated: await escalateAll(systemClock) });
}
