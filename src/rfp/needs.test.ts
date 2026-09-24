import { beforeEach, describe, expect, it } from 'vitest';
import { addVendor, recordDoc } from '../budget/compliance';
import { issueCrewLink, resolveCrewPortal, setRoleVendor } from '../callsheet/portal';
import { fixedClock } from '../clock';
import { prisma } from '../db';
import { makeEvent, resetDb } from '../test/harness';
import { addAttendee, addNeed, rollup, roster } from './needs';
import { addSchemaLine, award, createRfp, enterQuote, setRegistration } from './rfp';

beforeEach(resetDb);

const clock = fixedClock('2026-10-01T15:00:00Z');

/** Two attendee types, five people with distinct names and emails, a catering award and a non-catering vendor role. */
async function show() {
  const event = await makeEvent();
  await setRegistration(event.id, 'Sales', 40, 50);
  await setRegistration(event.id, 'VIP', 2, 2);
  const need = {
    vegan: await addNeed('dietary', 'Vegan'),
    nuts: await addNeed('dietary', 'Nut allergy'),
    halal: await addNeed('dietary', 'Halal'),
    chair: await addNeed('access', 'Wheelchair access'),
  };
  const people = [
    ['Sales', 'Marisol Quintero', 'mquintero@example.test', [need.vegan, need.nuts]],
    ['Sales', 'Tobias Ferreira-Lund', 'tfl@example.test', [need.vegan]],
    ['Sales', 'Aiko Brandvold', 'aiko.b@example.test', []],
    ['VIP', 'Desmond Achterberg', 'desmond@example.test', [need.chair, need.vegan]],
    ['VIP', 'Wren Oyelaran', 'woyelaran@example.test', [need.nuts]],
  ] as const;
  for (const [attendeeType, name, email, needs] of people) await addAttendee(event.id, { attendeeType, name, email, needIds: needs.map((n) => n.id) });

  await addSchemaLine('catering', 'Lunch', 'per_head');
  const rfp = await createRfp(event.id, 'catering', 'Lunch', clock);
  const [item] = await prisma.rfpItem.findMany({ where: { rfpId: rfp.id } });
  const caterer = await addVendor('Lakeshore Catering');
  await recordDoc(caterer.id, 'coi', '2026-01-01', '2027-01-01');
  await recordDoc(caterer.id, 'w9', '2026-01-01', null);
  const quote = await enterQuote(rfp.id, { vendorId: caterer.id, baseCents: 5_000, basePerHead: true, receivedOn: '2026-09-01', lines: [{ itemId: item!.id, inclusion: 'included', unitCents: null }] });
  await award(quote.id, 5_000 * 42, clock);

  const role = async (name: string, vendorId: string) => {
    const r = await prisma.callRole.create({ data: { eventId: event.id, name, reportTo: 'Dock B' } });
    await setRoleVendor(event.id, r.id, vendorId);
    return issueCrewLink(event.id, r.id);
  };
  const florist = await addVendor('Petal & Stem');
  return { event, people, links: { catering: await role('Catering', caterer.id), florist: await role('Florist', florist.id) } };
}

describe('dietary and accessibility rollups: counts, never names (P1-7)', () => {
  it('counts each need event-wide, every vocabulary entry present, and says how many registered have no record', async () => {
    const { event } = await show();
    expect(await rollup(event.id)).toEqual({
      registered: 42, records: 5,
      needs: [
        { kind: 'dietary', label: 'Vegan', count: 3 },
        { kind: 'dietary', label: 'Nut allergy', count: 2 },
        { kind: 'dietary', label: 'Halal', count: 0 },
        { kind: 'access', label: 'Wheelchair access', count: 1 },
      ],
    });
  });

  it('sweep: no name or email reaches the rollup or the caterer\'s portal; the producer roster has them all', async () => {
    const { event, people, links } = await show();
    const secrets = people.flatMap(([, name, email]) => [name, email, ...name.split(' ')]);
    const r = await rollup(event.id);
    const portal = await resolveCrewPortal(links.catering, clock);
    expect(portal!.catering).toEqual(r);
    // The projection's shape is fixed; a new field has to be added here on purpose.
    expect(Object.keys(r).sort()).toEqual(['needs', 'records', 'registered']);
    for (const n of r.needs) expect(Object.keys(n).sort()).toEqual(['count', 'kind', 'label']);
    for (const out of [JSON.stringify(r), JSON.stringify(portal)]) {
      for (const s of secrets) expect(out, `leaks "${s}"`).not.toContain(s);
      // Nor split by attendee type: two VIPs would make a count a person.
      expect(out).not.toContain('VIP');
    }
    const names = JSON.stringify(await roster(event.id));
    for (const s of secrets) expect(names).toContain(s);
  });

  it('only the vendor holding the catering contract sees the counts', async () => {
    const { links } = await show();
    expect((await resolveCrewPortal(links.florist, clock))!.catering).toBeNull();
  });

  it('refuses an unknown type, a repeat email, a blank name, or a need off the list', async () => {
    const { event } = await show();
    const a = { attendeeType: 'Sales', name: 'New Person', email: 'new@example.test', needIds: [] as string[] };
    await expect(addAttendee(event.id, { ...a, attendeeType: 'Press' })).rejects.toThrow('There is no "Press" registration');
    await expect(addAttendee(event.id, { ...a, email: ' TFL@example.test ' })).rejects.toThrow('tfl@example.test is already registered');
    await expect(addAttendee(event.id, { ...a, name: '  ' })).rejects.toThrow('needs a name and an email');
    await expect(addAttendee(event.id, { ...a, needIds: ['nope'] })).rejects.toThrow('No such need');
    await expect(prisma.$executeRaw`INSERT INTO "Need" (id, kind, label, position) VALUES ('x', 'dietary', ' ', 9)`).rejects.toThrow('Need_labelled');
    expect(await prisma.attendee.count()).toBe(5);
  });
});
