import Link from 'next/link';

export default async function EventLayout({ children, params }: { children: React.ReactNode; params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const at = (path: string) => `/events/${eventId}/${path}`;
  return (
    <>
      <nav><Link href="/">Events</Link> · <a href={at('grid')}>Draft grid</a> · <a href={at('agenda')}>Published agenda</a> · <a href={at('staff')}>Staffing</a> · <a href={at('speakers')}>Speakers</a> · <a href={at('content')}>Content</a> · <a href={at('chase')}>Chase</a> · <a href={at('budget')}>Budget</a> · <a href={at('rooms')}>Rooms</a> · <a href={at('rfps')}>RFPs</a> · <a href={at('venue')}>Venue</a> · <a href={at('contingency')}>Contingency</a> · <a href={at('runsheet')}>Run sheet</a> · <a href={at('callsheets')}>Call sheets</a> · <a href={at('packages')}>Packages</a> · <a href={at('live')}>Live</a> · <a href={at('reconcile')}>Reconcile</a></nav>
      {children}
    </>
  );
}
