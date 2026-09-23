-- AlterTable
ALTER TABLE "BudgetSnapshot" ADD COLUMN "final" BOOLEAN NOT NULL DEFAULT false;

-- One close per event.
CREATE UNIQUE INDEX "BudgetSnapshot_one_close" ON "BudgetSnapshot" ("eventId") WHERE "final";

-- A closed budget is frozen (D-025). The share lock on the event waits out a
-- close in flight (it holds FOR UPDATE), so a line cannot slip in beside it.
CREATE FUNCTION refuse_closed_budget() RETURNS trigger AS $$
DECLARE
  event_id TEXT := CASE WHEN TG_OP = 'DELETE' THEN OLD."eventId" ELSE NEW."eventId" END;
BEGIN
  PERFORM 1 FROM "Event" WHERE id = event_id FOR SHARE;
  IF EXISTS (SELECT 1 FROM "BudgetSnapshot" WHERE "eventId" = event_id AND "final") THEN
    RAISE EXCEPTION 'The budget for event % is closed', event_id;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "BudgetLine_closed"
  BEFORE INSERT OR UPDATE OR DELETE ON "BudgetLine"
  FOR EACH ROW EXECUTE FUNCTION refuse_closed_budget();
