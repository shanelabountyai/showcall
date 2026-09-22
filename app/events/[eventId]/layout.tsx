export default async function EventLayout({ children, params }: { children: React.ReactNode; params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const at = (path: string) => `/events/${eventId}/${path}`;
  return (
    <>
      <nav><a href="/">Events</a> · <a href={at('grid')}>Draft grid</a> · <a href={at('agenda')}>Published agenda</a> · <a href={at('staff')}>Staffing</a> · <a href={at('speakers')}>Speakers</a> · <a href={at('content')}>Content</a> · <a href={at('live')}>Live</a></nav>
      {children}
    </>
  );
}
