-- CreateEnum
CREATE TYPE "Edge" AS ENUM ('start', 'end');

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "runSheetVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Cue" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "day" DATE,
    "startMin" INTEGER,
    "anchorId" TEXT,
    "anchorEdge" "Edge",
    "offsetMin" INTEGER NOT NULL DEFAULT 0,
    "endById" TEXT,
    "endByEdge" "Edge",
    "endByOffsetMin" INTEGER NOT NULL DEFAULT 0,
    "eventId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,

    CONSTRAINT "Cue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Cue_eventId_idx" ON "Cue"("eventId");

-- AddForeignKey
ALTER TABLE "Cue" ADD CONSTRAINT "Cue_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cue" ADD CONSTRAINT "Cue_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A cue starts one way: fixed (day + startMin) or anchored (anchorId + edge).
ALTER TABLE "Cue" ADD CONSTRAINT "Cue_start_check" CHECK (
  ("day" IS NULL) = ("startMin" IS NULL)
  AND ("anchorId" IS NULL) = ("anchorEdge" IS NULL)
  AND ("anchorId" IS NULL) = ("day" IS NOT NULL)
);
ALTER TABLE "Cue" ADD CONSTRAINT "Cue_endBy_check" CHECK (("endById" IS NULL) = ("endByEdge" IS NULL));
ALTER TABLE "Cue" ADD CONSTRAINT "Cue_minutes_check"
  CHECK ("durationMin" >= 0 AND ("startMin" IS NULL OR ("startMin" >= 0 AND "startMin" < 1440)));
ALTER TABLE "Event" ADD CONSTRAINT "Event_runSheetVersion_check" CHECK ("runSheetVersion" >= 0);
