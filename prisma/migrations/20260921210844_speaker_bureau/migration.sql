-- CreateEnum
CREATE TYPE "SpeakerState" AS ENUM ('invited', 'confirmed', 'contracted', 'content_complete', 'rehearsed', 'showed', 'released');

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "isRehearsal" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Speaker" ADD COLUMN     "avNeeds" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "bio" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "consentDistributeDeck" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "consentPublishVideo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "consentRecordSession" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "consentRecordedAt" TIMESTAMP(3),
ADD COLUMN     "contractSignedAt" TIMESTAMP(3),
ADD COLUMN     "headshotUrl" TEXT,
ADD COLUMN     "honorariumCents" INTEGER,
ADD COLUMN     "state" "SpeakerState" NOT NULL DEFAULT 'invited';

-- CreateTable
CREATE TABLE "SpeakerTransition" (
    "id" TEXT NOT NULL,
    "speakerId" TEXT NOT NULL,
    "from" "SpeakerState" NOT NULL,
    "to" "SpeakerState" NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpeakerTransition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SpeakerTransition_speakerId_idx" ON "SpeakerTransition"("speakerId");

-- AddForeignKey
ALTER TABLE "SpeakerTransition" ADD CONSTRAINT "SpeakerTransition_speakerId_fkey" FOREIGN KEY ("speakerId") REFERENCES "Speaker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Every lifecycle move is kept exactly, including a producer's correction back.
CREATE TRIGGER "SpeakerTransition_append_only"
  BEFORE UPDATE OR DELETE ON "SpeakerTransition"
  FOR EACH ROW EXECUTE FUNCTION refuse_mutation();
ALTER TABLE "SpeakerTransition" ADD CONSTRAINT "SpeakerTransition_from_to_check" CHECK ("from" <> "to");
ALTER TABLE "Speaker" ADD CONSTRAINT "Speaker_honorarium_check" CHECK ("honorariumCents" IS NULL OR "honorariumCents" >= 0);
