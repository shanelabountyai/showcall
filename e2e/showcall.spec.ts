import { test, expect } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const title = (t: string) => `input[name="title"][value="${t}"]`;
const KEYNOTE = 'Opening keynote: Care at the speed of trust';

async function deck(fonts: boolean) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([1920, 1080]);
  if (fonts) page.drawText('Staffing models', { font: await doc.embedFont(StandardFonts.Helvetica) });
  return { name: fonts ? 'deck-v1.pdf' : 'deck-v2.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) };
}

/**
 * Browser coverage for the UI paths S-5 shipped with unit tests only: grid
 * edit/publish, staffing refusals, gated GO (D-011). One spec, one shared
 * seeded event, run in order — later blocks depend on earlier ones (the
 * keynote-moves-15 story leaves the run sheet stale for the live-mode block,
 * same as it would for a real producer).
 */
test.describe.serial('Showcall e2e (seeded Northwind Summit)', () => {
  let eventId = '';

  test.beforeAll(async ({ request }) => {
    const html = await (await request.get('/')).text();
    const match = html.match(/href="\/events\/([^/"]+)\/grid"/);
    if (!match) throw new Error('No seeded event on the home page — run `npm run db:seed:test` first');
    eventId = match[1]!;
  });

  test.describe('draft grid', () => {
    test('the seeded agenda is clean and published', async ({ page }) => {
      await page.goto(`/events/${eventId}/grid`);
      await expect(page.getByText('No conflicts.')).toBeVisible();
      await expect(page.getByText('Published: version 1.')).toBeVisible();
    });

    test('an overlapping edit blocks publish, and reverting clears it', async ({ page }) => {
      await page.goto(`/events/${eventId}/grid`);
      const row = page.locator('form').filter({ has: page.locator(title(KEYNOTE)) });
      await row.getByLabel('End').fill('10:35'); // overlaps Strategy 1.1 at 10:30
      await row.getByRole('button', { name: 'Save' }).click();

      await expect(page.getByRole('status')).toContainText('double-booked');
      await expect(page.getByRole('button', { name: /Publish version/ })).toBeDisabled();

      const revert = page.locator('form').filter({ has: page.locator(title(KEYNOTE)) });
      await revert.getByLabel('End').fill('10:00');
      await revert.getByRole('button', { name: 'Save' }).click();
      await expect(page.getByText('No conflicts.')).toBeVisible();
    });

    test('the keynote moves 15 minutes and publishes a new version', async ({ page }) => {
      await page.goto(`/events/${eventId}/grid`);
      const row = page.locator('form').filter({ has: page.locator(title(KEYNOTE)) });
      await row.getByLabel('Start').fill('09:15');
      await row.getByLabel('End').fill('10:15'); // clears the 15-min Ballroom A turnover exactly
      await row.getByRole('button', { name: 'Save' }).click();

      await expect(page.getByText('No conflicts.')).toBeVisible();
      await page.getByRole('button', { name: 'Publish version 2' }).click();
      await expect(page.getByText('Published: version 2.')).toBeVisible();
    });
  });

  test.describe('staffing', () => {
    test('a booking past the daily cap is refused, named', async ({ page }) => {
      await page.goto(`/events/${eventId}/staff`);
      await page.getByLabel('Who').selectOption({ label: 'Avery Holt (cap 8h)' });
      await page.getByLabel('Role').selectOption({ label: 'crew' });
      await page.getByLabel('Day').selectOption({ index: 0 });
      await page.getByLabel('Start').fill('16:00'); // no overlap with Avery's 08:00–16:00 shift
      await page.getByLabel('End').fill('17:00');
      await page.getByRole('button', { name: 'Assign' }).click();
      await expect(page.locator('p[role="alert"]')).toContainText('cap is 480');
    });

    test('a booking within the cap succeeds', async ({ page }) => {
      await page.goto(`/events/${eventId}/staff`);
      await page.getByLabel('Who').selectOption({ label: 'Morgan Ellis (cap 12h)' });
      await page.getByLabel('Role').selectOption({ label: 'producer' });
      await page.getByLabel('Day').selectOption({ index: 0 });
      await page.getByLabel('Start').fill('18:00'); // Morgan's 07:00–18:00 shift has 60 min of slack
      await page.getByLabel('End').fill('18:30');
      await page.getByRole('button', { name: 'Assign' }).click();
      await expect(page.getByRole('cell', { name: '18:00–18:30' })).toBeVisible();
    });
  });

  test.describe('live mode', () => {
    test('the moved keynote leaves the run sheet flagged stale', async ({ page }) => {
      await page.goto(`/events/${eventId}/live`);
      await expect(page.locator('p[role="alert"]')).toContainText('published past this run sheet');
    });

    test('GO is gated to the room\'s own stage manager (D-011)', async ({ page }) => {
      await page.goto(`/events/${eventId}/live`);
      await expect(page.getByRole('button', { name: 'GO' })).toHaveCount(0); // nobody picked yet

      await page.getByRole('link', { name: 'Priya Natarajan' }).click();
      await expect(page.locator('strong', { hasText: 'Priya Natarajan' })).toBeVisible();

      const ballroom = page.locator('section').filter({ has: page.getByRole('heading', { name: /^Ballroom A/ }) });
      const salonB = page.locator('section').filter({ has: page.getByRole('heading', { name: /^Salon B/ }) });
      const salonC = page.locator('section').filter({ has: page.getByRole('heading', { name: /^Salon C/ }) });
      await expect(ballroom.getByRole('button', { name: 'GO' }).first()).toBeVisible();
      await expect(salonB.getByRole('button', { name: 'GO' })).toHaveCount(0);
      await expect(salonC.getByRole('button', { name: 'GO' })).toHaveCount(0);

      await ballroom.getByRole('button', { name: 'GO' }).last().click();
      await expect(ballroom.locator('tbody tr').last()).toHaveAttribute('data-state', 'current');
    });

    test('a different stage manager sees GO only in their own room', async ({ page }) => {
      await page.goto(`/events/${eventId}/live`);
      await page.getByRole('link', { name: 'Theo Lindqvist' }).click();

      const ballroom = page.locator('section').filter({ has: page.getByRole('heading', { name: /^Ballroom A/ }) });
      const salonB = page.locator('section').filter({ has: page.getByRole('heading', { name: /^Salon B/ }) });
      await expect(salonB.getByRole('button', { name: 'GO' }).first()).toBeVisible();
      await expect(ballroom.getByRole('button', { name: 'GO' })).toHaveCount(0);
    });
  });
  test.describe('content turn-in (S-8, S-9)', () => {
    test('a producer issues a link; the speaker uploads, sees what to fix, and fixes it', async ({ page }) => {
      await page.goto(`/events/${eventId}/content`);
      await page.getByLabel('Owner').selectOption({ label: 'Keiko Brandt' });
      await page.getByLabel('Kind', { exact: true }).selectOption('deck');
      await page.getByLabel('Label').fill('Staffing models deck');
      await page.getByRole('button', { name: 'Add deliverable' }).click();

      const keiko = page.locator('section').filter({ has: page.getByRole('heading', { name: /^Keiko Brandt/ }) });
      await keiko.getByRole('button', { name: 'Issue portal link' }).click();
      await page.getByRole('status').getByRole('link', { name: 'open' }).click();
      await expect(page.getByRole('heading', { name: /content for Keiko Brandt/ })).toBeVisible();

      // Keiko owes a Session deck too (every speaker does), so scope to this one.
      const item = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Staffing models deck (deck)' }) });
      await page.getByLabel('File for Staffing models deck').setInputFiles(await deck(true));
      await item.getByRole('button', { name: 'Upload' }).click();
      await expect(page.getByText(/Fix: Embed your fonts/)).toBeVisible();
      await expect(page.getByText('Fonts not embedded: Helvetica')).toBeVisible();

      await page.getByLabel('File for Staffing models deck').setInputFiles(await deck(false));
      await item.getByRole('button', { name: 'Upload' }).click();
      // The brand-template check is manual (D-016), so v2 waits on the producer.
      await expect(page.locator('li').filter({ hasText: /^v2 deck-v2\.pdf/ })).toContainText('needs review');
      await expect(page.locator('li').filter({ hasText: /^v1 deck-v1\.pdf/ })).toContainText('failed');
    });

    test('approve locks v2 as the show file; the room package goes stale until rebuilt; attendees are consent-gated (S-9)', async ({ page }) => {
      await page.goto(`/events/${eventId}/content`);
      const keiko = page.locator('section').filter({ has: page.getByRole('heading', { name: /^Keiko Brandt/ }) });
      await keiko.getByRole('button', { name: 'Approve and lock' }).click();
      await expect(keiko.getByRole('heading', { name: /Staffing models deck \(deck\) — locked to v2/ })).toBeVisible();
      await expect(keiko.locator('li').filter({ hasText: /^v2 deck-v2\.pdf/ })).toContainText('show file');

      await page.goto(`/events/${eventId}/packages`);
      const salonB = page.getByRole('region', { name: 'Salon B — playback' });
      await expect(salonB).toContainText('STALE — rebuild');
      await expect(salonB).toContainText('Added: Operations 1.1: Staffing models — Keiko Brandt: Staffing models deck v2');
      await salonB.getByRole('button', { name: 'Rebuild package' }).click();
      await expect(salonB).toContainText('Package 2');
      await expect(salonB).toContainText('current');
      await expect(salonB.getByRole('button', { name: 'Rebuild package' })).toHaveCount(0);

      const attendees = page.getByRole('region', { name: /^Attendees/ });
      await expect(attendees).toContainText("Withheld: Staffing models deck — Keiko Brandt's consent has not been recorded");
    });

    test('a bad portal token is a plain 404', async ({ page }) => {
      const res = await page.goto('/portal/not-a-real-token');
      expect(res?.status()).toBe(404);
    });
  });

  test.describe('chase dashboard (S-10)', () => {
    test('deadlines derive from the agenda, and the cadence sends each step once', async ({ page }) => {
      await page.goto(`/events/${eventId}/chase`);
      const worklist = page.getByRole('region', { name: 'Escalation worklist' });

      // Ravi never submitted: his deck is overdue against a deadline nobody typed in.
      const ravi = worklist.getByRole('row').filter({ hasText: 'Ravi Menon' });
      await expect(ravi).toContainText('OVERDUE');
      await expect(ravi).toContainText('nothing submitted');
      // Keiko's approved deck is off the chase entirely.
      await expect(worklist.getByRole('row').filter({ hasText: 'Staffing models deck' })).toContainText('locked');

      const send = page.getByRole('button', { name: /Send due reminders \(\d+\)/ });
      await expect(send).toBeEnabled();
      await send.click();

      // Every owed step has gone out, so the cadence owes nothing until the next one.
      await expect(page.getByRole('button', { name: 'Send due reminders (0)' })).toBeDisabled();
      await expect(page.getByRole('region', { name: 'Reminder outbox' })).toContainText('Ravi Menon');
      await expect(ravi).toContainText('step -7');
    });

    test('a missing item is the lifecycle guard\'s own message, not a second opinion', async ({ page }) => {
      await page.goto(`/events/${eventId}/chase`);
      const missing = page.getByRole('region', { name: 'Missing items' });
      await expect(missing.getByRole('listitem').filter({ hasText: 'Ravi Menon' }))
        .toContainText('next (content complete) blocked: needs a bio and an approved deck');
    });
  });

  test.describe('Phase 2 gate (S-11)', () => {
    test('the 11pm v7: upload after lock → override with reason → revalidate → package rebuild', async ({ page }) => {
      const ballroomA = page.getByRole('region', { name: 'Ballroom A — playback' });
      const HOLLIS_DECK = 'Keynote: The next five years of value-based care — Hollis Grant: Session deck';
      const keynoteRow = ballroomA.getByRole('row').filter({ hasText: 'Keynote: The next five years' });

      // Ballroom A's seeded package carries Hollis's locked v6. (The Day 1 keynote move
      // did not stale it: Dana Reyes is only invited, owes no deck, so nothing in the manifest moved.)
      await page.goto(`/events/${eventId}/packages`);
      await expect(ballroomA).toContainText('Package 1');
      await expect(ballroomA).toContainText('current');
      await expect(keynoteRow).toContainText('Session deck v6');

      // Hollis's v6 is locked (seed). The speaker comes back with a v7 through the portal.
      await page.goto(`/events/${eventId}/content`);
      const hollis = page.locator('section').filter({ has: page.getByRole('heading', { name: /^Hollis Grant/ }) });
      await hollis.getByRole('button', { name: /Reissue portal link/ }).click();
      await page.getByRole('status').getByRole('link', { name: 'open' }).click();
      await page.getByLabel('File for Session deck').setInputFiles({ ...(await deck(false)), name: 'hollis-grant-deck-v7.pdf' });
      await page.getByRole('button', { name: 'Upload' }).click();
      const v7 = page.locator('li').filter({ hasText: /^v7 hollis-grant-deck-v7\.pdf/ });
      await expect(v7).toContainText('needs review');
      await expect(v7).not.toContainText('show file');
      await expect(page.locator('li').filter({ hasText: /^v6 / })).toContainText('show file');

      // A late upload is kept but moves nothing: the lock holds and the package stays current.
      await page.goto(`/events/${eventId}/packages`);
      await expect(ballroomA).toContainText('current');

      // Override re-validates: a version that fails today's rules is refused, fix named.
      await page.goto(`/events/${eventId}/content`);
      const version = (n: number) => hollis.locator('li').filter({ hasText: new RegExp(`^v${n} `) });
      await version(1).getByLabel('Override reason').fill('Wrong file');
      await version(1).getByRole('button', { name: 'Override lock to this version' }).click();
      await expect(page.locator('p[role="alert"]')).toContainText('Override refused — v1 fails validation: Embed your fonts');

      await version(7).getByLabel('Override reason').fill('Speaker revised Q3 figures at 11pm');
      await version(7).getByRole('button', { name: 'Override lock to this version' }).click();
      await expect(hollis.getByRole('heading', { name: /Session deck \(deck\) — locked to v7/ })).toBeVisible();
      await expect(hollis).toContainText('Lock 2: override v7');
      await expect(hollis).toContainText('Speaker revised Q3 figures at 11pm');
      await expect(version(7)).toContainText('show file');

      // Distribution follows only on a producer's rebuild (D-016), and names what changed.
      await page.goto(`/events/${eventId}/packages`);
      await expect(ballroomA).toContainText('STALE — rebuild');
      await expect(ballroomA).toContainText(`Removed: ${HOLLIS_DECK} v6`);
      await expect(ballroomA).toContainText(`Added: ${HOLLIS_DECK} v7`);
      await ballroomA.getByRole('button', { name: 'Rebuild package' }).click();
      await expect(ballroomA).toContainText('Package 2');
      await expect(ballroomA).toContainText('current');
      await expect(keynoteRow).toContainText('Session deck v7');
      await expect(ballroomA.getByRole('button', { name: 'Rebuild package' })).toHaveCount(0);
    });
  });

  test.describe('budget spine (S-12)', () => {
    test('budget-to-actuals shows drift since the snapshot, and a lapsing COI flags the line', async ({ page }) => {
      await page.goto(`/events/${eventId}/budget`);
      const view = page.getByRole('region', { name: 'Budget to actuals' });
      // The LED change order after "Client-approved v1" is the only drift.
      await expect(view).toContainText('+$1,850.00 since snapshot 1 (Client-approved v1)');
      await expect(view.getByRole('row').filter({ hasText: /^av/ })).toContainText('+$1,850.00');

      const led = page.getByRole('region', { name: 'Budget lines' }).getByRole('row').filter({ hasText: 'LED wall' });
      await expect(led).toContainText('Brightline AV · compliance outstanding');

      const worklist = page.getByRole('region', { name: 'Compliance worklist' });
      await expect(worklist.getByRole('row').filter({ hasText: 'Brightline AV' }).filter({ hasText: 'certificate of insurance' })).toContainText('lapses before the show');
      await expect(worklist.getByRole('row').filter({ hasText: 'Petal & Stem' }).filter({ hasText: 'W-9' })).toContainText('not on file');
    });

    test('actuals are typed as dollars and land as cents; a bad amount is refused by name', async ({ page }) => {
      await page.goto(`/events/${eventId}/budget`);
      const florals = page.getByRole('region', { name: 'Budget lines' }).getByRole('row').filter({ hasText: 'Stage florals' });
      await florals.getByLabel('Actual for Stage florals').fill('2,712.40');
      await florals.getByRole('button', { name: 'Save' }).click();
      await expect(page.getByRole('region', { name: 'Budget to actuals' }).getByRole('row').filter({ hasText: /^decor/ })).toContainText('+$112.40');

      await florals.getByLabel('Actual for Stage florals').fill('12.345');
      await florals.getByRole('button', { name: 'Save' }).click();
      await expect(page.locator('p[role="alert"]')).toContainText('"12.345" is not an amount');
    });

    test('recording the renewal clears the flag, and the nag cadence sends once', async ({ page }) => {
      await page.goto(`/events/${eventId}/budget`);
      const send = page.getByRole('button', { name: /Send due nags \(\d+\)/ });
      await send.click();
      await expect(page.getByRole('button', { name: 'Send due nags (0)' })).toBeDisabled();
      await expect(page.getByRole('region', { name: 'Nag outbox' })).toContainText('Petal & Stem');

      await page.getByLabel('Document vendor').selectOption({ label: 'Brightline AV' });
      await page.getByLabel('Document kind').selectOption('coi');
      await page.getByLabel('Received').fill('2026-01-01');
      await page.getByLabel('Expires').fill('2030-01-01');
      await page.getByRole('button', { name: 'Record' }).click();
      const led = page.getByRole('region', { name: 'Budget lines' }).getByRole('row').filter({ hasText: 'LED wall' });
      await expect(led).not.toContainText('compliance outstanding');
    });
  });
});
