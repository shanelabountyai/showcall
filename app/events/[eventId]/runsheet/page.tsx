import { revalidatePath } from 'next/cache';
import { notFound } from 'next/navigation';
import { CallSheetsBlocked, issueCallSheets } from '@/src/callsheet/callsheet';
import { systemClock } from '@/src/clock';
import { prisma } from '@/src/db';
import { buildFrame, type ProducerData } from '@/src/live/frames';
import { CascadeBlocked, CascadeChanged, RowChanged, type CueEdit } from '@/src/runsheet/cascade';
import type { Moved } from '@/src/runsheet/cues';
import { commitRowEdit, EditRefused, editors, previewRowEdit } from '@/src/runsheet/editor';
import { fromHhmm } from '@/src/time';
import { LiveChip, LiveProvider } from '../../../live-stream';
import { valuesOf, type EditState } from './edit-state';
import { RunSheetView } from './view';

export const dynamic = 'force-dynamic';

const int = (v: FormDataEntryValue | null, what: string) => {
  const s = String(v ?? '').trim();
  if (!/^-?\d{1,4}$/.test(s)) throw new EditRefused(`${what} must be a whole number of minutes`);
  return Number(s);
};

/** The form as a cue edit. Fixed and anchored are exclusive: switching mode clears the other half (the migration's shape check). */
function editFrom(form: FormData, rev: number): CueEdit {
  const cueId = String(form.get('cueId'));
  const label = String(form.get('label') ?? '').trim();
  if (!label) throw new EditRefused('A cue needs a label');
  const base = { cueId, rev, label, durationMin: int(form.get('durationMin'), 'Duration') };
  if (form.get('mode') === 'fixed') {
    const day = String(form.get('day') ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new EditRefused('Pick the day');
    let startMin: number;
    try { startMin = fromHhmm(String(form.get('start') ?? '')); } catch { throw new EditRefused('Enter a start time'); }
    return { ...base, day, startMin, anchorId: null, anchorEdge: null };
  }
  const anchorId = String(form.get('anchorId') ?? '');
  if (!anchorId) throw new EditRefused('Pick what the cue is anchored to');
  return { ...base, day: null, startMin: null, anchorId, anchorEdge: form.get('anchorEdge') === 'end' ? 'end' : 'start', offsetMin: int(form.get('offsetMin'), 'Offset') };
}

/**
 * The run-sheet row editor (D-045, LV-1, LV-2). Rows in run-sheet order; each
 * cue row opens a form that previews the cascade and commits exactly what the
 * preview showed, against the row revision it was opened at. "Editing as"
 * names the actor on the change log (D-044); the action re-checks it. Every
 * other open view of this show sees the commit through the live stream.
 */
export default async function RunSheet({ params, searchParams }: { params: Promise<{ eventId: string }>; searchParams: Promise<{ as?: string; dropAfter?: string }> }) {
  const { eventId } = await params;
  const { as, dropAfter } = await searchParams;
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { name: true, timezone: true } });
  if (!event) notFound();
  const [frame, staff] = await Promise.all([buildFrame('runsheet', eventId, { clock: systemClock, since: null }), editors(eventId, systemClock)]);
  if (!frame) notFound();
  const hook = process.env.LIVE_TEST_HOOKS === '1' && dropAfter && /^\d+$/.test(dropAfter) ? `?dropAfter=${dropAfter}` : '';

  async function edit(_prev: EditState, form: FormData): Promise<EditState> {
    'use server';
    const cueId = String(form.get('cueId'));
    const intent = String(form.get('intent'));
    const staffId = String(form.get('as') ?? '');
    const rev = Number(form.get(intent === 'repreview' ? 'currentRev' : 'rev'));
    try {
      const change = editFrom(form, rev);
      if (intent === 'commit') {
        const expected = JSON.parse(String(form.get('expected') ?? '[]')) as Moved[];
        await commitRowEdit(eventId, staffId, change, expected, systemClock);
        let issued: string | null = null;
        // O-3: the tick is off by default; the issue is its own transaction after the cascade commits (D-041).
        if (form.get('issue') === 'on') {
          try { issued = (await issueCallSheets(eventId, systemClock)).map((i) => i.role).join(', ') || 'none'; }
          catch (e) { if (!(e instanceof CallSheetsBlocked)) throw e; issued = `not issued: ${e.message}`; }
        }
        revalidatePath(`/events/${eventId}/runsheet`);
        return { kind: 'committed', cueId, issued };
      }
      const preview = await previewRowEdit(eventId, staffId, change, systemClock);
      return {
        kind: 'preview', cueId, rev, expected: JSON.stringify(preview.moved), moved: preview.moved,
        problems: preview.problems.map((p) => p.message), warnings: preview.warnings.filter((w) => w.isNew).map((w) => w.message),
      };
    } catch (e) {
      if (e instanceof RowChanged) {
        return { kind: 'conflict', cueId, message: e.message, by: e.by, at: e.at?.toISOString() ?? null, current: valuesOf(e.current), currentRev: e.current.rev };
      }
      if (e instanceof CascadeChanged) return { kind: 'refused', cueId, message: `${e.message}. Someone else's change moved what you previewed.` };
      if (e instanceof CascadeBlocked || e instanceof EditRefused) return { kind: 'refused', cueId, message: e.message };
      throw e;
    }
  }

  return (
    <main>
      <h1>{event.name} — run sheet</h1>
      <nav aria-label="Editing as">
        Editing as:{' '}
        {staff.length === 0 ? 'no producer or stage manager is assigned today' : staff.map((s, i) => (
          <span key={s.staffId}>{i > 0 && ' · '}
            {s.staffId === as ? <strong>{s.name}</strong> : <a href={`?as=${s.staffId}`}>{s.name}</a>} ({s.role.replace('_', ' ')})
          </span>
        ))}
      </nav>
      <LiveProvider url={`/api/live/${eventId}/runsheet${hook}`} initial={frame as typeof frame & { data: ProducerData }} timeZone={event.timezone}>
        <LiveChip />
        <RunSheetView action={edit} as={as ?? ''} />
      </LiveProvider>
    </main>
  );
}
