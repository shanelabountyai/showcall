-- Showcall Live (D-037): one change sequence per show, bumped by trigger in
-- commit order, and an append-only log of what each committed transaction did.

-- AlterTable
ALTER TABLE "Event" ADD COLUMN "changeSeq" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ShowChange" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "eventId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "txid" BIGINT NOT NULL,
    "kinds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "actor" TEXT NOT NULL DEFAULT '',
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShowChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShowChange_eventId_seq_key" ON "ShowChange"("eventId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "ShowChange_eventId_txid_key" ON "ShowChange"("eventId", "txid");

-- AddForeignKey
ALTER TABLE "ShowChange" ADD CONSTRAINT "ShowChange_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ShowChange" ADD CONSTRAINT "ShowChange_seq_check" CHECK ("seq" >= 1);

-- The bump. The first call in a transaction for an event takes the event row
-- lock with UPDATE … RETURNING and writes the log row; the lock is held to
-- commit, so seq N+1 cannot commit before N, and the numbers have no gaps.
-- Later calls in the same transaction only append kinds they have not seen.
-- `at` is the database's transaction time (D-048): a trigger cannot see the
-- injected clock, and no rule reads it.
CREATE FUNCTION bump_show_change(event_id TEXT, VARIADIC new_kinds TEXT[]) RETURNS void AS $$
DECLARE
  tx BIGINT := txid_current();
  held TEXT[];
  next_seq INTEGER;
BEGIN
  IF event_id IS NULL THEN
    RETURN;
  END IF;
  SELECT c.kinds INTO held FROM "ShowChange" c WHERE c."eventId" = event_id AND c.txid = tx;
  IF FOUND THEN
    IF NOT (held @> new_kinds) THEN
      UPDATE "ShowChange" c
        SET kinds = held || ARRAY(SELECT k FROM unnest(new_kinds) AS k WHERE NOT (k = ANY (held)))
        WHERE c."eventId" = event_id AND c.txid = tx;
    END IF;
    RETURN;
  END IF;
  UPDATE "Event" SET "changeSeq" = "changeSeq" + 1 WHERE id = event_id RETURNING "changeSeq" INTO next_seq;
  IF next_seq IS NULL THEN
    RETURN; -- the event is gone with the row that pointed at it
  END IF;
  INSERT INTO "ShowChange" ("eventId", seq, txid, kinds, actor)
    VALUES (event_id, next_seq, tx, new_kinds, COALESCE(current_setting('showcall.actor', true), ''));
END;
$$ LANGUAGE plpgsql;

-- Append-only, with one permitted change (the D-026 move): the transaction
-- that wrote the row may append kinds to it. Nothing else, and nobody else.
CREATE FUNCTION show_change_append_kinds() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE'
     OR (to_jsonb(NEW) - 'kinds') <> (to_jsonb(OLD) - 'kinds')
     OR NOT (NEW.kinds @> OLD.kinds)
     OR OLD.txid <> txid_current() THEN
    RAISE EXCEPTION 'ShowChange is append-only; the only change is its own transaction appending a kind';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ShowChange_append_only"
  BEFORE UPDATE OR DELETE ON "ShowChange"
  FOR EACH ROW EXECUTE FUNCTION show_change_append_kinds();

-- One trigger function per table, each resolving the row's event.

CREATE FUNCTION show_change_cue() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM bump_show_change(OLD."eventId", 'cue', 'cue:' || OLD.id);
  ELSE
    PERFORM bump_show_change(NEW."eventId", 'cue', 'cue:' || NEW.id);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "Cue_show_change" AFTER INSERT OR UPDATE OR DELETE ON "Cue"
  FOR EACH ROW EXECUTE FUNCTION show_change_cue();

-- Through the role, not the cue: a cue delete cascades here after the cue row is gone.
CREATE FUNCTION show_change_cue_role() RETURNS trigger AS $$
DECLARE
  role_id TEXT := CASE WHEN TG_OP = 'DELETE' THEN OLD."roleId" ELSE NEW."roleId" END;
  cue_id TEXT := CASE WHEN TG_OP = 'DELETE' THEN OLD."cueId" ELSE NEW."cueId" END;
BEGIN
  PERFORM bump_show_change((SELECT "eventId" FROM "CallRole" WHERE id = role_id), 'tag', 'cue:' || cue_id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "CueRole_show_change" AFTER INSERT OR UPDATE OR DELETE ON "CueRole"
  FOR EACH ROW EXECUTE FUNCTION show_change_cue_role();

CREATE FUNCTION show_change_live_mark() RETURNS trigger AS $$
DECLARE event_id TEXT := CASE WHEN TG_OP = 'DELETE' THEN OLD."eventId" ELSE NEW."eventId" END;
BEGIN
  PERFORM bump_show_change(event_id, 'go');
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "LiveMark_show_change" AFTER INSERT OR UPDATE OR DELETE ON "LiveMark"
  FOR EACH ROW EXECUTE FUNCTION show_change_live_mark();

CREATE FUNCTION show_change_issue() RETURNS trigger AS $$
DECLARE role_id TEXT := CASE WHEN TG_OP = 'DELETE' THEN OLD."roleId" ELSE NEW."roleId" END;
BEGIN
  PERFORM bump_show_change((SELECT "eventId" FROM "CallRole" WHERE id = role_id), 'issue');
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "CallSheetIssue_show_change" AFTER INSERT OR UPDATE OR DELETE ON "CallSheetIssue"
  FOR EACH ROW EXECUTE FUNCTION show_change_issue();

CREATE FUNCTION show_change_receipt() RETURNS trigger AS $$
DECLARE issue_id TEXT := CASE WHEN TG_OP = 'DELETE' THEN OLD."issueId" ELSE NEW."issueId" END;
BEGIN
  PERFORM bump_show_change((
    SELECT cr."eventId" FROM "CallSheetIssue" i JOIN "CallRole" cr ON cr.id = i."roleId" WHERE i.id = issue_id
  ), 'receipt');
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "CallSheetReceipt_show_change" AFTER INSERT OR UPDATE OR DELETE ON "CallSheetReceipt"
  FOR EACH ROW EXECUTE FUNCTION show_change_receipt();

CREATE FUNCTION show_change_agenda_version() RETURNS trigger AS $$
DECLARE event_id TEXT := CASE WHEN TG_OP = 'DELETE' THEN OLD."eventId" ELSE NEW."eventId" END;
BEGIN
  PERFORM bump_show_change(event_id, 'publish');
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "AgendaVersion_show_change" AFTER INSERT OR UPDATE OR DELETE ON "AgendaVersion"
  FOR EACH ROW EXECUTE FUNCTION show_change_agenda_version();

-- Lock writes hold the deliverable row first (src/content/lock.ts), then this
-- takes the event row: Deliverable → Event, never the other way round.
CREATE FUNCTION show_change_show_file_lock() RETURNS trigger AS $$
DECLARE deliverable_id TEXT := CASE WHEN TG_OP = 'DELETE' THEN OLD."deliverableId" ELSE NEW."deliverableId" END;
BEGIN
  PERFORM bump_show_change((SELECT "eventId" FROM "Deliverable" WHERE id = deliverable_id), 'lock');
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ShowFileLock_show_change" AFTER INSERT OR UPDATE OR DELETE ON "ShowFileLock"
  FOR EACH ROW EXECUTE FUNCTION show_change_show_file_lock();

CREATE FUNCTION show_change_content_version() RETURNS trigger AS $$
DECLARE deliverable_id TEXT := CASE WHEN TG_OP = 'DELETE' THEN OLD."deliverableId" ELSE NEW."deliverableId" END;
BEGIN
  PERFORM bump_show_change((SELECT "eventId" FROM "Deliverable" WHERE id = deliverable_id), 'upload');
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ContentVersion_show_change" AFTER INSERT OR UPDATE OR DELETE ON "ContentVersion"
  FOR EACH ROW EXECUTE FUNCTION show_change_content_version();

-- A rebase moves the pinned version. The bump's own UPDATE sets only
-- "changeSeq", so `UPDATE OF "runSheetVersion"` and the WHEN guard both keep
-- this from recursing.
CREATE FUNCTION show_change_rebase() RETURNS trigger AS $$
BEGIN
  PERFORM bump_show_change(NEW.id, 'rebase');
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "Event_show_change" AFTER UPDATE OF "runSheetVersion" ON "Event"
  FOR EACH ROW WHEN (OLD."runSheetVersion" IS DISTINCT FROM NEW."runSheetVersion")
  EXECUTE FUNCTION show_change_rebase();
