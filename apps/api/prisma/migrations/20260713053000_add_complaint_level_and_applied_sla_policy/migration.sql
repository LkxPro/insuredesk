-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "appliedSlaPolicy" JSONB,
ADD COLUMN     "complaintLevelId" TEXT,
ADD COLUMN     "deadlineWarningAt" TIMESTAMPTZ;

-- CreateTable
CREATE TABLE "complaint_levels" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL,
    "policyRevision" INTEGER NOT NULL DEFAULT 1,
    "policy" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "complaint_levels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "complaint_levels_name_key" ON "complaint_levels"("name");

-- CreateIndex
CREATE INDEX "complaint_levels_enabled_sortOrder_idx" ON "complaint_levels"("enabled", "sortOrder");

-- CreateIndex
CREATE INDEX "tickets_deadlineWarningAt_idx" ON "tickets"("deadlineWarningAt");

-- CreateIndex
CREATE INDEX "tickets_complaintLevelId_idx" ON "tickets"("complaintLevelId");

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_complaintLevelId_fkey" FOREIGN KEY ("complaintLevelId") REFERENCES "complaint_levels"("id") ON DELETE SET NULL ON UPDATE CASCADE;
