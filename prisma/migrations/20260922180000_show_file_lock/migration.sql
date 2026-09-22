-- CreateEnum
CREATE TYPE "LockKind" AS ENUM ('approve', 'override');

-- CreateEnum
CREATE TYPE "Audience" AS ENUM ('room', 'attendees');

-- CreateTable
CREATE TABLE "ShowFileLock" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "deliverableId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "kind" "LockKind" NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShowFileLock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DistributionPackage" (
    "id" TEXT NOT NULL,
    "audience" "Audience" NOT NULL,
    "number" INTEGER NOT NULL,
    "agendaVersion" INTEGER NOT NULL,
    "manifest" JSONB NOT NULL,
    "sha256" TEXT NOT NULL,
    "builtAt" TIMESTAMP(3) NOT NULL,
    "eventId" TEXT NOT NULL,
    "roomId" TEXT,

    CONSTRAINT "DistributionPackage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShowFileLock_deliverableId_number_key" ON "ShowFileLock"("deliverableId", "number");

-- CreateIndex
CREATE INDEX "DistributionPackage_eventId_audience_roomId_idx" ON "DistributionPackage"("eventId", "audience", "roomId");

-- AddForeignKey
ALTER TABLE "ShowFileLock" ADD CONSTRAINT "ShowFileLock_deliverableId_fkey" FOREIGN KEY ("deliverableId") REFERENCES "Deliverable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShowFileLock" ADD CONSTRAINT "ShowFileLock_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ContentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DistributionPackage" ADD CONSTRAINT "DistributionPackage_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DistributionPackage" ADD CONSTRAINT "DistributionPackage_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;



-- An override carries its reason; a room package names its room, an attendees package none.
-- Lock 1 is the approve and every later one an override (D-016).
ALTER TABLE "ShowFileLock" ADD CONSTRAINT "ShowFileLock_shape_check" CHECK (("number" = 1) = ("kind" = 'approve') AND ("kind" = 'approve' OR btrim("reason") <> ''));
ALTER TABLE "DistributionPackage" ADD CONSTRAINT "DistributionPackage_room_check" CHECK (("audience" = 'room') = ("roomId" IS NOT NULL));
ALTER TABLE "DistributionPackage" ADD CONSTRAINT "DistributionPackage_number_check" CHECK ("number" >= 1);

-- A lock points at a version of its own deliverable. src/content/lock.ts
-- checks this too; the trigger is the backstop, not the gate.
CREATE FUNCTION show_file_lock_own_version() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "ContentVersion" WHERE id = NEW."versionId" AND "deliverableId" = NEW."deliverableId") THEN
    RAISE EXCEPTION 'ShowFileLock: version % is not on deliverable %', NEW."versionId", NEW."deliverableId";
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER "ShowFileLock_own_version" BEFORE INSERT ON "ShowFileLock"
  FOR EACH ROW EXECUTE FUNCTION show_file_lock_own_version();

-- Every lock and every built package is kept exactly.
CREATE TRIGGER "ShowFileLock_append_only"
  BEFORE UPDATE OR DELETE ON "ShowFileLock"
  FOR EACH ROW EXECUTE FUNCTION refuse_mutation();
CREATE TRIGGER "DistributionPackage_append_only"
  BEFORE UPDATE OR DELETE ON "DistributionPackage"
  FOR EACH ROW EXECUTE FUNCTION refuse_mutation();
