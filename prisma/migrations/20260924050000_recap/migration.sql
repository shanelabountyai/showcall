-- AlterTable
ALTER TABLE "Attendee" ADD COLUMN     "recapTokenHash" TEXT;

-- CreateTable
CREATE TABLE "SessionRecording" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionRecording_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecapDownload" (
    "id" TEXT NOT NULL,
    "attendeeId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecapDownload_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SessionRecording_eventId_idx" ON "SessionRecording"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionRecording_sessionId_number_key" ON "SessionRecording"("sessionId", "number");

-- CreateIndex
CREATE INDEX "RecapDownload_attendeeId_idx" ON "RecapDownload"("attendeeId");

-- CreateIndex
CREATE UNIQUE INDEX "Attendee_recapTokenHash_key" ON "Attendee"("recapTokenHash");

-- AddForeignKey
ALTER TABLE "SessionRecording" ADD CONSTRAINT "SessionRecording_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecapDownload" ADD CONSTRAINT "RecapDownload_attendeeId_fkey" FOREIGN KEY ("attendeeId") REFERENCES "Attendee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A recording, once uploaded, is kept exactly; a replacement is a new number.
ALTER TABLE "SessionRecording" ADD CONSTRAINT "SessionRecording_number_check" CHECK ("number" >= 1);
CREATE TRIGGER "SessionRecording_append_only"
  BEFORE UPDATE OR DELETE ON "SessionRecording"
  FOR EACH ROW EXECUTE FUNCTION refuse_mutation();
