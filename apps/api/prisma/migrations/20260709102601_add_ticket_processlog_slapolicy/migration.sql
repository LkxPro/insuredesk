-- CreateSequence (hand-written: Prisma cannot express standalone sequences)
-- Global work-order-number sequence (PRD §9.3): native Postgres SEQUENCE is
-- concurrency-safe by construction; gaps are acceptable. Starts at 100001 so
-- numbers are 6+ digits from day one (WO100001).
CREATE SEQUENCE "work_order_number_seq" START WITH 100001;

-- CreateTable
CREATE TABLE "tickets" (
    "id" TEXT NOT NULL,
    "workOrderNumber" TEXT NOT NULL DEFAULT ('WO' || lpad((nextval('work_order_number_seq'))::text, 6, '0')),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "feedbackTime" TIMESTAMPTZ NOT NULL,
    "source" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "project" TEXT NOT NULL,
    "brokerageEntity" TEXT NOT NULL,
    "paymentChannel" TEXT NOT NULL,
    "internalOrderNumber" TEXT,
    "policyNumber" TEXT NOT NULL,
    "userComplaintChannel" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "contactPhone" TEXT,
    "customerRequest" TEXT NOT NULL,
    "nuclearBodyStatus" TEXT NOT NULL,
    "hasContacted" BOOLEAN NOT NULL,
    "contactId" TEXT,
    "category" TEXT NOT NULL,
    "complaintLevel" TEXT NOT NULL,
    "priority" TEXT,
    "followUpFrequency" TEXT NOT NULL,
    "firstResponseRequirement" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'unassigned',
    "assigneeId" TEXT,
    "assignedAt" TIMESTAMPTZ,
    "dueAt" TIMESTAMPTZ,
    "nextContactTime" TIMESTAMPTZ,
    "contactCount" INTEGER NOT NULL DEFAULT 0,
    "processingResult" TEXT NOT NULL DEFAULT '',
    "completionTime" TIMESTAMPTZ,
    "completionStatus" TEXT,
    "deletedAt" TIMESTAMPTZ,
    "creatorId" TEXT,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "process_logs" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "operatorName" TEXT,
    "operatorAvatar" TEXT,
    "action" TEXT NOT NULL,
    "from" TEXT,
    "to" TEXT,
    "remark" TEXT NOT NULL,
    "at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "process_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sla_policies" (
    "id" TEXT NOT NULL,
    "complaintLevel" TEXT NOT NULL,
    "firstResponseMinutes" INTEGER NOT NULL,
    "overdueHours" INTEGER,
    "reminderRules" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sla_policies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tickets_workOrderNumber_key" ON "tickets"("workOrderNumber");

-- CreateIndex
CREATE INDEX "tickets_assigneeId_idx" ON "tickets"("assigneeId");

-- CreateIndex
CREATE INDEX "tickets_status_idx" ON "tickets"("status");

-- CreateIndex
CREATE INDEX "tickets_createdAt_idx" ON "tickets"("createdAt");

-- CreateIndex
CREATE INDEX "tickets_deletedAt_idx" ON "tickets"("deletedAt");

-- CreateIndex
CREATE INDEX "process_logs_ticketId_at_idx" ON "process_logs"("ticketId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "sla_policies_complaintLevel_key" ON "sla_policies"("complaintLevel");

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "process_logs" ADD CONSTRAINT "process_logs_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
