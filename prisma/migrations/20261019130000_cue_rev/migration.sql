-- Showcall Live (D-039): a row revision for reject-and-refresh. Every write to
-- a cue row bumps it, whoever writes; the row editor commits against the rev
-- it loaded and is refused with RowChanged when it has moved.

-- AlterTable
ALTER TABLE "Cue" ADD COLUMN "rev" INTEGER NOT NULL DEFAULT 0;

CREATE FUNCTION cue_bump_rev() RETURNS trigger AS $$
BEGIN
  NEW.rev := OLD.rev + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Cue_rev"
  BEFORE UPDATE ON "Cue"
  FOR EACH ROW EXECUTE FUNCTION cue_bump_rev();
