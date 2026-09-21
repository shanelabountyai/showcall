import { prisma } from '@/src/db';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const events = await prisma.event.findMany({ orderBy: { startDate: 'asc' } });
  return (
    <main>
      <h1>Showcall</h1>
      <ul>{events.map((e) => <li key={e.id}><a href={`/events/${e.id}/agenda`}>{e.name}</a></li>)}</ul>
    </main>
  );
}
