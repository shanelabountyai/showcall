import { revalidatePath } from 'next/cache';
import { notFound } from 'next/navigation';
import { callSheetStatus, CallSheetsBlocked, issueCallSheets } from '@/src/callsheet/callsheet';
import { issueCrewLink, PortalRefused, setRoleVendor } from '@/src/callsheet/portal';
import { systemClock } from '@/src/clock';
import { prisma } from '@/src/db';
import { IssueLink, type Issued } from '../../../issue-link';
import { refusable } from '../refusable';

export const dynamic = 'force-dynamic';

const stamp = (d: Date) => `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC`;

/**
 * Call sheets, producer side (P0-2, P1-3): per role, the last issue, whether
 * it needs re-issuing, and whether the recipient has confirmed it through
 * their portal link. A role tied to a vendor takes that vendor's COI on its
 * link; uploads wait for acceptance on the budget page (D-026).
 */
export default async function CallSheets({ params, searchParams }: { params: Promise<{ eventId: string }>; searchParams: Promise<{ error?: string; issued?: string }> }) {
  const { eventId } = await params;
  const { error, issued } = await searchParams;
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { name: true } });
  if (!event) notFound();
  const here = `/events/${eventId}/callsheets`;
  const [status, roles, vendors] = await Promise.all([
    callSheetStatus(eventId),
    prisma.callRole.findMany({
      where: { eventId },
      select: { id: true, reportTo: true, vendorId: true, portalTokenHash: true, issues: { orderBy: { number: 'desc' }, take: 1, select: { receipt: { select: { confirmedAt: true } } } } },
    }),
    prisma.vendor.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ]);
  const byId = new Map(roles.map((r) => [r.id, r]));

  async function doIssue() {
    'use server';
    await refusable(here, async () => new URLSearchParams({ issued: (await issueCallSheets(eventId, systemClock)).map((i) => i.role).join(', ') || 'none' }), CallSheetsBlocked);
  }

  async function doVendor(form: FormData) {
    'use server';
    await refusable(here, () => setRoleVendor(eventId, String(form.get('roleId')), String(form.get('vendorId')) || null), PortalRefused);
  }

  async function doLink(_prev: Issued, form: FormData): Promise<Issued> {
    'use server';
    const roleId = String(form.get('roleId'));
    const role = await prisma.callRole.findFirst({ where: { id: roleId, eventId }, select: { name: true } });
    if (!role) return { error: 'No such role on this event' };
    const token = await issueCrewLink(eventId, roleId);
    revalidatePath(here);
    return { url: `/portal/call/${token}`, for: role.name };
  }

  return (
    <main>
      <h1>{event.name} — call sheets</h1>
      {error && <p role="alert">{error}</p>}
      {issued && <p role="status">Call sheets issued: {issued}.</p>}
      <form action={doIssue}><button type="submit">Issue changed sheets</button></form>
      {status.length === 0 && <p>No call roles on this event yet.</p>}
      {status.map((s) => {
        const role = byId.get(s.roleId)!;
        const confirmedAt = role.issues[0]?.receipt?.confirmedAt;
        return (
          <section key={s.roleId} aria-label={s.role} style={{ border: '1px solid #ccc', padding: 8, marginBottom: 12 }}>
            <h2>{s.role}</h2>
            <p>
              {s.lastIssue === 0 ? 'Not issued yet' : `Issue ${s.lastIssue}`}
              {s.stale && ' · NEEDS RE-ISSUE'}
              {s.lastIssue > 0 && (confirmedAt ? ` · receipt confirmed ${stamp(confirmedAt)}` : ' · awaiting receipt')}
            </p>
            {s.warnings.length > 0 && <ul aria-label="Work rules">{s.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
            <form action={doVendor}>
              <input type="hidden" name="roleId" value={s.roleId} />
              <label>Vendor{' '}
                <select name="vendorId" defaultValue={role.vendorId ?? ''}>
                  <option value="">none (crew)</option>
                  {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </label>{' '}
              <button type="submit">Save vendor</button>
            </form>
            <IssueLink action={doLink} fields={{ roleId: s.roleId }} label={role.portalTokenHash ? 'Reissue portal link (old one stops working)' : 'Issue portal link'} />
          </section>
        );
      })}
    </main>
  );
}
