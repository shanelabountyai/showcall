import { prisma } from '@/src/db';
import { downloadHeaders } from '@/src/download';

/** A portal-uploaded COI's bytes, scoped to the event in the path; always a download, never rendered inline. */
export async function GET(_req: Request, { params }: { params: Promise<{ eventId: string; id: string }> }) {
  const { eventId, id } = await params;
  const s = await prisma.coiSubmission.findFirst({ where: { id, role: { eventId } } });
  if (!s) return new Response('Not found', { status: 404 });
  return new Response(Buffer.from(s.bytes), {
    headers: downloadHeaders(s.filename, s.mimeType),
  });
}
