import { systemClock } from '@/src/clock';
import { escalateAll } from '@/src/contingency/contingency';
import { cronAllowed } from '@/src/cron-auth';

/**
 * The escalation sweep (D-022). Deployed, Vercel calls it daily (vercel.json,
 * D-032, D-034: a frequent call would keep the free Neon compute awake). Idempotent: it sends only what is owed now, once per
 * deadline. Vercel sends CRON_SECRET as a bearer token; without one set, only
 * a local server answers.
 */
export async function GET(req: Request) {
  if (!cronAllowed(req.headers.get('authorization'), process.env)) return new Response('Unauthorized', { status: 401 });
  return Response.json({ escalated: await escalateAll(systemClock) });
}
