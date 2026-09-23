-- CreateEnum
CREATE TYPE "LineBasis" AS ENUM ('per_head', 'each', 'flat');

-- CreateEnum
CREATE TYPE "Inclusion" AS ENUM ('included', 'excluded', 'extra');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('awarded', 'sent', 'signed');

-- CreateTable
CREATE TABLE "Registration" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "attendeeType" TEXT NOT NULL,
    "registered" INTEGER NOT NULL,
    "capacity" INTEGER NOT NULL,

    CONSTRAINT "Registration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LineSchema" (
    "id" TEXT NOT NULL,
    "category" "BudgetCategory" NOT NULL,
    "label" TEXT NOT NULL,
    "basis" "LineBasis" NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "LineSchema_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rfp" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "category" "BudgetCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rfp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RfpItem" (
    "id" TEXT NOT NULL,
    "rfpId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "basis" "LineBasis" NOT NULL,
    "quantity" INTEGER,
    "position" INTEGER NOT NULL,

    CONSTRAINT "RfpItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "rfpId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "baseCents" INTEGER NOT NULL,
    "basePerHead" BOOLEAN NOT NULL,
    "receivedOn" DATE NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteLine" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "inclusion" "Inclusion" NOT NULL,
    "unitCents" INTEGER,

    CONSTRAINT "QuoteLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL,
    "rfpId" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "budgetLineId" TEXT NOT NULL,
    "committedCents" INTEGER NOT NULL,
    "headcount" INTEGER NOT NULL,
    "papers" TEXT[],
    "gaps" TEXT[],
    "status" "ContractStatus" NOT NULL DEFAULT 'awarded',
    "awardedAt" TIMESTAMP(3) NOT NULL,
    "statusAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Registration_eventId_attendeeType_key" ON "Registration"("eventId", "attendeeType");

-- CreateIndex
CREATE UNIQUE INDEX "LineSchema_category_label_key" ON "LineSchema"("category", "label");

-- CreateIndex
CREATE UNIQUE INDEX "RfpItem_rfpId_label_key" ON "RfpItem"("rfpId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_rfpId_vendorId_key" ON "Quote"("rfpId", "vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteLine_quoteId_itemId_key" ON "QuoteLine"("quoteId", "itemId");

-- CreateIndex
CREATE UNIQUE INDEX "Contract_rfpId_key" ON "Contract"("rfpId");

-- CreateIndex
CREATE UNIQUE INDEX "Contract_quoteId_key" ON "Contract"("quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "Contract_budgetLineId_key" ON "Contract"("budgetLineId");

-- AddForeignKey
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rfp" ADD CONSTRAINT "Rfp_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RfpItem" ADD CONSTRAINT "RfpItem_rfpId_fkey" FOREIGN KEY ("rfpId") REFERENCES "Rfp"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_rfpId_fkey" FOREIGN KEY ("rfpId") REFERENCES "Rfp"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "RfpItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_rfpId_fkey" FOREIGN KEY ("rfpId") REFERENCES "Rfp"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_budgetLineId_fkey" FOREIGN KEY ("budgetLineId") REFERENCES "BudgetLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Counts are whole and not negative; money is integer cents.
ALTER TABLE "Registration" ADD CONSTRAINT "Registration_check" CHECK ("registered" >= 0 AND "capacity" >= 0);
ALTER TABLE "RfpItem" ADD CONSTRAINT "RfpItem_quantity_check" CHECK (("basis" = 'each') = ("quantity" IS NOT NULL) AND ("quantity" IS NULL OR "quantity" >= 1));
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_baseCents_check" CHECK ("baseCents" >= 0);
-- An extra-cost line carries its unit price; nothing else does.
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_check" CHECK (("inclusion" = 'extra') = ("unitCents" IS NOT NULL) AND ("unitCents" IS NULL OR "unitCents" > 0));
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_check" CHECK ("committedCents" >= 0 AND "headcount" >= 0);
