-- CreateEnum
CREATE TYPE "ComplianceKind" AS ENUM ('coi', 'w9');

-- CreateEnum
CREATE TYPE "BudgetCategory" AS ENUM ('venue', 'av', 'catering', 'decor', 'staffing', 'talent', 'travel', 'production', 'other');

-- CreateTable
CREATE TABLE "Vendor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceDoc" (
    "id" TEXT NOT NULL,
    "kind" "ComplianceKind" NOT NULL,
    "receivedOn" DATE NOT NULL,
    "expiresOn" DATE,
    "vendorId" TEXT NOT NULL,

    CONSTRAINT "ComplianceDoc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceReminder" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "kind" "ComplianceKind" NOT NULL,
    "dueOn" DATE NOT NULL,
    "step" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceReminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetLine" (
    "id" TEXT NOT NULL,
    "category" "BudgetCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "committedCents" INTEGER NOT NULL,
    "actualCents" INTEGER NOT NULL DEFAULT 0,
    "clientBillable" BOOLEAN NOT NULL DEFAULT true,
    "eventId" TEXT NOT NULL,
    "vendorId" TEXT,

    CONSTRAINT "BudgetLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetSnapshot" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL,
    "committedCents" INTEGER NOT NULL,
    "actualCents" INTEGER NOT NULL,
    "billableCents" INTEGER NOT NULL,
    "lines" JSONB NOT NULL,
    "eventId" TEXT NOT NULL,

    CONSTRAINT "BudgetSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_name_key" ON "Vendor"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceReminder_eventId_vendorId_kind_dueOn_step_key" ON "ComplianceReminder"("eventId", "vendorId", "kind", "dueOn", "step");

-- CreateIndex
CREATE INDEX "BudgetLine_eventId_idx" ON "BudgetLine"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetSnapshot_eventId_number_key" ON "BudgetSnapshot"("eventId", "number");

-- AddForeignKey
ALTER TABLE "ComplianceDoc" ADD CONSTRAINT "ComplianceDoc_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceReminder" ADD CONSTRAINT "ComplianceReminder_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceReminder" ADD CONSTRAINT "ComplianceReminder_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetLine" ADD CONSTRAINT "BudgetLine_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetLine" ADD CONSTRAINT "BudgetLine_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetSnapshot" ADD CONSTRAINT "BudgetSnapshot_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Money is integer cents and a budget line is never negative: a credit is its
-- own line, not a sign flip hiding in a total.
ALTER TABLE "BudgetLine" ADD CONSTRAINT "BudgetLine_cents_check" CHECK ("committedCents" >= 0 AND "actualCents" >= 0);
ALTER TABLE "BudgetSnapshot" ADD CONSTRAINT "BudgetSnapshot_number_check" CHECK ("number" >= 1);

-- A COI without an expiry is not a COI on file; a W-9 has none.
ALTER TABLE "ComplianceDoc" ADD CONSTRAINT "ComplianceDoc_expiry_check"
  CHECK (("kind" = 'coi') = ("expiresOn" IS NOT NULL) AND ("expiresOn" IS NULL OR "expiresOn" > "receivedOn"));

CREATE TRIGGER "BudgetSnapshot_append_only"
  BEFORE UPDATE OR DELETE ON "BudgetSnapshot"
  FOR EACH ROW EXECUTE FUNCTION refuse_mutation();
CREATE TRIGGER "ComplianceDoc_append_only"
  BEFORE UPDATE OR DELETE ON "ComplianceDoc"
  FOR EACH ROW EXECUTE FUNCTION refuse_mutation();
CREATE TRIGGER "ComplianceReminder_append_only"
  BEFORE UPDATE OR DELETE ON "ComplianceReminder"
  FOR EACH ROW EXECUTE FUNCTION refuse_mutation();
