-- CreateEnum
CREATE TYPE "GuestKind" AS ENUM ('attendee', 'speaker', 'staff', 'vip');

-- CreateEnum
CREATE TYPE "AttritionChoice" AS ENUM ('release', 'accept');

-- CreateTable
CREATE TABLE "RoomBlock" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "rateCents" INTEGER NOT NULL,
    "contractedOn" DATE NOT NULL,
    "cutoffOn" DATE NOT NULL,

    CONSTRAINT "RoomBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlockNight" (
    "id" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "night" DATE NOT NULL,
    "rooms" INTEGER NOT NULL,

    CONSTRAINT "BlockNight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttritionThreshold" (
    "id" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "dueOn" DATE NOT NULL,
    "percent" INTEGER NOT NULL,

    CONSTRAINT "AttritionThreshold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomReservation" (
    "id" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "kind" "GuestKind" NOT NULL,
    "guest" TEXT NOT NULL,
    "rooms" INTEGER NOT NULL DEFAULT 1,
    "arriveOn" DATE NOT NULL,
    "departOn" DATE NOT NULL,
    "bookedOn" DATE NOT NULL,
    "speakerId" TEXT,
    "staffId" TEXT,

    CONSTRAINT "RoomReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttritionDecision" (
    "id" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "thresholdId" TEXT NOT NULL,
    "choice" "AttritionChoice" NOT NULL,
    "roomNights" INTEGER NOT NULL,
    "exposureCents" INTEGER NOT NULL,
    "decidedOn" DATE NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL,
    "budgetLineId" TEXT,

    CONSTRAINT "AttritionDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlockRelease" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "nightId" TEXT NOT NULL,
    "rooms" INTEGER NOT NULL,

    CONSTRAINT "BlockRelease_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BlockNight_blockId_night_key" ON "BlockNight"("blockId", "night");

-- CreateIndex
CREATE UNIQUE INDEX "AttritionThreshold_blockId_dueOn_key" ON "AttritionThreshold"("blockId", "dueOn");

-- CreateIndex
CREATE INDEX "RoomReservation_blockId_idx" ON "RoomReservation"("blockId");

-- CreateIndex
CREATE UNIQUE INDEX "AttritionDecision_budgetLineId_key" ON "AttritionDecision"("budgetLineId");

-- AddForeignKey
ALTER TABLE "RoomBlock" ADD CONSTRAINT "RoomBlock_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomBlock" ADD CONSTRAINT "RoomBlock_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlockNight" ADD CONSTRAINT "BlockNight_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "RoomBlock"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttritionThreshold" ADD CONSTRAINT "AttritionThreshold_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "RoomBlock"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomReservation" ADD CONSTRAINT "RoomReservation_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "RoomBlock"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomReservation" ADD CONSTRAINT "RoomReservation_speakerId_fkey" FOREIGN KEY ("speakerId") REFERENCES "Speaker"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomReservation" ADD CONSTRAINT "RoomReservation_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttritionDecision" ADD CONSTRAINT "AttritionDecision_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "RoomBlock"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttritionDecision" ADD CONSTRAINT "AttritionDecision_thresholdId_fkey" FOREIGN KEY ("thresholdId") REFERENCES "AttritionThreshold"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttritionDecision" ADD CONSTRAINT "AttritionDecision_budgetLineId_fkey" FOREIGN KEY ("budgetLineId") REFERENCES "BudgetLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlockRelease" ADD CONSTRAINT "BlockRelease_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "AttritionDecision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlockRelease" ADD CONSTRAINT "BlockRelease_nightId_fkey" FOREIGN KEY ("nightId") REFERENCES "BlockNight"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Money is integer cents; counts are whole and positive; a percent is a percent.
ALTER TABLE "RoomBlock" ADD CONSTRAINT "RoomBlock_check" CHECK ("rateCents" > 0 AND "cutoffOn" >= "contractedOn");
ALTER TABLE "BlockNight" ADD CONSTRAINT "BlockNight_rooms_check" CHECK ("rooms" >= 1);
ALTER TABLE "AttritionThreshold" ADD CONSTRAINT "AttritionThreshold_percent_check" CHECK ("percent" BETWEEN 1 AND 100);
ALTER TABLE "BlockRelease" ADD CONSTRAINT "BlockRelease_rooms_check" CHECK ("rooms" >= 1);
ALTER TABLE "AttritionDecision" ADD CONSTRAINT "AttritionDecision_check"
  CHECK ("roomNights" >= 1 AND ("choice" = 'accept') = ("budgetLineId" IS NOT NULL)
    AND CASE "choice" WHEN 'accept' THEN "exposureCents" > 0 ELSE "exposureCents" = 0 END);

-- A speaker's or staffer's room names them; nobody else's does.
ALTER TABLE "RoomReservation" ADD CONSTRAINT "RoomReservation_check" CHECK (
  "rooms" >= 1 AND "departOn" > "arriveOn"
  AND ("kind" = 'speaker') = ("speakerId" IS NOT NULL)
  AND ("kind" = 'staff') = ("staffId" IS NOT NULL));

-- The decision log is the record, and a release is part of it.
CREATE TRIGGER "AttritionDecision_append_only"
  BEFORE UPDATE OR DELETE ON "AttritionDecision"
  FOR EACH ROW EXECUTE FUNCTION refuse_mutation();
CREATE TRIGGER "BlockRelease_append_only"
  BEFORE UPDATE OR DELETE ON "BlockRelease"
  FOR EACH ROW EXECUTE FUNCTION refuse_mutation();
