-- CreateEnum
CREATE TYPE "LoadKind" AS ENUM ('load_in', 'load_out');

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "venueId" TEXT;

-- AlterTable
ALTER TABLE "Room" ADD COLUMN     "ceilingFt" INTEGER,
ADD COLUMN     "powerAmps" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "rigPointLbs" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "rigPoints" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Venue" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dockBays" INTEGER NOT NULL,
    "dockOpenMin" INTEGER NOT NULL,
    "dockCloseMin" INTEGER NOT NULL,
    "maxTruckFt" INTEGER NOT NULL,
    "wifiMbps" INTEGER NOT NULL,
    "unionHouse" BOOLEAN NOT NULL DEFAULT false,
    "minCallMin" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Venue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoadSlot" (
    "id" TEXT NOT NULL,
    "kind" "LoadKind" NOT NULL,
    "vendorId" TEXT NOT NULL,
    "trucks" INTEGER NOT NULL,
    "truckFt" INTEGER NOT NULL,
    "rigPoints" INTEGER NOT NULL DEFAULT 0,
    "rigPointLbs" INTEGER NOT NULL DEFAULT 0,
    "powerAmps" INTEGER NOT NULL DEFAULT 0,
    "ceilingFt" INTEGER NOT NULL DEFAULT 0,
    "cueId" TEXT NOT NULL,

    CONSTRAINT "LoadSlot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Venue_name_key" ON "Venue"("name");

-- CreateIndex
CREATE UNIQUE INDEX "LoadSlot_cueId_key" ON "LoadSlot"("cueId");

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoadSlot" ADD CONSTRAINT "LoadSlot_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoadSlot" ADD CONSTRAINT "LoadSlot_cueId_fkey" FOREIGN KEY ("cueId") REFERENCES "Cue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- House facts are minutes of a day and non-negative counts (D-024).
ALTER TABLE "Venue" ADD CONSTRAINT "Venue_dock_check" CHECK ("dockBays" >= 1 AND "dockOpenMin" >= 0 AND "dockOpenMin" < "dockCloseMin" AND "dockCloseMin" <= 1440);
ALTER TABLE "Venue" ADD CONSTRAINT "Venue_counts_check" CHECK ("maxTruckFt" > 0 AND "wifiMbps" >= 0 AND "minCallMin" >= 0);
ALTER TABLE "Room" ADD CONSTRAINT "Room_spec_check" CHECK (("ceilingFt" IS NULL OR "ceilingFt" > 0) AND "rigPoints" >= 0 AND "rigPointLbs" >= 0 AND "powerAmps" >= 0);
ALTER TABLE "LoadSlot" ADD CONSTRAINT "LoadSlot_counts_check" CHECK ("trucks" >= 1 AND "truckFt" > 0 AND "rigPoints" >= 0 AND "rigPointLbs" >= 0 AND "powerAmps" >= 0 AND "ceilingFt" >= 0);
