
-- AlterTable
ALTER TABLE "CallRole" ADD COLUMN     "portalTokenHash" TEXT,
ADD COLUMN     "vendorId" TEXT;

-- CreateTable
CREATE TABLE "CallSheetReceipt" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CallSheetReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoiSubmission" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "statedExpiresOn" DATE NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL,
    "docId" TEXT,

    CONSTRAINT "CoiSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CallSheetReceipt_issueId_key" ON "CallSheetReceipt"("issueId");

-- CreateIndex
CREATE UNIQUE INDEX "CoiSubmission_docId_key" ON "CoiSubmission"("docId");

-- CreateIndex
CREATE UNIQUE INDEX "CallRole_portalTokenHash_key" ON "CallRole"("portalTokenHash");

-- AddForeignKey
ALTER TABLE "CallRole" ADD CONSTRAINT "CallRole_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallSheetReceipt" ADD CONSTRAINT "CallSheetReceipt_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "CallSheetIssue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoiSubmission" ADD CONSTRAINT "CoiSubmission_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoiSubmission" ADD CONSTRAINT "CoiSubmission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "CallRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoiSubmission" ADD CONSTRAINT "CoiSubmission_docId_fkey" FOREIGN KEY ("docId") REFERENCES "ComplianceDoc"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A confirmation is a fact about an issue; it is never edited or withdrawn.
CREATE TRIGGER "CallSheetReceipt_append_only"
  BEFORE UPDATE OR DELETE ON "CallSheetReceipt"
  FOR EACH ROW EXECUTE FUNCTION refuse_mutation();

-- A submission is what the vendor sent (D-026). The one permitted change is
-- the accept: docId goes from null to the ComplianceDoc it became, once.
CREATE FUNCTION coi_submission_accept_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD."docId" IS NOT NULL OR NEW."docId" IS NULL
     OR (to_jsonb(NEW) - 'docId') <> (to_jsonb(OLD) - 'docId') THEN
    RAISE EXCEPTION 'CoiSubmission is append-only; the only change is accepting it once';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CoiSubmission_accept_only"
  BEFORE UPDATE OR DELETE ON "CoiSubmission"
  FOR EACH ROW EXECUTE FUNCTION coi_submission_accept_only();
