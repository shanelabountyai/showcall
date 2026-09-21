import { notFound } from 'next/navigation';
import { prisma } from '@/src/db';
import type { PublicSession } from '@/src/agenda/publish';
import { hhmm, shortDay } from '@/src/time';

export const dynamic = 'force-dynamic';

/** The public agenda: the latest published snapshot, never the draft grid. */
export default async function Agenda({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { versions: { orderBy: { number: 'desc' }, take: 1 } },
  });
  if (!event) notFound();
  const [latest] = event.versions;
  const sessions = (latest?.snapshot ?? []) as PublicSession[];
  const days = [...new Set(sessions.map((s) => s.day))];

  return (
    <main>
      <h1>{event.name}</h1>
      {!latest ? <p>The agenda has not been published yet.</p> : days.map((day) => (
        <section key={day}>
          <h2>{shortDay(day)}</h2>
          <table>
            <tbody>
              {sessions.filter((s) => s.day === day).map((s, i) => (
                <tr key={i}>
                  <td>{hhmm(s.startMin)}–{hhmm(s.endMin)}</td>
                  <td>{s.room}</td>
                  <td><strong>{s.title}</strong>{s.speakers.length > 0 && <> — {s.speakers.join(', ')}</>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      {latest && <p><small>Version {latest.number}</small></p>}
    </main>
  );
}
