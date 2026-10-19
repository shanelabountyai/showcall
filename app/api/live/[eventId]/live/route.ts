import { liveStream } from '../../../../../src/live/routes';

/** The stage-manager live-mode stream (D-040, D-046). Behind the demo password like every page (proxy.ts). */
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  return liveStream(request, (await params).eventId);
}
