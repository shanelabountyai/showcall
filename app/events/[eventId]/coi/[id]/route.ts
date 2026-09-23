import { prisma } from '@/src/db';

/** A portal-uploaded COI's bytes, scoped to the event in the path; always a download, never rendered inline. */
export async function GET(_req: Request, { params }: { params: Promise<{ eventId: string; id: string }> }) {
  const { eventId, id } = await params;
  const s = await prisma.coiSubmission.findFirst({ where: { id, role: { eventId } } });
  if (!s) return new Response('Not found', { status: 404 });
  return new Response(Buffer.from(s.bytes), {
    headers: {
      'Content-Type': s.mimeType,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(s.filename)}`,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
