/*
  Warnings:

  - Added the required column `staffId` to the `LiveMark` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "DayRole" AS ENUM ('producer', 'stage_manager', 'technical_director', 'crew');

-- AlterTable
ALTER TABLE "LiveMark" ADD COLUMN     "staffId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "Staff" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "maxMinutesPerDay" INTEGER NOT NULL DEFAULT 720,

    CONSTRAINT "Staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assignment" (
    "id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "startMin" INTEGER NOT NULL,
    "endMin" INTEGER NOT NULL,
    "role" "DayRole" NOT NULL,
    "staffId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "roomId" TEXT,

    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Staff_name_key" ON "Staff"("name");

-- CreateIndex
CREATE INDEX "Assignment_staffId_day_idx" ON "Assignment"("staffId", "day");

-- CreateIndex
CREATE INDEX "Assignment_eventId_day_idx" ON "Assignment"("eventId", "day");

-- AddForeignKey
ALTER TABLE "LiveMark" ADD CONSTRAINT "LiveMark_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_min_check"
  CHECK ("startMin" >= 0 AND "startMin" < "endMin" AND "endMin" <= 1440);
ALTER TABLE "Staff" ADD CONSTRAINT "Staff_capacity_check" CHECK ("maxMinutesPerDay" BETWEEN 1 AND 1440);
