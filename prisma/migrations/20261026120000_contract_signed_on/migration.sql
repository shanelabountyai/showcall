-- D-054 (owner decision, 2026-10-26): the contract-signed date is a calendar
-- day, so it is stored as a 'YYYY-MM-DD' string (CHAR(10), never `date` and
-- never a timestamp) under a name that says so: contractSignedAt -> contractSignedOn.
--
-- Conversion rule. The only writer of "contractSignedAt" was the speakers page,
-- which stored `new Date('YYYY-MM-DD')` from an <input type="date">: UTC midnight
-- of the day entered (the seed wrote the same shape). Prisma writes a TIMESTAMP(3)
-- (no time zone) as its UTC wall time, and the page read it back as that UTC day.
-- So the day it was entered as is the date part of the stored value, taken as-is:
-- to_char on a `timestamp without time zone` does no zone conversion, so the
-- session TimeZone cannot move it. src/bureau/contract-signed.test.ts
-- runs this file against a scratch schema to prove it.

ALTER TABLE "Speaker" ADD COLUMN "contractSignedOn" CHAR(10);

UPDATE "Speaker" SET "contractSignedOn" = to_char("contractSignedAt", 'YYYY-MM-DD')
  WHERE "contractSignedAt" IS NOT NULL;

ALTER TABLE "Speaker" DROP COLUMN "contractSignedAt";

-- A real calendar day in canonical form: the shape, and a round trip through
-- `date` (which refuses '2026-02-30' outright).
ALTER TABLE "Speaker" ADD CONSTRAINT "Speaker_contractSignedOn_day" CHECK (
  "contractSignedOn" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  AND to_char("contractSignedOn"::date, 'YYYY-MM-DD') = "contractSignedOn"
);
