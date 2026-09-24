import { execSync } from 'node:child_process';
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
  test.describe('reconciliation (S-20)', () => {
    test('the GO just called shows as planned vs. actual, and the close waits for the show to end', async ({ page }) => {
      await page.goto(`/events/${eventId}/reconcile`);
      const ballroom = page.getByRole('article', { name: /^Ballroom A / });
      await expect(ballroom.getByRole('row').filter({ hasText: KEYNOTE })).toContainText('+8 min'); // from the seeded GO log
      await expect(ballroom.getByRole('row').last()).not.toContainText('not called'); // the GO Priya just called
      await expect(page.getByRole('list', { name: 'Close blockers' })).toContainText('The show runs through');
      await expect(page.getByRole('button', { name: /Close the budget/ })).toHaveCount(0);
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
      await expect(page.getByRole('status')).toContainText('copy it now');
      expect(page.url()).not.toContain('link='); // SEC-04: the token is never in a URL
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

  test.describe('post-show recap (S-26)', () => {
    test('an attendee sees what consent releases: Owen\'s recording, not Lucia\'s; the producer sees why', async ({ page }) => {
      await page.goto(`/events/${eventId}/packages`);
      await expect(page.getByRole('region', { name: /^Attendees/ })).toContainText('Withheld: Session recording — Lucia Varga did not consent to recording');
      const avery = page.getByRole('region', { name: 'Attendee recap links' }).getByRole('row').filter({ hasText: 'Avery Chen' });
      await expect(avery).toContainText('issued');
      await avery.getByRole('button', { name: 'Reissue' }).click();
      const url = await avery.getByRole('status').locator('code').textContent();

      await page.goto(url!);
      await expect(page.getByRole('heading', { level: 1 })).toContainText('session materials');
      const rows = page.getByRole('table', { name: 'Session materials' }).getByRole('row');
      const owen = rows.filter({ hasText: 'Owen Castellano' }).filter({ hasText: 'Session recording' });
      await expect(owen).toHaveCount(1);
      await expect(rows.filter({ hasText: 'Lucia Varga' }).filter({ hasText: 'Session recording' })).toHaveCount(0);
      const res = await page.request.get((await owen.getByRole('link').getAttribute('href'))!);
      expect(res.status()).toBe(200);
      expect(res.headers()['content-disposition']).toMatch(/^attachment/);
      expect((await page.request.get(`${url}/file/not-a-file`)).status()).toBe(404);
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

  test.describe('room-block attrition (S-13)', () => {
    test('the D-30 alert is framed as a decision; releasing clears it and is logged', async ({ page }) => {
      await page.goto('/');
      await page.getByRole('link', { name: 'Northwind Fall Sales Kickoff' }).click();
      await page.getByRole('link', { name: 'Rooms' }).click();
      const alerts = page.getByRole('region', { name: 'Attrition alerts' });
      await expect(alerts).toContainText(/80% by .*: Release 24 room-nights by .* or accept \$4,541\.00 \(19 room-nights short\)/);

      await alerts.getByRole('button', { name: 'Release 24' }).click();
      await expect(alerts).toContainText('No attrition decision is due.');
      const block = page.getByRole('region', { name: 'Block at Lakeview Grand Hotel' });
      await expect(block).toContainText('released 24 room-nights');
      await expect(block.getByRole('row').filter({ hasText: '80% by' })).toContainText('on pace');
    });
  });

  test.describe('dietary and accessibility rollup (S-24)', () => {
    test('catering sees counts and the unknowns; names stay in the producer roster', async ({ page }) => {
      await page.goto('/');
      await page.getByRole('link', { name: 'Northwind Fall Sales Kickoff' }).click();
      await page.getByRole('link', { name: 'RFPs' }).click();
      const counts = page.getByRole('region', { name: 'Catering rollup' });
      await expect(counts).toContainText('counts from 238 attendee records of 260 registered, never names. 22 registered have no record');
      await expect(counts).toContainText('Vegetarian (dietary): 26');
      await expect(counts).toContainText('Wheelchair access (access): 2');
      await expect(counts).not.toContainText('Avery');
      await page.getByText('Attendees — 238 records (producer only)').click();
      await expect(page.getByRole('group', { name: 'Attendees' })).toContainText('Avery Lindqvist');
    });
  });

  test.describe('RFP normalization (S-14)', () => {
    test('quotes compare like for like, the gap is named, and the award lands on the budget flagged', async ({ page }) => {
      await page.goto('/');
      await page.getByRole('link', { name: 'Northwind Fall Sales Kickoff' }).click();
      await page.getByRole('link', { name: 'RFPs' }).click();
      await expect(page.getByRole('region', { name: 'Registration' })).toContainText('260 registered');
      const rfp = page.getByRole('region', { name: 'RFP Kickoff catering' });
      const total = rfp.getByRole('row').filter({ hasText: 'Total' });
      await expect(total).toContainText('$22,320.00');
      await expect(total).toContainText('$18,210.00excludes Afternoon break');
      await expect(total).toContainText('$22,060.00 — lowest complete');
      await expect(rfp.getByRole('table', { name: 'Comparison' }).getByRole('row', { name: /^Afternoon break \(per head\) — gap/ })).toContainText('EXCLUDED');

      await rfp.getByRole('button', { name: 'Award Summit Hospitality Group $22,060.00' }).click();
      const contract = rfp.getByLabel('Contract');
      await expect(contract).toContainText('Awarded to Summit Hospitality Group at $22,060.00');
      await expect(contract).toContainText(/Compliance at award: certificate of insurance expires .*, before the show ends/);
      await expect(rfp.getByRole('button', { name: /^Award / })).toHaveCount(0);

      await page.getByRole('link', { name: 'Budget' }).click();
      const line = page.getByRole('region', { name: 'Budget lines' }).getByRole('row').filter({ hasText: 'Kickoff catering — Summit Hospitality Group' });
      await expect(line.getByLabel('Committed for Kickoff catering — Summit Hospitality Group (RFP award)')).toHaveValue('22060.00');
      await expect(line).toContainText('Summit Hospitality Group · compliance outstanding');
    });
  });

  test.describe('Phase 3 gate (S-15)', () => {
    test('the kickoff story: release the rooms (no exposure on the ledger), award the catering (a commitment on it)', async ({ page }) => {
      // Half 1 (S-13 ran first): the alert is gone and the release is logged.
      await page.goto('/');
      await page.getByRole('link', { name: 'Northwind Fall Sales Kickoff' }).click();
      await page.getByRole('link', { name: 'Rooms' }).click();
      await expect(page.getByRole('region', { name: 'Attrition alerts' })).toContainText('No attrition decision is due.');

      // Half 2 (S-14 ran second): the award is a commitment. Releasing rooms cost nothing,
      // so the ledger carries the catering line and no attrition line.
      await page.getByRole('link', { name: 'Budget' }).click();
      const lines = page.getByRole('region', { name: 'Budget lines' });
      await expect(lines.getByRole('row').filter({ hasText: 'Kickoff catering — Summit Hospitality Group' })).toContainText('Summit Hospitality Group');
      await expect(lines.getByRole('row').filter({ hasText: 'Room-block attrition' })).toHaveCount(0);
      await expect(page.getByRole('region', { name: 'Budget to actuals' }).getByRole('row').filter({ hasText: /^catering/ })).toContainText('$22,060.00');
    });
  });

  test.describe('venue profile and load plan (S-18)', () => {
    test('the house facts, what each room takes, and every slot at its billed call', async ({ page }) => {
      await page.goto(`/events/${eventId}/rfps`);
      await page.getByRole('link', { name: 'Venue', exact: true }).click();
      await expect(page.getByRole('region', { name: 'Venue profile' })).toContainText('Dock: 2 bays, open 6:00–23:00, trucks up to 48 ft · Wifi 500 Mbps · Union house: 4h minimum call');
      await expect(page.getByRole('region', { name: 'Rooms' }).getByRole('row').filter({ hasText: 'Lakeview Terrace' })).toContainText('open air');
      const plan = page.getByRole('region', { name: 'Load plan' });
      await expect(plan.getByRole('row').filter({ hasText: 'Load-in: Brightline AV' })).toContainText(/8:00–14:00.*2 × 48 ft.*8 points × 750 lb, 400 A, 20 ft trim.*6h/);
      await expect(plan.getByRole('row').filter({ hasText: 'Load-in: Petal & Stem' })).toContainText(/6:00–7:00.*4h$/);
      await expect(plan.getByRole('row').filter({ hasText: 'Load-out: Brightline AV' })).toContainText(/19:00–22:00.*Ballroom A.*4h$/);
    });

    test('a slot that overfills the dock is refused, naming the truck already there', async ({ page }) => {
      await page.goto(`/events/${eventId}/venue`);
      const plan = page.getByRole('region', { name: 'Load plan' });
      await plan.getByLabel('Vendor').selectOption({ label: 'Petal & Stem' });
      await plan.getByLabel('Day').selectOption({ index: 0 });
      await plan.getByLabel('Start').fill('10:00');
      await plan.getByRole('button', { name: 'Plan slot' }).click();
      await expect(page.locator('p[role="alert"]')).toContainText('puts 3 trucks at the Lakeshore Grand Conference Center dock at 10:00');
      await expect(page.locator('p[role="alert"]')).toContainText('(with "Load-in: Brightline AV"); it has 2 bays');
      await expect(page.getByRole('region', { name: 'Load plan' }).getByRole('row')).toHaveCount(4);
    });

    test('closing the dock before the load-out ends is refused; the profile stands', async ({ page }) => {
      await page.goto(`/events/${eventId}/venue`);
      const profile = page.getByRole('region', { name: 'Venue profile' });
      await profile.getByLabel('Dock closes').fill('21:00');
      await profile.getByRole('button', { name: 'Save profile' }).click();
      await expect(page.locator('p[role="alert"]')).toContainText(/"Load-out: Brightline AV" runs 19:00–22:00 .*; the Lakeshore Grand Conference Center dock is open 6:00–21:00/);
      await expect(page.getByRole('region', { name: 'Venue profile' })).toContainText('open 6:00–23:00');
    });
  });

  test.describe('contingency plans (S-16)', () => {
    test('the rain call shows its decide-by, both branches and what each would tell vendors', async ({ page }) => {
      await page.goto(`/events/${eventId}/chase`);
      await page.getByRole('link', { name: 'Contingency', exact: true }).click();
      const rain = page.getByRole('region', { name: 'Rain call: closing reception' });
      await expect(rain.getByRole('heading')).toContainText('open');
      await expect(rain).toContainText(/Decide by 10:00 .* owner Morgan Ellis/);
      const branch = (label: string) => rain.getByRole('row').filter({ hasText: label });
      await expect(branch('Dry: hold on the terrace')).toContainText('as planned');
      await expect(branch('Rain: move to Ballroom A')).toContainText('Closing reception');
      await expect(branch('Rain: move to Ballroom A')).toContainText('Lakeshore Catering: Reception service moves to Ballroom A');
      await expect(branch('Rain: move to Ballroom A')).toContainText('$3,800.00 production (Brightline AV)');
    });

    test('the rain call executes: preview, commit, and only the sheets that carry the reception re-issue (S-17)', async ({ page }) => {
      // The keynote story left the sheet on agenda v1; a producer rebases (and sends the sheets that moved) before calling it.
      await page.goto(`/events/${eventId}/live`);
      await page.getByRole('button', { name: 'Rebase and re-issue call sheets' }).click();
      await expect(page.getByText('published past this run sheet')).toHaveCount(0);

      await page.goto(`/events/${eventId}/contingency`);
      const rain = page.getByRole('region', { name: 'Rain call: closing reception' });
      await rain.getByRole('link', { name: 'Preview Rain: move to Ballroom A' }).click();
      const preview = rain.getByRole('region', { name: 'Preview' });
      await expect(preview).toContainText(/Closing reception: 17:00–18:30 .*, Lakeview Terrace → 17:30–19:00 .*, Ballroom A/);
      await expect(preview).toContainText(/Load-out: Brightline AV: 19:00–22:00 .* → 19:30–22:30/);
      await expect(preview).toContainText('Call sheets re-issued: Catering, Doors & Registration.');
      // Work rules warn, never block (D-027): the later reception runs the door crew past ten hours.
      await expect(preview.getByRole('list', { name: 'Work rules' })).toContainText(/New: Doors & Registration .*: on the clock 8:\d\d–19:00, \d+ min past the 10:00 straight-time day/);
      await preview.getByRole('button', { name: 'Execute Rain: move to Ballroom A' }).click();

      await expect(rain.getByRole('heading').first()).toContainText('decided');
      const log = rain.getByRole('region', { name: 'Decision log' });
      await expect(log).toContainText('Budget: $3,800.00 committed as "Rain call: closing reception: Rain: move to Ballroom A"');
      await expect(log).toContainText(/Call sheets re-issued: Catering \(issue \d+\), Doors & Registration \(issue \d+\)\./);
      await expect(log).toContainText('Sent to Lakeshore Catering: Reception service moves to Ballroom A');
      await expect(rain.getByRole('row').filter({ hasText: 'Dry: hold on the terrace' })).toContainText('not taken');
      await expect(rain.getByRole('link', { name: /^Preview/ })).toHaveCount(0);
    });
  });

  /**
   * The PRD's five-minute story, one test, in order, on a fresh seed — the
   * blocks above spent the seed's v7, keynote and rain call on their own.
   */
  test.describe('Phase 4 gate — the capstone (S-19)', () => {
    let summit = '';

    test.beforeAll(async ({ request }) => {
      execSync('npm run db:seed:test', { stdio: 'ignore' });
      summit = (await (await request.get('/')).text()).match(/href="\/events\/([^/"]+)\/grid"/)![1]!;
    });

    test('v7 after lock, the keynote moves 15, the rain call executes at its decide-by', async ({ page }) => {
      test.setTimeout(90_000);

      // 1. The 11pm v7: the lock holds until a producer overrides it, and only the rebuild distributes it.
      await page.goto(`/events/${summit}/content`);
      const hollis = page.locator('section').filter({ has: page.getByRole('heading', { name: /^Hollis Grant/ }) });
      await hollis.getByRole('button', { name: /Reissue portal link/ }).click();
      await page.getByRole('status').getByRole('link', { name: 'open' }).click();
      await page.getByLabel('File for Session deck').setInputFiles({ ...(await deck(false)), name: 'hollis-grant-deck-v7.pdf' });
      await page.getByRole('button', { name: 'Upload' }).click();
      await expect(page.locator('li').filter({ hasText: /^v7 / })).toContainText('needs review');
      await expect(page.locator('li').filter({ hasText: /^v6 / })).toContainText('show file');

      await page.goto(`/events/${summit}/content`);
      const v7 = hollis.locator('li').filter({ hasText: /^v7 / });
      await v7.getByLabel('Override reason').fill('Speaker revised Q3 figures at 11pm');
      await v7.getByRole('button', { name: 'Override lock to this version' }).click();
      await expect(hollis).toContainText('Lock 2: override v7');

      await page.goto(`/events/${summit}/packages`);
      const ballroomA = page.getByRole('region', { name: 'Ballroom A — playback' });
      await expect(ballroomA).toContainText('STALE — rebuild');
      await ballroomA.getByRole('button', { name: 'Rebuild package' }).click();
      await expect(ballroomA.getByRole('row').filter({ hasText: 'Keynote: The next five years' })).toContainText('Session deck v7');

      // 2. The keynote moves 15: publish, the live run sheet flags stale, the rebase re-issues only the sheets that moved.
      await page.goto(`/events/${summit}/grid`);
      const row = page.locator('form').filter({ has: page.locator(title(KEYNOTE)) });
      await row.getByLabel('Start').fill('09:15');
      await row.getByLabel('End').fill('10:15');
      await row.getByRole('button', { name: 'Save' }).click();
      await expect(page.getByText('No conflicts.')).toBeVisible();
      await page.getByRole('button', { name: 'Publish version 2' }).click();
      await expect(page.getByText('Published: version 2.')).toBeVisible();

      await page.goto(`/events/${summit}/live`);
      await page.getByRole('button', { name: 'Rebase and re-issue call sheets' }).click();
      await expect(page.getByRole('status')).toHaveText('Call sheets re-issued: A1 Audio, Doors & Registration.');
      await expect(page.getByText('published past this run sheet')).toHaveCount(0);

      // 3. The rain call, still open before its decide-by cue and never escalated, executes as one commit.
      await page.goto(`/events/${summit}/contingency`);
      const rain = page.getByRole('region', { name: 'Rain call: closing reception' });
      await expect(rain.getByRole('heading').first()).toContainText('open');
      await expect(rain).toContainText(/Decide by 10:00 /);
      await expect(page.getByRole('region', { name: 'Escalation outbox' })).not.toContainText('Rain call');

      await rain.getByRole('link', { name: 'Preview Rain: move to Ballroom A' }).click();
      const preview = rain.getByRole('region', { name: 'Preview' });
      await expect(preview).toContainText(/Closing reception: 17:00–18:30 .*, Lakeview Terrace → 17:30–19:00 .*, Ballroom A/);
      await expect(preview).toContainText('Call sheets re-issued: Catering, Doors & Registration.');
      await preview.getByRole('button', { name: 'Execute Rain: move to Ballroom A' }).click();

      await expect(rain.getByRole('heading').first()).toContainText('decided');
      const log = rain.getByRole('region', { name: 'Decision log' });
      await expect(log).toContainText('Budget: $3,800.00 committed');
      await expect(log).toContainText(/Call sheets re-issued: Catering \(issue \d+\), Doors & Registration \(issue \d+\)\./);
      await expect(rain.getByRole('row').filter({ hasText: 'Dry: hold on the terrace' })).toContainText('not taken');
    });
  });

  test.describe('crew portal (S-21)', () => {
    // After the Phase 4 gate's reseed: the event id changed, and A1 Audio's sheet was just re-issued.
    let eventId = '';
    test.beforeAll(async ({ request }) => {
      eventId = (await (await request.get('/')).text()).match(/href="\/events\/([^/"]+)\/grid"/)![1]!;
    });

    test('A1 Audio confirms its re-issued sheet; Brightline sends a COI that counts only once a producer accepts it', async ({ page }) => {
      await page.goto(`/events/${eventId}/callsheets`);
      const audio = page.getByRole('region', { name: 'A1 Audio', exact: true });
      await expect(audio).toContainText('awaiting receipt'); // the Phase 4 gate re-issued it
      await audio.getByRole('button', { name: /portal link/ }).click();
      const url = await audio.getByRole('status').getByRole('link', { name: 'open' }).getAttribute('href');
      expect(page.url()).not.toContain('/portal/'); // SEC-04

      const res = await page.goto(url!);
      expect(res!.headers()['cache-control']).toContain('no-store'); // SEC-05
      expect(res!.headers()['referrer-policy']).toBe('no-referrer');
      expect(res!.headers()['x-robots-tag']).toContain('noindex');
      await expect(page.getByRole('heading', { name: /A1 Audio call sheet/ })).toBeVisible();
      await expect(page.getByText('Walk-in music').first()).toBeVisible();
      await expect(page.getByText('Lunch service')).toHaveCount(0); // Catering's cue (hard rule 7)
      await page.getByRole('button', { name: /^Confirm I have issue \d+$/ }).click();
      await expect(page.getByRole('status')).toContainText('You confirmed receipt');

      const coi = page.getByRole('region', { name: 'Certificate of insurance' });
      await coi.getByLabel('Certificate file').setInputFiles({ name: 'brightline-coi.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 renewal') });
      await coi.getByLabel('Expires').fill('2027-09-30');
      await coi.getByRole('button', { name: 'Upload certificate' }).click();
      await expect(coi).toContainText('brightline-coi.pdf');
      await expect(coi).toContainText('waiting for review');

      await page.goto(`/events/${eventId}/budget`);
      const worklist = page.getByRole('region', { name: 'Compliance worklist' });
      const brightlineCoi = worklist.getByRole('row').filter({ hasText: 'Brightline AV' }).filter({ hasText: 'certificate of insurance' });
      await expect(brightlineCoi).toContainText('lapses before the show'); // pending is not compliant
      const uploaded = page.getByRole('list', { name: 'Uploaded certificates' }).getByRole('listitem').filter({ hasText: 'Brightline AV' });
      await uploaded.getByRole('button', { name: 'Accept certificate' }).click();
      await expect(brightlineCoi).toContainText('in force to');
      await expect(page.getByRole('list', { name: 'Uploaded certificates' })).toHaveCount(0);

      await page.goto(url!);
      await expect(page.getByRole('region', { name: 'Certificate of insurance' })).toContainText('accepted');
      await page.goto(`/events/${eventId}/callsheets`);
      await expect(audio).toContainText('receipt confirmed');
    });

    test('a bad crew link is a plain 404, with the portal headers', async ({ page }) => {
      const res = await page.goto('/portal/call/not-a-real-token');
      expect(res?.status()).toBe(404);
      expect(res!.headers()['referrer-policy']).toBe('no-referrer');
    });
  });

  test.describe('client approval (S-23)', () => {
    // After the Phase 4 gate's reseed, as for the crew portal.
    let eventId = '';
    test.beforeAll(async ({ request }) => {
      eventId = (await (await request.get('/')).text()).match(/href="\/events\/([^/"]+)\/grid"/)![1]!;
    });

    test('a change order is unapproved until the client signs a new snapshot; a decline needs a reason', async ({ page }) => {
      await page.goto(`/events/${eventId}/budget`);
      const approval = page.getByRole('region', { name: 'Client approval' });
      await expect(approval).toContainText('Approved: #1 Client-approved v1, signed by Dana Ruiz');
      await expect(approval.getByRole('list', { name: 'Unapproved spend' })).toContainText('LED wall and switcher: +$1,850.00');

      await page.getByLabel('Snapshot label').fill('client v2');
      await page.getByLabel('send to the client for approval').check();
      await page.getByRole('button', { name: 'Take snapshot' }).click();
      await expect(approval).toContainText('client v2 — waiting for the client');

      await approval.getByRole('button', { name: /client link/ }).click();
      await expect(approval.getByRole('status').last()).toContainText('copy it now');
      await approval.getByRole('link', { name: 'open' }).click();
      const sent = page.getByRole('region', { name: 'Budget for approval' });
      await expect(sent.getByRole('row').filter({ hasText: 'LED wall and switcher' })).toContainText(/\$19,850\.00.*\$18,000\.00/);
      await expect(sent).not.toContainText('Crew meals'); // house cost is not the client's

      await page.getByLabel('Your name').fill('Dana Ruiz');
      await page.getByRole('button', { name: 'Decline' }).click();
      await expect(page.locator('p[role="alert"]')).toContainText('Say what needs to change');
      await page.getByLabel('Your name').fill('Dana Ruiz');
      await page.getByRole('button', { name: /^Approve/ }).click();
      await expect(page.getByRole('status')).toContainText('Approved by Dana Ruiz');

      await page.goto(`/events/${eventId}/budget`);
      await expect(approval).toContainText('All billable spend is approved.');
    });

    test('a bad client link is a plain 404, with the portal headers', async ({ page }) => {
      const res = await page.goto('/portal/client/not-a-real-token');
      expect(res?.status()).toBe(404);
      expect(res!.headers()['cache-control']).toContain('no-store');
    });
  });

  test.describe('portfolio calendar (S-25)', () => {
    test('a turnaround across timezones is flagged, on the calendar and the event', async ({ page }) => {
      await page.goto('/');
      await page.getByRole('link', { name: 'Portfolio calendar' }).click();
      const warnings = page.getByRole('list', { name: 'Staff conflicts' });
      await expect(warnings).toContainText(/Sam Okafor.*9:00 rest, 10h owed.*Northwind Fall Sales Kickoff.*23:00 America\/Chicago.*Northwind West Roadshow.*6:00–14:00 America\/Los_Angeles/);
      await page.getByRole('link', { name: 'Northwind West Roadshow' }).click();
      await expect(page.getByRole('list', { name: 'Cross-event warnings' })).toContainText(/Sam Okafor: 9:00 rest next to Northwind Fall Sales Kickoff/);
    });
  });
});
