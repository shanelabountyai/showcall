import { revalidatePath } from 'next/cache';
import { notFound } from 'next/navigation';
import { systemClock } from '@/src/clock';
import { approve, override } from '@/src/content/lock';
import { addDeliverable, addRule, addSponsor, ContentRefused, issuePortalToken, producerComment } from '@/src/content/pipeline';
import { prisma } from '@/src/db';
import { DeliverableKind, RuleCheck } from '@/src/generated/prisma/enums';
import { IssueLink, type Issued } from '../../../issue-link';
import { Versions } from '../../../versions';
import { refusable } from '../refusable';

export const dynamic = 'force-dynamic';

/** `speaker:<id>` / `sponsor:<id>` from the owner select. Module scope: server actions below must not close over functions or page data. */
function ownerFrom(key: string) {
  const [kind, id = ''] = key.split(':');
  return kind === 'sponsor' ? { sponsorId: id } : { speakerId: id };
}

// Never load file bytes to render a page — and never let a server action's closure capture them.
const versions = { orderBy: { number: 'desc' }, omit: { bytes: true }, include: { runs: { orderBy: { at: 'desc' } }, comments: { orderBy: { at: 'asc' } } } } as const;
const deliverables = { orderBy: { label: 'asc' }, include: { versions, locks: { orderBy: { number: 'asc' }, include: { version: { select: { number: true } } } } } } as const;
const stamp = (d: Date) => `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;

/**
 * Content turn-in, producer side (P0-5, D-015): who owes what, every version
 * with its validation, the comment thread, portal links, and the event's
 * rules. A portal link's raw token is shown once, in the issuing form's
 * state (SEC-04) — only its hash is stored, so it cannot be shown again.
 */
export default async function Content({ params, searchParams }: { params: Promise<{ eventId: string }>; searchParams: Promise<{ error?: string }> }) {
  const { eventId } = await params;
  const { error } = await searchParams;
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      speakers: { orderBy: { name: 'asc' }, include: { deliverables } },
      sponsors: { orderBy: { name: 'asc' }, include: { deliverables } },
      rules: { orderBy: [{ kind: 'asc' }, { check: 'asc' }] },
    },
  });
  if (!event) notFound();
  const here = `/events/${eventId}/content`;
  const owners = [
    ...event.speakers.map((s) => ({ key: `speaker:${s.id}`, ...s })),
    ...event.sponsors.map((s) => ({ key: `sponsor:${s.id}`, ...s })),
  ];

  async function doSponsor(form: FormData) {
    'use server';
    await refusable(here, () => addSponsor(eventId, String(form.get('name'))), ContentRefused);
  }

  async function doDeliverable(form: FormData) {
    'use server';
    await refusable(here, () => addDeliverable(eventId, ownerFrom(String(form.get('owner'))), String(form.get('kind')) as DeliverableKind, String(form.get('label'))), ContentRefused);
  }

  async function doLink(_prev: Issued, form: FormData): Promise<Issued> {
    'use server';
    const owner = ownerFrom(String(form.get('owner')));
    const found = 'speakerId' in owner
      ? await prisma.speaker.findFirst({ where: { id: owner.speakerId, eventId } })
      : await prisma.sponsor.findFirst({ where: { id: owner.sponsorId, eventId } });
    if (!found) return { error: 'No such speaker or sponsor on this event' };
    const token = await issuePortalToken(owner);
    revalidatePath(here);
    return { url: `/portal/${token}`, for: found.name };
  }

  async function doComment(form: FormData) {
    'use server';
    await refusable(here, () => producerComment(String(form.get('versionId')), String(form.get('body')), form.get('requestsChanges') === 'on', systemClock), ContentRefused);
  }

  async function doApprove(form: FormData) {
    'use server';
    await refusable(here, () => approve(String(form.get('versionId')), systemClock), ContentRefused);
  }

  async function doOverride(form: FormData) {
    'use server';
    await refusable(here, () => override(String(form.get('versionId')), String(form.get('reason')), systemClock), ContentRefused);
  }

  async function doRule(form: FormData) {
    'use server';
    await refusable(here, async () => {
      let params: unknown;
      try { params = JSON.parse(String(form.get('params') || '{}')); } catch { throw new ContentRefused('Rule parameters must be JSON, e.g. {"max": 104857600}'); }
      return addRule(eventId, String(form.get('kind')) as DeliverableKind, String(form.get('check')) as RuleCheck, params, String(form.get('fix')));
    }, ContentRefused);
  }

  return (
    <main>
      <h1>{event.name} — content turn-in</h1>
      {error && <p role="alert">{error}</p>}

      {owners.filter((o) => o.deliverables.length > 0 || o.key.startsWith('sponsor:')).map((o) => (
        <section key={o.key} style={{ border: '1px solid #ccc', padding: 8, marginBottom: 12 }}>
          <h2>{o.name} <small>({o.key.split(':')[0]}{o.portalTokenHash ? ', link issued' : ''})</small></h2>
          <IssueLink action={doLink} fields={{ owner: o.key }} label={o.portalTokenHash ? 'Reissue portal link (old one stops working)' : 'Issue portal link'} />
          {o.deliverables.map((d) => {
            const lock = d.locks.at(-1);
            return (
            <div key={d.id}>
              <h3>{d.label} ({d.kind.replace('_', ' ')}){lock ? ` — locked to v${lock.version.number}` : ''}</h3>
              {d.locks.length > 0 && (
                <ul>{d.locks.map((l) => <li key={l.id}>Lock {l.number}: {l.kind} v{l.version.number} — {stamp(l.at)}{l.reason && ` — ${l.reason}`}</li>)}</ul>
              )}
              <Versions versions={d.versions} href={(id) => `${here}/file/${id}`} lockedId={lock?.versionId} lockForm={(versionId) => (
                !lock ? (versionId === d.versions[0]?.id && (
                  <form action={doApprove}>
                    <input type="hidden" name="versionId" value={versionId} />
                    <button type="submit">Approve and lock</button>
                  </form>
                )) : versionId !== lock.versionId && (
                  <form action={doOverride}>
                    <input type="hidden" name="versionId" value={versionId} />
                    <input name="reason" required placeholder="Reason for the override" aria-label="Override reason" />{' '}
                    <button type="submit">Override lock to this version</button>
                  </form>
                )
              )} commentForm={(versionId) => (
                <form action={doComment}>
                  <input type="hidden" name="versionId" value={versionId} />
                  <input name="body" required placeholder="Comment" aria-label="Comment" />{' '}
                  <label><input type="checkbox" name="requestsChanges" /> Requests changes</label>{' '}
                  <button type="submit">Comment</button>
                </form>
              )} />
            </div>
            );
          })}
          {o.deliverables.length === 0 && <p>Nothing owed yet.</p>}
        </section>
      ))}

      <h2>Add</h2>
      <form action={doSponsor}>
        <input name="name" required placeholder="Sponsor name" aria-label="Sponsor name" /> <button type="submit">Add sponsor</button>
      </form>
      <form action={doDeliverable}>
        <select name="owner" aria-label="Owner">{owners.map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}</select>{' '}
        <select name="kind" aria-label="Kind">{Object.values(DeliverableKind).map((k) => <option key={k} value={k}>{k.replace('_', ' ')}</option>)}</select>{' '}
        <input name="label" required placeholder="Label, e.g. Keynote deck" aria-label="Label" /> <button type="submit">Add deliverable</button>
      </form>

      <h2>Validation rules</h2>
      <table>
        <thead><tr><th>Kind</th><th>Check</th><th>Parameters</th><th>Fix shown on failure</th></tr></thead>
        <tbody>{event.rules.map((r) => <tr key={r.id}><td>{r.kind.replace('_', ' ')}</td><td>{r.check.replace('_', ' ')}</td><td><code>{JSON.stringify(r.params)}</code></td><td>{r.fix}</td></tr>)}</tbody>
      </table>
      <form action={doRule}>
        <select name="kind" aria-label="Rule kind">{Object.values(DeliverableKind).map((k) => <option key={k} value={k}>{k.replace('_', ' ')}</option>)}</select>{' '}
        <select name="check" aria-label="Check">{Object.values(RuleCheck).map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}</select>{' '}
        <input name="params" placeholder='{"max": 104857600}' aria-label="Parameters (JSON)" />{' '}
        <input name="fix" required placeholder="What to do when it fails" aria-label="Fix" /> <button type="submit">Add rule</button>
      </form>
    </main>
  );
}
