import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../db';
import { makeEvent, makeSpeaker, resetDb } from '../test/harness';
import { localDate } from '../time';
import { setProfile, SpeakerRefused } from './bureau';

/**
 * D-054: the contract-signed date is a calendar day stored as a 'YYYY-MM-DD'
 * string. CI runs this file under the default TZ; the owner's check is that it
 * gives the same answers under TZ=Pacific/Kiritimati (UTC+14) and TZ=UTC, where
 * a day stored through a JS Date would land on different days.
 */

const MIGRATION = 'prisma/migrations/20261026120000_contract_signed_on/migration.sql';

beforeEach(resetDb);

describe('contractSignedOn round trip', () => {
  // The year's edges and both US DST days: the days a timestamp would shift first.
  const days = ['2026-01-01', '2026-03-08', '2026-08-15', '2026-11-01', '2026-12-31'];

  it.each(days)('%s goes in and comes back as the same day, whatever the process TZ', async (day) => {
    const speaker = await makeSpeaker((await makeEvent()).id);
    await setProfile(speaker.id, { contractSignedOn: day });
    expect((await prisma.speaker.findUniqueOrThrow({ where: { id: speaker.id } })).contractSignedOn).toBe(day);
    // And the column holds exactly those ten characters.
    const [raw] = await prisma.$queryRaw<{ v: string }[]>`SELECT "contractSignedOn" AS v FROM "Speaker" WHERE id = ${speaker.id}`;
    expect(raw!.v).toBe(day);
  });

  it('clearing it stores null', async () => {
    const speaker = await makeSpeaker((await makeEvent()).id);
    await setProfile(speaker.id, { contractSignedOn: '2026-08-15' });
    await setProfile(speaker.id, { contractSignedOn: null });
    expect((await prisma.speaker.findUniqueOrThrow({ where: { id: speaker.id } })).contractSignedOn).toBeNull();
  });

  it('refuses a string that is not a calendar day, in the module and in the database', async () => {
    const speaker = await makeSpeaker((await makeEvent()).id);
    for (const bad of ['2026-02-30', '2026-8-15', '2026-08-15T00:00:00Z', '15/08/2026']) {
      await expect(setProfile(speaker.id, { contractSignedOn: bad })).rejects.toThrow(SpeakerRefused);
      expect(() => localDate(bad)).toThrow(`Not a date: ${bad}`);
    }
    // Past the module, the CHECK constraint holds the shape.
    await expect(prisma.speaker.update({ where: { id: speaker.id }, data: { contractSignedOn: '2026-8-15' } })).rejects.toThrow(/Speaker_contractSignedOn_day/);
    await expect(prisma.speaker.update({ where: { id: speaker.id }, data: { contractSignedOn: '2026-02-30' } })).rejects.toThrow();
    expect((await prisma.speaker.findUniqueOrThrow({ where: { id: speaker.id } })).contractSignedOn).toBeNull();
  });
});

describe('the D-054 migration', () => {
  it('the premise: Prisma wrote a TIMESTAMP(3) as its UTC wall time, so UTC midnight of the day entered', async () => {
    // consentRecordedAt is the Speaker's other TIMESTAMP(3) column, written the same way the old one was.
    const speaker = await makeSpeaker((await makeEvent()).id);
    await prisma.speaker.update({ where: { id: speaker.id }, data: { consentRecordedAt: new Date(Date.UTC(2026, 7, 15)) } });
    const [raw] = await prisma.$queryRaw<{ v: string }[]>`SELECT to_char("consentRecordedAt", 'YYYY-MM-DD HH24:MI:SS') AS v FROM "Speaker" WHERE id = ${speaker.id}`;
    expect(raw!.v).toBe('2026-08-15 00:00:00');
  });

  it('converts each stored timestamp to the calendar day it was entered as, whatever the session TimeZone', async () => {
    const db = new Client({ connectionString: process.env.DATABASE_URL!.split('?')[0] });
    await db.connect();
    try {
      for (const sessionTz of ['Pacific/Kiritimati', 'UTC', 'America/Chicago']) {
        await db.query('DROP SCHEMA IF EXISTS d054_scratch CASCADE; CREATE SCHEMA d054_scratch');
        await db.query('CREATE TABLE d054_scratch."Speaker" (id TEXT PRIMARY KEY, "contractSignedAt" TIMESTAMP(3))');
        // What the old writer stored: `new Date('YYYY-MM-DD')` is UTC midnight, written as UTC wall time.
        await db.query(`INSERT INTO d054_scratch."Speaker" VALUES
          ('seed', '2026-08-15 00:00:00'), ('newyear', '2026-01-01 00:00:00'), ('eve', '2026-12-31 00:00:00'),
          ('dst', '2026-03-08 00:00:00'), ('none', NULL)`);
        await db.query(`SET search_path TO d054_scratch; SET TimeZone TO '${sessionTz}'`);
        await db.query(readFileSync(MIGRATION, 'utf8'));
        const { rows } = await db.query('SELECT id, "contractSignedOn" AS day FROM "Speaker" ORDER BY id');
        expect(rows, sessionTz).toEqual([
          { id: 'dst', day: '2026-03-08' }, { id: 'eve', day: '2026-12-31' }, { id: 'newyear', day: '2026-01-01' },
          { id: 'none', day: null }, { id: 'seed', day: '2026-08-15' },
        ]);
        const { rows: cols } = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'd054_scratch' AND table_name = 'Speaker' ORDER BY column_name`);
        expect(cols.map((c) => c.column_name)).toEqual(['contractSignedOn', 'id']);
        await db.query('RESET search_path; RESET TimeZone');
      }
    } finally {
      await db.query('DROP SCHEMA IF EXISTS d054_scratch CASCADE');
      await db.end();
    }
  });
});
