import { prisma } from '@/src/db';
import { downloadHeaders } from '@/src/download';

/** A version's bytes, scoped to the event in the path; always a download, never rendered inline. */
export async function GET(_req: Request, { params }: { params: Promise<{ eventId: string; versionId: string }> }) {
  const { eventId, versionId } = await params;
  const v = await prisma.contentVersion.findFirst({ where: { id: versionId, deliverable: { eventId } } });
  if (!v) return new Response('Not found', { status: 404 });
  return new Response(Buffer.from(v.bytes), {
    headers: downloadHeaders(v.filename, v.mimeType),
  });
}
