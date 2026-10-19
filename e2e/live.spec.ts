import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test, expect, type Browser, type Locator, type Page } from '@playwright/test';

/**
 * Showcall Live, phase 1 gate (S-30): two browsers, a dropped connection, two
 * editors on one row, the crew portal, and commit-to-visible latency, on the
 * production build. Serial, and it reseeds before and after, so the story spec
 * gets a fresh seed in either file order (the S-19 precedent).
 *
 * Needs LIVE_TEST_HOOKS=1 on the server for `?dropAfter=` (D-043).
 */
const reseed = () => execSync('npm run db:seed:test', { stdio: 'ignore' });

/** The test database, for the one thing a page cannot tell us: how many change-log rows exist. */
function databaseUrl() {
  const fromEnv = process.env.DATABASE_URL;
  const raw = fromEnv ?? /^DATABASE_URL="?([^"\n]+)"?/m.exec(readFileSync('.env.test', 'utf8'))?.[1];
  if (!raw) throw new Error('DATABASE_URL is not set and .env.test has none');
  return raw.split('?')[0]!;
}
const showChanges = () => Number(execSync(`psql "${databaseUrl()}" -tAc 'SELECT count(*) FROM "ShowChange"'`).toString().trim());

const row = (page: Page, label: string) => page.locator(`article[data-label="${label}"]`).first();
const chip = (page: Page) => page.getByTestId('live-chip');

/** Open a cue's form, change it, and preview. */
async function edit(page: Page, label: string, fill: (form: Locator) => Promise<void>) {
  const r = row(page, label);
  await r.getByRole('button', { name: `Edit ${label}` }).click();
  const form = r.getByRole('form');
  await fill(form);
  await form.getByRole('button', { name: 'Preview' }).click();
  await expect(form.getByRole('region', { name: 'Preview' })).toBeVisible();
  return form;
}
async function commit(form: Locator) {
  await form.getByRole('button', { name: 'Commit', exact: true }).click();
}
async function editAndCommit(page: Page, label: string, fill: (form: Locator) => Promise<void>) {
  const form = await edit(page, label, fill);
  await commit(form);
  await expect(row(page, label).getByRole('form')).toHaveCount(0);
}

/** Main-frame navigations, to prove an update arrived without one. */
function navigations(page: Page) {
  let n = 0;
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) n++; });
  return () => n;
}

async function runsheetAs(browser: Browser, eventId: string, who: string | null, query = '') {
  const page = await (await browser.newContext()).newPage();
  await page.goto(`/events/${eventId}/runsheet${query}`);
  if (who) {
    await page.getByRole('navigation', { name: 'Editing as' }).getByRole('link', { name: who }).click();
    await expect(page.getByRole('navigation', { name: 'Editing as' }).locator('strong', { hasText: who })).toBeVisible();
  }
  await expect(chip(page)).toHaveAttribute('data-status', 'live');
  return page;
}

test.describe.serial('Showcall Live (S-30)', () => {
  let eventId = '';

  test.beforeAll(async ({ request }) => {
    reseed();
    eventId = (await (await request.get('/')).text()).match(/href="\/events\/([^/"]+)\/grid"/)![1]!;
  });
  test.afterAll(() => { reseed(); });

  test('L1.9a + L1.9d (ii): a commit reaches every open view; the crew portal gets its own re-issue and nothing else', async ({ browser }) => {
    test.setTimeout(120_000);
    // C: A1 Audio's portal, from a link the producer issues.
    const producer = await (await browser.newContext()).newPage();
    await producer.goto(`/events/${eventId}/callsheets`);
    const audio = producer.getByRole('region', { name: 'A1 Audio', exact: true });
    await audio.getByRole('button', { name: /portal link/ }).click();
    const link = (await audio.getByRole('status').getByRole('link', { name: 'open' }).getAttribute('href'))!;

    const A = await runsheetAs(browser, eventId, 'Morgan Ellis');
    const B = await runsheetAs(browser, eventId, null);
    const Bsheets = await B.context().newPage();
    await Bsheets.goto(`/events/${eventId}/callsheets`);
    const C = await (await browser.newContext()).newPage();
    await C.goto(link);
    const issueBefore = (await C.getByTestId('issue-number').textContent())!;
    await expect(chip(C)).toHaveAttribute('data-frames', '1'); // a crew stream always sends its projection on connect
    const navs = { B: navigations(B), Bsheets: navigations(Bsheets), C: navigations(C) };
    const urls = { B: B.url(), Bsheets: Bsheets.url(), C: C.url() };

    for (const role of ['A1 Audio', 'Catering', 'Doors & Registration']) {
      await expect(Bsheets.getByRole('region', { name: role, exact: true }).getByTestId('role-status')).not.toContainText('NEEDS RE-ISSUE');
    }

    // A moves "Doors open" (day 1) ten minutes later.
    const doors = row(B, 'Doors open');
    const doorsId = (await doors.getAttribute('data-row-id'))!;
    const doorsStart = Number(await doors.getAttribute('data-start'));
    const dependants = B.locator(`article[data-anchor="${doorsId}"]`);
    const depIds = await dependants.evaluateAll((els) => els.map((e) => [e.getAttribute('data-row-id')!, Number(e.getAttribute('data-start'))] as const));
    expect(depIds.length).toBeGreaterThan(0); // the rain call's decide-by hangs off the doors
    const form = await edit(A, 'Doors open', async (f) => {
      const offset = f.getByLabel('Offset (min)');
      await offset.fill(String(Number(await offset.inputValue()) + 10));
    });
    await commit(form);

    await expect(B.locator(`article[data-row-id="${doorsId}"]`)).toHaveAttribute('data-start', String(doorsStart + 10), { timeout: 3_000 });
    for (const [id, start] of depIds) await expect(B.locator(`article[data-row-id="${id}"]`)).toHaveAttribute('data-start', String(start + 10), { timeout: 1_000 });
    await expect(Bsheets.getByRole('region', { name: 'Doors & Registration', exact: true }).getByTestId('role-status')).toContainText('NEEDS RE-ISSUE', { timeout: 3_000 });
    for (const role of ['A1 Audio', 'Catering']) {
      await expect(Bsheets.getByRole('region', { name: role, exact: true }).getByTestId('role-status')).not.toContainText('NEEDS RE-ISSUE');
    }

    // A issues: only Doors & Registration changed, so A1 Audio's portal gets no frame at all (D-040).
    await producer.goto(`/events/${eventId}/callsheets`);
    await producer.getByRole('button', { name: 'Issue changed sheets' }).click();
    await expect(producer.getByRole('status')).toContainText('Call sheets issued: Doors & Registration.');
    await expect(Bsheets.getByRole('region', { name: 'Doors & Registration', exact: true }).getByTestId('role-status')).not.toContainText('NEEDS RE-ISSUE', { timeout: 3_000 });

    // Catering's cue moves and is issued: still nothing for A1 Audio.
    await editAndCommit(A, 'Lunch service', async (f) => { await f.getByLabel('Start').fill('12:25'); });
    await producer.getByRole('button', { name: 'Issue changed sheets' }).click();
    await expect(producer.getByRole('status')).toContainText('Call sheets issued: Catering.');
    await C.waitForTimeout(2_500); // two and a half polls
    await expect(chip(C)).toHaveAttribute('data-frames', '1');
    await expect(C.getByTestId('issue-number')).toHaveText(issueBefore);

    // A1 Audio's own cue moves and is issued: C shows the new issue within 3 s.
    await editAndCommit(A, 'Walk-in music', async (f) => {
      const offset = f.getByLabel('Offset (min)');
      await offset.fill(String(Number(await offset.inputValue()) - 5));
    });
    await producer.getByRole('button', { name: 'Issue changed sheets' }).click();
    await expect(producer.getByRole('status')).toContainText('Call sheets issued: A1 Audio.');
    const n = Number(/Issue (\d+)/.exec(issueBefore)![1]);
    await expect(C.getByTestId('issue-number')).toContainText(`Issue ${n + 1} `, { timeout: 3_000 });
    await expect(chip(C)).toHaveAttribute('data-frames', '2');

    // L1.9d (ii): after both issues, none of Catering's cues is anywhere in A1 Audio's portal.
    const dom = await C.content();
    for (const label of ['Lunch service', 'Afternoon coffee', 'Closing reception']) expect(dom, `A1 Audio portal shows "${label}"`).not.toContain(label);

    // No reload anywhere: same URLs, no navigations since the views opened.
    expect({ B: navs.B(), Bsheets: navs.Bsheets(), C: navs.C() }).toEqual({ B: 0, Bsheets: 0, C: 0 });
    expect({ B: B.url(), Bsheets: Bsheets.url(), C: C.url() }).toEqual(urls);
  });

  test('L1.9b: a dropped view catches up with both edits, lists them once, and a second drop adds nothing', async ({ browser }) => {
    test.setTimeout(120_000);
    // dropAfter closes A's stream every 1.5 s (LIVE_TEST_HOOKS=1), so going offline is a real drop
    // whether or not the browser's offline mode cuts an open EventSource (brief §8.3).
    const A = await runsheetAs(browser, eventId, null, '?dropAfter=1500');
    const B = await runsheetAs(browser, eventId, 'Priya Natarajan');
    const navA = navigations(A);
    const lunch = row(A, 'Lunch service'), lectern = row(A, 'Lectern mic swap');
    const [lunchStart, lecternStart] = [Number(await lunch.getAttribute('data-start')), Number(await lectern.getAttribute('data-start'))];

    await A.context().setOffline(true);
    await expect(chip(A)).not.toHaveAttribute('data-status', 'live', { timeout: 15_000 });

    await editAndCommit(B, 'Lunch service', async (f) => { await f.getByLabel('Start').fill('12:40'); });
    await editAndCommit(B, 'Lectern mic swap', async (f) => {
      const offset = f.getByLabel('Offset (min)');
      await offset.fill(String(Number(await offset.inputValue()) + 5));
    });
    await expect(lunch).toHaveAttribute('data-start', String(lunchStart)); // A has not seen them

    await A.context().setOffline(false);
    await expect(lunch).toHaveAttribute('data-start', String(12 * 60 + 40), { timeout: 5_000 });
    await expect(lectern).toHaveAttribute('data-start', String(lecternStart + 5), { timeout: 5_000 });
    const away = A.getByRole('region', { name: 'While you were away' }).getByRole('listitem');
    await expect(away).toHaveCount(2, { timeout: 5_000 });
    for (const li of await away.all()) await expect(li).toContainText('Priya Natarajan');
    const sheet = await A.locator('article').evaluateAll((els) => els.map((e) => `${e.getAttribute('data-row-id')} ${e.getAttribute('data-start')}`));

    // Drop again with nothing changed: no new entries, no duplicate rows, nothing moves.
    await A.context().setOffline(true);
    await expect(chip(A)).not.toHaveAttribute('data-status', 'live', { timeout: 15_000 });
    await A.context().setOffline(false);
    await expect(chip(A)).toHaveAttribute('data-status', 'live', { timeout: 10_000 });
    await A.waitForTimeout(2_500);
    await expect(away).toHaveCount(2);
    expect(await A.locator('article').evaluateAll((els) => els.map((e) => `${e.getAttribute('data-row-id')} ${e.getAttribute('data-start')}`))).toEqual(sheet);
    expect(navA()).toBe(0);
  });

  test('L1.9c: two editors on one row; the second is refused, keeps its values, re-previews and lands', async ({ browser }) => {
    test.setTimeout(120_000);
    const before = showChanges();
    const A = await runsheetAs(browser, eventId, 'Morgan Ellis');
    const B = await runsheetAs(browser, eventId, 'Priya Natarajan');
    const label = 'Closing reception';

    const formA = await edit(A, label, async (f) => { await f.getByLabel('Start').fill('10:05'); });
    const formB = await edit(B, label, async (f) => { await f.getByLabel('Start').fill('10:20'); });
    // Both opened the row at the same revision.
    expect(await formA.locator('input[name="rev"]').inputValue()).toBe(await formB.locator('input[name="rev"]').inputValue());

    await commit(formA);
    await expect(row(A, label).getByRole('form')).toHaveCount(0);
    await expect(row(B, label)).toHaveAttribute('data-start', String(10 * 60 + 5), { timeout: 3_000 }); // B sees A's change live

    await commit(formB);
    const changed = formB.getByRole('region', { name: 'Row changed' });
    await expect(changed.getByRole('alert')).toContainText('Morgan Ellis');
    await expect(formB.getByLabel('Start')).toHaveValue('10:20'); // what B typed is kept
    await expect(changed.getByTestId('current-row')).toContainText('10:05');

    await changed.getByRole('button', { name: 'Re-preview against current' }).click();
    await expect(formB.getByRole('region', { name: 'Preview' })).toBeVisible();
    await commit(formB);
    await expect(row(B, label).getByRole('form')).toHaveCount(0);
    await expect(row(B, label)).toHaveAttribute('data-start', String(10 * 60 + 20));
    await expect(row(A, label)).toHaveAttribute('data-start', String(10 * 60 + 20), { timeout: 3_000 });

    expect(showChanges() - before).toBe(2); // the winner, then B's re-previewed commit; nothing for the refusal
  });

  test('L1.10: commit-to-visible latency over 20 edits', async ({ browser }) => {
    test.setTimeout(240_000);
    const A = await runsheetAs(browser, eventId, 'Morgan Ellis');
    const B = await runsheetAs(browser, eventId, null);
    const id = (await row(B, 'Doors open').getAttribute('data-row-id'))!;
    const ms: number[] = [];
    for (let i = 0; i < 20; i++) {
      const start = Number(await row(B, 'Doors open').getAttribute('data-start'));
      const delta = i % 2 === 0 ? 5 : -5;
      const form = await edit(A, 'Doors open', async (f) => {
        const offset = f.getByLabel('Offset (min)');
        await offset.fill(String(Number(await offset.inputValue()) + delta));
      });
      const t0 = Date.now();
      await commit(form);
      await B.waitForFunction(([rowId, want]) => document.querySelector(`article[data-row-id="${rowId}"]`)?.getAttribute('data-start') === want, [id, String(start + delta)] as const, { polling: 20, timeout: 10_000 });
      ms.push(Date.now() - t0);
      await expect(row(A, 'Doors open').getByRole('form')).toHaveCount(0);
    }
    const sorted = [...ms].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length / 2)]!, max = sorted.at(-1)!;
    // A GitHub workflow command: CI shows it as an annotation, which can be read where logs cannot.
    console.log(`\n::notice title=Live latency (L1.10)::commit-to-visible over ${ms.length} edits: p50 ${p50} ms, max ${max} ms; all ${ms.join(', ')}`);
    test.info().annotations.push({ type: 'latency', description: `p50 ${p50} ms, max ${max} ms over ${ms.length} edits` });
    expect(p50).toBeLessThanOrEqual(2_000);
    expect(max).toBeLessThanOrEqual(3_000);
  });
});
