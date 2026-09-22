-- CreateEnum
CREATE TYPE "DeliverableKind" AS ENUM ('deck', 'headshot', 'logo', 'banner', 'booth_info', 'video');

-- CreateEnum
CREATE TYPE "RuleCheck" AS ENUM ('max_bytes', 'file_type', 'aspect_ratio', 'fonts_embedded', 'min_pixels', 'codec_allowlist', 'manual');

-- CreateEnum
CREATE TYPE "ValidationOutcome" AS ENUM ('passed', 'needs_review', 'failed');

-- CreateEnum
CREATE TYPE "CommentSide" AS ENUM ('producer', 'submitter');

-- AlterTable
ALTER TABLE "Speaker" ADD COLUMN     "portalTokenHash" TEXT;

-- CreateTable
CREATE TABLE "Sponsor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "portalTokenHash" TEXT,

    CONSTRAINT "Sponsor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deliverable" (
    "id" TEXT NOT NULL,
    "kind" "DeliverableKind" NOT NULL,
    "label" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "speakerId" TEXT,
    "sponsorId" TEXT,

    CONSTRAINT "Deliverable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentVersion" (
    "id" TEXT NOT NULL,
    "deliverableId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "facts" JSONB NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ValidationRule" (
    "id" TEXT NOT NULL,
    "kind" "DeliverableKind" NOT NULL,
    "check" "RuleCheck" NOT NULL,
    "params" JSONB NOT NULL,
    "fix" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,

    CONSTRAINT "ValidationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ValidationRun" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "outcome" "ValidationOutcome" NOT NULL,
    "results" JSONB NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ValidationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VersionComment" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "side" "CommentSide" NOT NULL,
    "body" TEXT NOT NULL,
    "requestsChanges" BOOLEAN NOT NULL DEFAULT false,
    "at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VersionComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Sponsor_portalTokenHash_key" ON "Sponsor"("portalTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Sponsor_eventId_name_key" ON "Sponsor"("eventId", "name");

-- CreateIndex
CREATE INDEX "Deliverable_eventId_idx" ON "Deliverable"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentVersion_deliverableId_number_key" ON "ContentVersion"("deliverableId", "number");

-- CreateIndex
CREATE INDEX "ValidationRule_eventId_kind_idx" ON "ValidationRule"("eventId", "kind");

-- CreateIndex
CREATE INDEX "ValidationRun_versionId_idx" ON "ValidationRun"("versionId");

-- CreateIndex
CREATE INDEX "VersionComment_versionId_idx" ON "VersionComment"("versionId");

-- CreateIndex
CREATE UNIQUE INDEX "Speaker_portalTokenHash_key" ON "Speaker"("portalTokenHash");

-- AddForeignKey
ALTER TABLE "Sponsor" ADD CONSTRAINT "Sponsor_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deliverable" ADD CONSTRAINT "Deliverable_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deliverable" ADD CONSTRAINT "Deliverable_speakerId_fkey" FOREIGN KEY ("speakerId") REFERENCES "Speaker"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deliverable" ADD CONSTRAINT "Deliverable_sponsorId_fkey" FOREIGN KEY ("sponsorId") REFERENCES "Sponsor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentVersion" ADD CONSTRAINT "ContentVersion_deliverableId_fkey" FOREIGN KEY ("deliverableId") REFERENCES "Deliverable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValidationRule" ADD CONSTRAINT "ValidationRule_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValidationRun" ADD CONSTRAINT "ValidationRun_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ContentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VersionComment" ADD CONSTRAINT "VersionComment_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ContentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A deliverable is owed by exactly one speaker or one sponsor.
ALTER TABLE "Deliverable" ADD CONSTRAINT "Deliverable_one_owner_check" CHECK (num_nonnulls("speakerId", "sponsorId") = 1);
ALTER TABLE "ContentVersion" ADD CONSTRAINT "ContentVersion_number_check" CHECK ("number" >= 1 AND "byteSize" >= 0);
ALTER TABLE "VersionComment" ADD CONSTRAINT "VersionComment_body_check" CHECK (btrim("body") <> '');

-- Every version, validation run and comment is kept exactly.
CREATE TRIGGER "ContentVersion_append_only"
  BEFORE UPDATE OR DELETE ON "ContentVersion"
  FOR EACH ROW EXECUTE FUNCTION refuse_mutation();
CREATE TRIGGER "ValidationRun_append_only"
  BEFORE UPDATE OR DELETE ON "ValidationRun"
  FOR EACH ROW EXECUTE FUNCTION refuse_mutation();
CREATE TRIGGER "VersionComment_append_only"
  BEFORE UPDATE OR DELETE ON "VersionComment"
  FOR EACH ROW EXECUTE FUNCTION refuse_mutation();
