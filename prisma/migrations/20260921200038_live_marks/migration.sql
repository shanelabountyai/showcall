-- CreateTable
CREATE TABLE "LiveMark" (
    "id" TEXT NOT NULL,
    "rowId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "plannedMin" INTEGER NOT NULL,
    "actualMin" INTEGER NOT NULL,
    "markedAt" TIMESTAMP(3) NOT NULL,
    "eventId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,

    CONSTRAINT "LiveMark_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LiveMark_eventId_day_idx" ON "LiveMark"("eventId", "day");

-- AddForeignKey
ALTER TABLE "LiveMark" ADD CONSTRAINT "LiveMark_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveMark" ADD CONSTRAINT "LiveMark_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The show's actual timeline is kept exactly; a wrong GO is corrected by the next one.
CREATE TRIGGER "LiveMark_append_only"
  BEFORE UPDATE OR DELETE ON "LiveMark"
  FOR EACH ROW EXECUTE FUNCTION refuse_mutation();
ALTER TABLE "LiveMark" ADD CONSTRAINT "LiveMark_min_check" CHECK ("plannedMin" BETWEEN 0 AND 1439 AND "actualMin" BETWEEN 0 AND 1439);
