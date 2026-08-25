-- CreateTable
CREATE TABLE IF NOT EXISTS "ticket_kinds" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "ticket_kinds_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ticket_kinds_key_key" ON "ticket_kinds"("key");
CREATE UNIQUE INDEX IF NOT EXISTS "ticket_kinds_name_key" ON "ticket_kinds"("name");

-- 行为绑定行（key 是代码契约）；bootstrap 亦按 key 缺失即插，两边互不惧重放
INSERT INTO "ticket_kinds" ("id", "key", "name", "displayOrder", "updatedAt")
VALUES
    (gen_random_uuid()::text, 'complaint', '投诉', 1, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'refund_exception', '退费异常', 2, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "kindId" TEXT;
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "slaAnchorAt" TIMESTAMPTZ;

UPDATE "tickets" t
SET "kindId" = k."id"
FROM "ticket_kinds" k
WHERE k."key" = 'complaint' AND t."kindId" IS NULL;

UPDATE "tickets" SET "slaAnchorAt" = "createdAt" WHERE "slaAnchorAt" IS NULL;

ALTER TABLE "tickets" ALTER COLUMN "kindId" SET NOT NULL;
ALTER TABLE "tickets" ALTER COLUMN "slaAnchorAt" SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'tickets_kindId_fkey' AND conrelid = 'tickets'::regclass
    ) THEN
        ALTER TABLE "tickets"
            ADD CONSTRAINT "tickets_kindId_fkey"
            FOREIGN KEY ("kindId") REFERENCES "ticket_kinds"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "tickets_kindId_idx" ON "tickets"("kindId");
CREATE INDEX IF NOT EXISTS "tickets_slaAnchorAt_idx" ON "tickets"("slaAnchorAt");

ALTER TABLE "sla_policies" ADD COLUMN IF NOT EXISTS "kindId" TEXT;

UPDATE "sla_policies" p
SET "kindId" = k."id"
FROM "ticket_kinds" k
WHERE k."key" = 'complaint' AND p."kindId" IS NULL;

ALTER TABLE "sla_policies" ALTER COLUMN "kindId" SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'sla_policies_kindId_fkey' AND conrelid = 'sla_policies'::regclass
    ) THEN
        ALTER TABLE "sla_policies"
            ADD CONSTRAINT "sla_policies_kindId_fkey"
            FOREIGN KEY ("kindId") REFERENCES "ticket_kinds"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS "sla_policies_kindId_idx" ON "sla_policies"("kindId");

-- CreateTable
CREATE TABLE IF NOT EXISTS "ticket_refund_details" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "endorNo" TEXT NOT NULL,
    "sysOrderId" TEXT NOT NULL,
    "workOrderType" TEXT NOT NULL,
    "expectedAmount" TEXT NOT NULL,
    "refundCreateTime" TIMESTAMPTZ NOT NULL,
    "refundTrades" JSONB NOT NULL,
    "holderName" TEXT,
    "holderPhone" TEXT,
    "companyName" TEXT,
    "productId" TEXT,
    "productName" TEXT,
    "policyNo" TEXT,
    "failureReason" TEXT,
    "compensationAmount" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "ticket_refund_details_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ticket_refund_details_ticketId_key" ON "ticket_refund_details"("ticketId");
CREATE UNIQUE INDEX IF NOT EXISTS "ticket_refund_details_platform_endorNo_key" ON "ticket_refund_details"("platform", "endorNo");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ticket_refund_details_ticketId_fkey' AND conrelid = 'ticket_refund_details'::regclass
    ) THEN
        ALTER TABLE "ticket_refund_details"
            ADD CONSTRAINT "ticket_refund_details_ticketId_fkey"
            FOREIGN KEY ("ticketId") REFERENCES "tickets"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "callback_deliveries" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sysOrderId" TEXT NOT NULL,
    "endorNo" TEXT NOT NULL,
    "workOrderNumber" TEXT NOT NULL,
    "actualAmount" TEXT NOT NULL,
    "compensationAmount" TEXT,
    "remark" TEXT,
    "operator" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "firstAttemptAt" TIMESTAMPTZ,
    "nextAttemptAt" TIMESTAMPTZ,
    "lastError" TEXT,
    "deliveredAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "callback_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "callback_deliveries_ticketId_idx" ON "callback_deliveries"("ticketId");
CREATE INDEX IF NOT EXISTS "callback_deliveries_status_nextAttemptAt_idx" ON "callback_deliveries"("status", "nextAttemptAt");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'callback_deliveries_ticketId_fkey' AND conrelid = 'callback_deliveries'::regclass
    ) THEN
        ALTER TABLE "callback_deliveries"
            ADD CONSTRAINT "callback_deliveries_ticketId_fkey"
            FOREIGN KEY ("ticketId") REFERENCES "tickets"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
