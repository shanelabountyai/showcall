import { redirect } from 'next/navigation';
import { prisma } from '@/src/db';
import { createEvent } from '@/src/events';

export const dynamic = 'force-dynamic';

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const events = await prisma.event.findMany({ orderBy: { startDate: 'asc' }, include: { client: true } });

  async function create(form: FormData) {
    'use server';
    const get = (k: string) => String(form.get(k) ?? '');
    let id: string;
    try {
      ({ id } = await createEvent({ name: get('name'), clientName: get('client'), timezone: get('timezone'), startDate: get('start'), endDate: get('end') }));
    } catch (e) {
      redirect(`/?error=${encodeURIComponent((e as Error).message)}`);
    }
    redirect(`/events/${id}/grid`);
  }

  return (
    <main>
      <h1>Showcall</h1>
      <p><a href="/calendar">Portfolio calendar</a></p>
      <ul>{events.map((e) => <li key={e.id}><a href={`/events/${e.id}/grid`}>{e.name}</a> — {e.client.name}</li>)}</ul>
      <h2>New event</h2>
      {error && <p role="alert">{error}</p>}
      <form action={create}>
        <label>Name <input name="name" required /></label>{' '}
        <label>Client <input name="client" required /></label>{' '}
        <label>Timezone <input name="timezone" defaultValue="America/Chicago" required /></label>{' '}
        <label>Starts <input type="date" name="start" required /></label>{' '}
        <label>Ends <input type="date" name="end" required /></label>{' '}
        <button type="submit">Create</button>
      </form>
    </main>
  );
}
