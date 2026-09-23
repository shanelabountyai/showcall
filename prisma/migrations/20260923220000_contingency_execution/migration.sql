-- The decision log (D-023): what the cascade committed, and the cost line it posted.
-- The table is append-only and empty until now, so the NOT NULL needs no backfill.
ALTER TABLE "ContingencyDecision" ADD COLUMN "budgetLineId" TEXT,
ADD COLUMN "moved" JSONB NOT NULL;

CREATE UNIQUE INDEX "ContingencyDecision_budgetLineId_key" ON "ContingencyDecision"("budgetLineId");

ALTER TABLE "ContingencyDecision" ADD CONSTRAINT "ContingencyDecision_budgetLineId_fkey" FOREIGN KEY ("budgetLineId") REFERENCES "BudgetLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
