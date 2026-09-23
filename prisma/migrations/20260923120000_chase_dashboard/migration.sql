-- CreateTable
CREATE TABLE "DeadlinePolicy" (
    "id" TEXT NOT NULL,
    "kind" "DeliverableKind" NOT NULL,
    "leadDays" INTEGER NOT NULL,
    "eventId" TEXT NOT NULL,

    CONSTRAINT "DeadlinePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reminder" (
    "id" TEXT NOT NULL,
    "deliverableId" TEXT NOT NULL,
    "step" INTEGER NOT NULL,
    "to" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeadlinePolicy_eventId_kind_key" ON "DeadlinePolicy"("eventId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "Reminder_deliverableId_step_key" ON "Reminder"("deliverableId", "step");

-- AddForeignKey
ALTER TABLE "DeadlinePolicy" ADD CONSTRAINT "DeadlinePolicy_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_deliverableId_fkey" FOREIGN KEY ("deliverableId") REFERENCES "Deliverable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- A lead time is days before the show, so it cannot be negative: a deliverable
-- due after its own call time is a policy mistake, not a deadline.
ALTER TABLE "DeadlinePolicy" ADD CONSTRAINT "DeadlinePolicy_lead_check" CHECK ("leadDays" >= 0);

-- The outbox is a log of what was sent; the unique key above is the cadence.
CREATE TRIGGER "Reminder_append_only"
  BEFORE UPDATE OR DELETE ON "Reminder"
  FOR EACH ROW EXECUTE FUNCTION refuse_mutation();
