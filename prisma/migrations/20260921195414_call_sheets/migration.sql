-- CreateTable
CREATE TABLE "CallRole" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "reportTo" TEXT NOT NULL DEFAULT '',
    "eventId" TEXT NOT NULL,

    CONSTRAINT "CallRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CueRole" (
    "cueId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "CueRole_pkey" PRIMARY KEY ("cueId","roleId")
);

-- CreateTable
CREATE TABLE "CallSheetIssue" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "agendaVersion" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "CallSheetIssue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CallRole_eventId_name_key" ON "CallRole"("eventId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "CallSheetIssue_roleId_number_key" ON "CallSheetIssue"("roleId", "number");

-- AddForeignKey
ALTER TABLE "CallRole" ADD CONSTRAINT "CallRole_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CueRole" ADD CONSTRAINT "CueRole_cueId_fkey" FOREIGN KEY ("cueId") REFERENCES "Cue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CueRole" ADD CONSTRAINT "CueRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "CallRole"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallSheetIssue" ADD CONSTRAINT "CallSheetIssue_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "CallRole"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- What a role was sent is kept exactly; the next issue diffs against it.
CREATE TRIGGER "CallSheetIssue_append_only"
  BEFORE UPDATE OR DELETE ON "CallSheetIssue"
  FOR EACH ROW EXECUTE FUNCTION refuse_mutation();
ALTER TABLE "CallSheetIssue" ADD CONSTRAINT "CallSheetIssue_number_check" CHECK ("number" >= 1 AND "agendaVersion" >= 1);
