import { notFound } from 'next/navigation';
import { advance, LIFECYCLE, nextStepBlocked, revert, setConsent, setProfile, SpeakerRefused, deckQuery, deckLocked, type GuardCtx } from '@/src/bureau/bureau';
import { systemClock } from '@/src/clock';
import { prisma } from '@/src/db';
import { GridEditRefused, saveSession } from '@/src/agenda/grid';
import { usd } from '@/src/money';
import { daysBetween, fromDbDate, fromHhmm, shortDay } from '@/src/time';
import { refusable } from '../refusable';

export const dynamic = 'force-dynamic';

/**
 * The speaker bureau (P0-4): lifecycle, profile, consent, rehearsal slots.
 * `advance` and `revert` are the only writers of `Speaker.state` — this page
 * never sets it directly, so the guards in src/bureau/bureau.ts always run.
 */
export default async function Speakers({ params, searchParams }: { params: Promise<{ eventId: string }>; searchParams: Promise<{ error?: string }> }) {
  const { eventId } = await params;
  const { error } = await searchParams;
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      rooms: { orderBy: { name: 'asc' } },
      speakers: {
        orderBy: { name: 'asc' },
        include: {
          sessions: { include: { session: { select: { isRehearsal: true } } } },
          transitions: { orderBy: { at: 'desc' } },
          deliverables: deckQuery,
        },
      },
    },
  });
  if (!event) notFound();
  const days = daysBetween(fromDbDate(event.startDate), fromDbDate(event.endDate));
  const here = `/events/${eventId}/speakers`;

  async function doAdvance(form: FormData) {
    'use server';
    await refusable(here, () => advance(String(form.get('speakerId')), systemClock), SpeakerRefused);
  }

  async function doRevert(form: FormData) {
    'use server';
    const speakerId = String(form.get('speakerId'));
    const to = String(form.get('to')) as (typeof LIFECYCLE)[number];
    await refusable(here, () => revert(speakerId, to, String(form.get('reason')), systemClock), SpeakerRefused);
  }

  async function doProfile(form: FormData) {
    'use server';
    const speakerId = String(form.get('speakerId'));
    const dollars = String(form.get('honorarium'));
    const signed = String(form.get('contractSignedAt'));
    await refusable(here, () => setProfile(speakerId, {
      bio: String(form.get('bio')), avNeeds: String(form.get('avNeeds')),
      honorariumCents: dollars ? Math.round(Math.max(0, Number(dollars)) * 100) : null,
      contractSignedAt: signed ? new Date(signed) : null,
    }));
  }

  async function doConsent(form: FormData) {
    'use server';
    const speakerId = String(form.get('speakerId'));
    await refusable(here, () => setConsent(speakerId, {
      recordSession: form.get('recordSession') === 'on',
      distributeDeck: form.get('distributeDeck') === 'on',
      publishVideo: form.get('publishVideo') === 'on',
    }, systemClock));
  }

  async function doRehearsal(form: FormData) {
    'use server';
    const speakerId = String(form.get('speakerId'));
    const speaker = await prisma.speaker.findUniqueOrThrow({ where: { id: speakerId } });
    await refusable(here, () => saveSession(eventId, {
      title: `Rehearsal — ${speaker.name}`, day: String(form.get('day')), roomId: String(form.get('roomId')),
      startMin: fromHhmm(String(form.get('start'))), endMin: fromHhmm(String(form.get('end'))),
      speakerIds: [speakerId], isRehearsal: true,
    }), GridEditRefused);
  }

  return (
    <main>
      <h1>{event.name} — speaker bureau</h1>
      {error && <p role="alert">{error}</p>}
      {event.speakers.map((s) => {
        const ctx: GuardCtx = {
          honorariumCents: s.honorariumCents, contractSignedAt: s.contractSignedAt, bio: s.bio, consentRecordedAt: s.consentRecordedAt,
          hasRehearsal: s.sessions.some((x) => x.session.isRehearsal), hasSession: s.sessions.some((x) => !x.session.isRehearsal),
          deckLocked: deckLocked(s.deliverables),
        };
        const blocked = nextStepBlocked(s.state, ctx);
        const earlier = LIFECYCLE.slice(0, LIFECYCLE.indexOf(s.state));
        return (
          <section key={s.id} style={{ border: '1px solid #ccc', padding: 8, marginBottom: 12 }}>
            <h2>{s.name} — {s.state.replace('_', ' ')}</h2>
            {blocked ? <p>Next ({blocked.to.replace('_', ' ')}) blocked: {blocked.reason}</p> : s.state !== 'released' && <p>Ready to advance.</p>}

            <form action={doAdvance} style={{ display: 'inline' }}>
              <input type="hidden" name="speakerId" value={s.id} />
              <button type="submit" disabled={!!blocked || s.state === 'released'}>Advance</button>
            </form>
            {earlier.length > 0 && (
              <form action={doRevert} style={{ display: 'inline', marginLeft: 8 }}>
                <input type="hidden" name="speakerId" value={s.id} />
                <select name="to" aria-label="Step back to">{earlier.map((st) => <option key={st} value={st}>{st.replace('_', ' ')}</option>)}</select>{' '}
                <input name="reason" placeholder="Reason" required aria-label="Reason" />{' '}
                <button type="submit">Step back</button>
              </form>
            )}

            <h3>Profile</h3>
            <form action={doProfile}>
              <input type="hidden" name="speakerId" value={s.id} />
              <textarea name="bio" defaultValue={s.bio} placeholder="Bio" aria-label="Bio" /><br />
              <input name="avNeeds" defaultValue={s.avNeeds} placeholder="AV needs" aria-label="AV needs" /><br />
              <label>Honorarium $ <input name="honorarium" type="number" min="0" step="0.01" defaultValue={s.honorariumCents == null ? '' : s.honorariumCents / 100} aria-label="Honorarium" /></label>
              {s.honorariumCents != null && <span> ({usd(s.honorariumCents)})</span>}<br />
              <label>Contract signed <input name="contractSignedAt" type="date" defaultValue={s.contractSignedAt?.toISOString().slice(0, 10) ?? ''} aria-label="Contract signed" /></label>
              <button type="submit">Save profile</button>
            </form>

            <h3>Consent (releasable per src/bureau/consent.ts)</h3>
            <form action={doConsent}>
              <input type="hidden" name="speakerId" value={s.id} />
              <label><input type="checkbox" name="recordSession" defaultChecked={s.consentRecordSession} /> Record session</label>{' '}
              <label><input type="checkbox" name="distributeDeck" defaultChecked={s.consentDistributeDeck} /> Distribute deck</label>{' '}
              <label><input type="checkbox" name="publishVideo" defaultChecked={s.consentPublishVideo} /> Publish video</label>{' '}
              <button type="submit">Save consent</button>
              {s.consentRecordedAt && <p>Recorded {s.consentRecordedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC</p>}
            </form>

            <h3>Rehearsal ({s.sessions.filter((x) => x.session.isRehearsal).length} booked)</h3>
            <form action={doRehearsal}>
              <input type="hidden" name="speakerId" value={s.id} />
              <select name="day" aria-label="Day">{days.map((d) => <option key={d} value={d}>{shortDay(d)}</option>)}</select>{' '}
              <select name="roomId" aria-label="Room">{event.rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>{' '}
              <input type="time" name="start" required aria-label="Start" /> <input type="time" name="end" required aria-label="End" />{' '}
              <button type="submit">Book rehearsal</button>
            </form>

            {s.transitions.length > 0 && (
              <details><summary>Transition log</summary>
                <ul>{s.transitions.map((t) => <li key={t.id}>{t.at.toISOString().slice(0, 16).replace('T', ' ')} UTC: {t.from} → {t.to}{t.reason && ` (${t.reason})`}</li>)}</ul>
              </details>
            )}
          </section>
        );
      })}
      {event.speakers.length === 0 && <p>This event has no speakers yet.</p>}
    </main>
  );
}
