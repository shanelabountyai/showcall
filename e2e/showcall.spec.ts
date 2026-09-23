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
});
