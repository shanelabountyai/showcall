-- CreateTable
CREATE TABLE "CrewRules" (
    "eventId" TEXT NOT NULL,
    "overtimeAfterMin" INTEGER NOT NULL,
    "mealWithinMin" INTEGER NOT NULL,
    "mealBreakMin" INTEGER NOT NULL,
    "mealPenaltyCents" INTEGER NOT NULL,
    "mealPenaltyStepMin" INTEGER NOT NULL,

    CONSTRAINT "CrewRules_pkey" PRIMARY KEY ("eventId")
);

-- AddForeignKey
ALTER TABLE "CrewRules" ADD CONSTRAINT "CrewRules_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A zero step or limit would divide by zero or warn on every cue.
ALTER TABLE "CrewRules" ADD CONSTRAINT "CrewRules_positive" CHECK (
  "overtimeAfterMin" > 0 AND "mealWithinMin" > 0 AND "mealBreakMin" > 0 AND "mealPenaltyStepMin" > 0 AND "mealPenaltyCents" >= 0
);
