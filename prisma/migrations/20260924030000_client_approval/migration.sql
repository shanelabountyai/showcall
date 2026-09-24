-- AlterTable
ALTER TABLE "BudgetSnapshot" ADD COLUMN     "forClient" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "clientTokenHash" TEXT;

-- CreateTable
CREATE TABLE "BudgetApproval" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "approved" BOOLEAN NOT NULL,
    "signedBy" TEXT NOT NULL,
    "note" TEXT,
    "decidedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BudgetApproval_snapshotId_key" ON "BudgetApproval"("snapshotId");

-- CreateIndex
CREATE UNIQUE INDEX "Event_clientTokenHash_key" ON "Event"("clientTokenHash");

-- AddForeignKey
ALTER TABLE "BudgetApproval" ADD CONSTRAINT "BudgetApproval_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "BudgetSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A client's answer is a fact about a snapshot; it is never edited or withdrawn.
CREATE TRIGGER "BudgetApproval_append_only"
  BEFORE UPDATE OR DELETE ON "BudgetApproval"
  FOR EACH ROW EXECUTE FUNCTION refuse_mutation();

ALTER TABLE "BudgetApproval" ADD CONSTRAINT "BudgetApproval_signed" CHECK (btrim("signedBy") <> '');
ALTER TABLE "BudgetApproval" ADD CONSTRAINT "BudgetApproval_decline_says_why" CHECK ("approved" OR btrim(coalesce("note", '')) <> '');
