import { systemClock } from '@/src/clock';
import { recapDownload } from '@/src/content/recap';
import { downloadHeaders } from '@/src/download';

/** One recap file: 404 unless the link is live and the file is released right now. Always a download. */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string; fileId: string }> }) {
  const { token, fileId } = await params;
  const f = await recapDownload(token, fileId, systemClock);
  if (!f) return new Response('Not found', { status: 404 });
  return new Response(Buffer.from(f.bytes), {
    headers: downloadHeaders(f.filename, f.mimeType),
  });
}
