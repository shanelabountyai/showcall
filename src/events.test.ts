import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from './db';
import { createEvent } from './events';
import { resetDb } from './test/harness';

describe('createEvent', () => {
  beforeEach(resetDb);
  const base = { name: 'Summit', clientName: 'Northwind', timezone: 'America/Chicago', startDate: '2026-10-13', endDate: '2026-10-14' };

  it('reuses a client by name', async () => {
    await createEvent(base);
    await createEvent({ ...base, name: 'Offsite', clientName: ' Northwind ' });
    expect(await prisma.client.count()).toBe(1);
    expect(await prisma.event.count()).toBe(2);
  });

  it('refuses a blank name, an unknown timezone, and dates that run backwards', async () => {
    for (const bad of [{ name: ' ' }, { timezone: 'Mars/Olympus' }, { endDate: '2026-10-12' }, { startDate: '' }]) {
      await expect(createEvent({ ...base, ...bad })).rejects.toThrow();
    }
    expect(await prisma.event.count()).toBe(0);
  });
});
