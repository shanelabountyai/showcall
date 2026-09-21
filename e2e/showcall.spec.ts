import { test, expect } from '@playwright/test';

const title = (t: string) => `input[name="title"][value="${t}"]`;
const KEYNOTE = 'Opening keynote: Care at the speed of trust';

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
});
