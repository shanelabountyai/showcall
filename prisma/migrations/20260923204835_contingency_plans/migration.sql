-- CreateTable
CREATE TABLE "ContingencyPlan" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "decideByCueId" TEXT NOT NULL,

    CONSTRAINT "ContingencyPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContingencyBranch" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "cueEdits" JSONB NOT NULL,
    "costDeltaCents" INTEGER NOT NULL DEFAULT 0,
    "costCategory" "BudgetCategory" NOT NULL DEFAULT 'other',
    "costVendorId" TEXT,
    "planId" TEXT NOT NULL,

    CONSTRAINT "ContingencyBranch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContingencyNotice" (
    "id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,

    CONSTRAINT "ContingencyNotice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContingencyDecision" (
    "id" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL,
    "planId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,

    CONSTRAINT "ContingencyDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContingencyEscalation" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "minute" INTEGER NOT NULL,
    "to" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContingencyEscalation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContingencyPlan_decideByCueId_key" ON "ContingencyPlan"("decideByCueId");

-- CreateIndex
CREATE UNIQUE INDEX "ContingencyPlan_eventId_title_key" ON "ContingencyPlan"("eventId", "title");

-- CreateIndex
CREATE UNIQUE INDEX "ContingencyBranch_planId_label_key" ON "ContingencyBranch"("planId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "ContingencyDecision_planId_key" ON "ContingencyDecision"("planId");

-- CreateIndex
CREATE UNIQUE INDEX "ContingencyEscalation_planId_day_minute_key" ON "ContingencyEscalation"("planId", "day", "minute");

-- AddForeignKey
ALTER TABLE "ContingencyPlan" ADD CONSTRAINT "ContingencyPlan_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContingencyPlan" ADD CONSTRAINT "ContingencyPlan_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContingencyPlan" ADD CONSTRAINT "ContingencyPlan_decideByCueId_fkey" FOREIGN KEY ("decideByCueId") REFERENCES "Cue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContingencyBranch" ADD CONSTRAINT "ContingencyBranch_costVendorId_fkey" FOREIGN KEY ("costVendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContingencyBranch" ADD CONSTRAINT "ContingencyBranch_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ContingencyPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContingencyNotice" ADD CONSTRAINT "ContingencyNotice_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "ContingencyBranch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContingencyNotice" ADD CONSTRAINT "ContingencyNotice_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContingencyDecision" ADD CONSTRAINT "ContingencyDecision_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ContingencyPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContingencyDecision" ADD CONSTRAINT "ContingencyDecision_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "ContingencyBranch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContingencyEscalation" ADD CONSTRAINT "ContingencyEscalation_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ContingencyPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Money is integer cents; a delta posts as a committed line, so it cannot be negative (D-022).
ALTER TABLE "ContingencyBranch" ADD CONSTRAINT "ContingencyBranch_cost_check" CHECK ("costDeltaCents" >= 0);
ALTER TABLE "ContingencyEscalation" ADD CONSTRAINT "ContingencyEscalation_minute_check" CHECK ("minute" >= 0 AND "minute" < 1440);

-- A decision takes a branch of its own plan, never another plan's.
ALTER TABLE "ContingencyBranch" ADD CONSTRAINT "ContingencyBranch_id_planId_key" UNIQUE ("id", "planId");
ALTER TABLE "ContingencyDecision" ADD CONSTRAINT "ContingencyDecision_branch_of_plan_fkey"
  FOREIGN KEY ("branchId", "planId") REFERENCES "ContingencyBranch"("id", "planId");

CREATE TRIGGER "ContingencyDecision_append_only"
  BEFORE UPDATE OR DELETE ON "ContingencyDecision"
  FOR EACH ROW EXECUTE FUNCTION refuse_mutation();
CREATE TRIGGER "ContingencyEscalation_append_only"
  BEFORE UPDATE OR DELETE ON "ContingencyEscalation"
  FOR EACH ROW EXECUTE FUNCTION refuse_mutation();
