import { runsheetStream } from '../../../../../src/live/routes';

/** The producer run-sheet stream (D-040). Behind the demo password like every page (proxy.ts). Relative import: the leak sweep imports this file from vitest. */
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: Request, { params }: { params: Promise<{ eventId: string }> }) {
  return runsheetStream(request, (await params).eventId);
}
