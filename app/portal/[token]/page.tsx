import { notFound, redirect } from 'next/navigation';
import { systemClock } from '@/src/clock';
import { ContentRefused, MAX_UPLOAD_BYTES, resolvePortal, submitterComment, submitVersion } from '@/src/content/pipeline';
import { refusable } from '../../events/[eventId]/refusable';
import { Versions } from '../../versions';

export const dynamic = 'force-dynamic';

/**
 * The speaker/sponsor portal (P0-5). Public: the token in the path is the only
 * credential, and every write re-checks it in src/content/pipeline.ts. A bad
 * token is a plain 404 — no hint whether it ever existed.
 */
export default async function Portal({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ error?: string }> }) {
  const { token } = await params;
  const { error } = await searchParams;
  const owner = await resolvePortal(token);
  if (!owner) notFound();
  const here = `/portal/${token}`;

  async function doUpload(form: FormData) {
    'use server';
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) redirect(`${here}?error=${encodeURIComponent('Choose a file to upload')}`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    await refusable(here, () => submitVersion(token, String(form.get('deliverableId')), { filename: file.name, mimeType: file.type, bytes }, systemClock), ContentRefused);
  }

  async function doComment(form: FormData) {
    'use server';
    await refusable(here, () => submitterComment(token, String(form.get('versionId')), String(form.get('body')), systemClock), ContentRefused);
  }

  return (
    <main>
      <h1>{owner.event.name} — content for {owner.name}</h1>
      <p>Upload each item below. Every upload is kept as a new version and checked automatically; anything to fix is listed under it. Limit {MAX_UPLOAD_BYTES / 1024 / 1024} MB per file.</p>
      {error && <p role="alert">{error}</p>}
      {owner.deliverables.map((d) => (
        <section key={d.id} style={{ border: '1px solid #ccc', padding: 8, marginBottom: 12 }}>
          <h2>{d.label} ({d.kind.replace('_', ' ')})</h2>
          <form action={doUpload}>
            <input type="hidden" name="deliverableId" value={d.id} />
            <input type="file" name="file" required aria-label={`File for ${d.label}`} /> <button type="submit">Upload</button>
          </form>
          <Versions versions={d.versions} commentForm={(versionId) => (
            <form action={doComment}>
              <input type="hidden" name="versionId" value={versionId} />
              <input name="body" required placeholder="Reply" aria-label="Reply" /> <button type="submit">Send</button>
            </form>
          )} />
        </section>
      ))}
      {owner.deliverables.length === 0 && <p>Nothing is due from you yet.</p>}
    </main>
  );
}
