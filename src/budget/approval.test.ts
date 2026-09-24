import { beforeEach, describe, expect, it } from 'vitest';
import { fixedClock } from '../clock';
import { prisma } from '../db';
import { closeBudget } from '../reconcile/reconcile';
import { makeEvent, resetDb } from '../test/harness';
import { approvalState, decideBudget, issueClientLink, resolveClientPortal, unapproved } from './approval';
import { addLine, takeSnapshot, updateLine } from './budget';

const clock = fixedClock('2026-10-01T15:00:00Z');
const after = fixedClock('2026-10-20T15:00:00Z');
const line = (id: string, committedCents: number, actualCents = 0, clientBillable = true) => ({ id, description: id, committedCents, actualCents, clientBillable });

describe('what is unapproved', () => {
  it('is per line, so a swap that nets to zero is still a change', () => {
    const base = [line('led', 1_000_000), line('lunch', 500_000)];
    expect(unapproved([line('led', 800_000), line('lunch', 500_000), line('camera', 200_000)], base))
      .toEqual([{ id: 'camera', description: 'camera', cents: 200_000, isNew: true }]);
  });

  it('counts an invoice over its commitment, ignores house lines, and with no baseline everything billable', () => {
    expect(unapproved([line('led', 1_000_000, 1_100_000), line('meals', 90_000, 0, false)], [line('led', 1_000_000)]))
      .toEqual([{ id: 'led', description: 'led', cents: 100_000, isNew: false }]);
    expect(unapproved([line('led', 1_000_000), line('meals', 90_000, 0, false)], null)).toHaveLength(1);
  });
});

describe('the client portal', () => {
  beforeEach(resetDb);

  it('shows billable lines only, takes a decline with a reason, then an approval that becomes the baseline', async () => {
    const event = await makeEvent();
    const vendor = await prisma.vendor.create({ data: { name: 'Brightline AV' } });
    const led = await addLine(event.id, { category: 'av', description: 'LED wall', committedCents: 1_800_000, vendorId: vendor.id });
    await addLine(event.id, { category: 'catering', description: 'Crew meals', committedCents: 180_000, clientBillable: false });
    const token = await issueClientLink(event.id);
    expect((await resolveClientPortal(token, clock))!.sent).toBeNull();

    const v1 = await takeSnapshot(event.id, 'client v1', clock, true);
    await takeSnapshot(event.id, 'internal', clock); // not sent: the client never sees it
    const page = (await resolveClientPortal(token, clock))!;
    expect(page.sent).toMatchObject({ id: v1.id, cents: 1_800_000, lines: [{ category: 'av', description: 'LED wall', cents: 1_800_000, wasCents: null }] });
    expect(JSON.stringify(page)).not.toMatch(/Crew meals|Brightline/);

    await expect(decideBudget(token, v1.id, { approved: false, signedBy: 'Dana Ruiz' }, clock)).rejects.toThrow(/Say what needs to change/);
    await expect(decideBudget(token, v1.id, { approved: true, signedBy: '  ' }, clock)).rejects.toThrow(/Type your name/);
    await decideBudget(token, v1.id, { approved: false, signedBy: 'Dana Ruiz', note: 'LED wall over our number' }, clock);
    await expect(decideBudget(token, v1.id, { approved: true, signedBy: 'Dana Ruiz' }, clock)).rejects.toThrow(/already declined/);
    expect((await approvalState(event.id)).baseline).toBeNull();

    await updateLine(led.id, { committedCents: 1_600_000 });
    const v2 = await takeSnapshot(event.id, 'client v2', clock, true);
    await expect(decideBudget(token, v1.id, { approved: true, signedBy: 'Dana Ruiz' }, clock)).rejects.toThrow(/not the latest/);
    const yes = await decideBudget(token, v2.id, { approved: true, signedBy: 'Dana Ruiz' }, clock);
    await expect(decideBudget(token, v2.id, { approved: true, signedBy: 'Dana Ruiz' }, clock)).resolves.toMatchObject({ id: yes.id }); // double-click
    expect(await approvalState(event.id)).toMatchObject({ baseline: { id: v2.id }, unapprovedCents: 0 });

    // A change order after approval: the new figure is shown against the approved one.
    await updateLine(led.id, { committedCents: 1_985_000 });
    expect(await approvalState(event.id)).toMatchObject({ unapproved: [{ description: 'LED wall', cents: 385_000, isNew: false }] });
    await takeSnapshot(event.id, 'client v3', clock, true);
    expect((await resolveClientPortal(token, clock))!.sent!.lines[0]).toMatchObject({ cents: 1_985_000, wasCents: 1_600_000 });
  });

  it('a reissued or expired link is dead, and the database holds the answer', async () => {
    const event = await makeEvent();
    await addLine(event.id, { category: 'av', description: 'LED wall', committedCents: 100 });
    const old = await issueClientLink(event.id);
    const token = await issueClientLink(event.id);
    expect(await resolveClientPortal(old, clock)).toBeNull();
    expect(await resolveClientPortal(token, fixedClock('2026-10-22T15:00:00Z'))).toBeNull(); // a week after Oct 14
    const v1 = await takeSnapshot(event.id, 'client v1', clock, true);
    await expect(decideBudget(old, v1.id, { approved: true, signedBy: 'Dana' }, clock)).rejects.toThrow(/not valid/);

    const yes = await decideBudget(token, v1.id, { approved: true, signedBy: 'Dana' }, clock);
    await expect(prisma.budgetApproval.update({ where: { id: yes.id }, data: { approved: false } })).rejects.toThrow();
    await expect(prisma.budgetApproval.delete({ where: { id: yes.id } })).rejects.toThrow();
    const v2 = await takeSnapshot(event.id, 'client v2', clock, true);
    await expect(prisma.budgetApproval.create({ data: { snapshotId: v2.id, approved: false, signedBy: 'Dana', decidedAt: new Date() } })).rejects.toThrow(/decline_says_why/);
  });
});

describe('the close waits for the client', () => {
  beforeEach(resetDb);

  it('names each unapproved line, and clears once the client approves', async () => {
    const event = await makeEvent();
    const led = await addLine(event.id, { category: 'av', description: 'LED wall', committedCents: 1_800_000 });
    await updateLine(led.id, { actualCents: 1_800_000 });
    const token = await issueClientLink(event.id);
    await decideBudget(token, (await takeSnapshot(event.id, 'client v1', clock, true)).id, { approved: true, signedBy: 'Dana' }, clock);

    const camera = await addLine(event.id, { category: 'av', description: 'Second IMAG camera', committedCents: 185_000 });
    await updateLine(camera.id, { actualCents: 185_000 });
    await updateLine(led.id, { actualCents: 1_900_000 });
    await expect(closeBudget(event.id, 2_085_000, after)).rejects.toThrow(/Not approved by the client: LED wall, \+\$1,000\.00.*Second IMAG camera, \$1,850\.00/);

    const v2 = await takeSnapshot(event.id, 'client v2', clock, true);
    await decideBudget(token, v2.id, { approved: true, signedBy: 'Dana' }, clock);
    await expect(closeBudget(event.id, 2_085_000, after)).resolves.toMatchObject({ final: true });
  });
});
