CREATE TABLE "huifu_webhook_events" (
    "id" TEXT NOT NULL,
    "digest" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "complaintId" TEXT NOT NULL,
    "rawBody" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMPTZ NOT NULL,
    "lastError" TEXT,
    "receivedAt" TIMESTAMPTZ NOT NULL,
    "processedAt" TIMESTAMPTZ,
    CONSTRAINT "huifu_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "huifu_complaints" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "complaintId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "huifu_complaints_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "huifu_webhook_events_digest_key" ON "huifu_webhook_events"("digest");
CREATE INDEX "huifu_webhook_events_status_nextAttemptAt_idx" ON "huifu_webhook_events"("status", "nextAttemptAt");
CREATE UNIQUE INDEX "huifu_complaints_ticketId_key" ON "huifu_complaints"("ticketId");
CREATE UNIQUE INDEX "huifu_complaints_eventType_merchantId_complaintId_key" ON "huifu_complaints"("eventType", "merchantId", "complaintId");
ALTER TABLE "huifu_complaints" ADD CONSTRAINT "huifu_complaints_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
