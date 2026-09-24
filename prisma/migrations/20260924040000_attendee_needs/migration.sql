-- CreateEnum
CREATE TYPE "NeedKind" AS ENUM ('dietary', 'access');

-- CreateTable
CREATE TABLE "Need" (
    "id" TEXT NOT NULL,
    "kind" "NeedKind" NOT NULL,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "Need_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attendee" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "attendeeType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,

    CONSTRAINT "Attendee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendeeNeed" (
    "attendeeId" TEXT NOT NULL,
    "needId" TEXT NOT NULL,

    CONSTRAINT "AttendeeNeed_pkey" PRIMARY KEY ("attendeeId","needId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Need_label_key" ON "Need"("label");

-- CreateIndex
CREATE UNIQUE INDEX "Attendee_eventId_email_key" ON "Attendee"("eventId", "email");

-- AddForeignKey
ALTER TABLE "Attendee" ADD CONSTRAINT "Attendee_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendee" ADD CONSTRAINT "Attendee_eventId_attendeeType_fkey" FOREIGN KEY ("eventId", "attendeeType") REFERENCES "Registration"("eventId", "attendeeType") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendeeNeed" ADD CONSTRAINT "AttendeeNeed_attendeeId_fkey" FOREIGN KEY ("attendeeId") REFERENCES "Attendee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendeeNeed" ADD CONSTRAINT "AttendeeNeed_needId_fkey" FOREIGN KEY ("needId") REFERENCES "Need"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Attendee" ADD CONSTRAINT "Attendee_named" CHECK (btrim("name") <> '' AND btrim("email") <> '');
ALTER TABLE "Need" ADD CONSTRAINT "Need_labelled" CHECK (btrim("label") <> '');
