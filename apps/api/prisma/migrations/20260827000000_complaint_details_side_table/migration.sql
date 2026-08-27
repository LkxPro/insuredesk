BEGIN;

-- CreateTable
CREATE TABLE IF NOT EXISTS "ticket_complaint_details" (
    "ticketId" TEXT NOT NULL,
    "feedbackTime" TIMESTAMPTZ,
    "channelId" TEXT,
    "project" TEXT,
    "brokerageEntity" TEXT,
    "paymentChannel" TEXT,
    "internalOrderNumber" TEXT,
    "policyNumbers" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "noPolicyNumber" BOOLEAN NOT NULL DEFAULT false,
    "userFeedbackChannelId" TEXT,
    "feedbackReceiveChannelId" TEXT,
    "customerName" TEXT,
    "phone" TEXT,
    "customerRequest" TEXT,
    "nuclearBodyStatus" TEXT,
    "hasContacted" BOOLEAN,
    "contactTime" TIMESTAMPTZ,
    "contactId" TEXT,
    "categoryId" TEXT,
    "priority" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "ticket_complaint_details_pkey" PRIMARY KEY ("ticketId")
);

CREATE INDEX IF NOT EXISTS "ticket_complaint_details_channelId_idx" ON "ticket_complaint_details"("channelId");
CREATE INDEX IF NOT EXISTS "ticket_complaint_details_categoryId_idx" ON "ticket_complaint_details"("categoryId");
CREATE INDEX IF NOT EXISTS "ticket_complaint_details_userFeedbackChannelId_idx" ON "ticket_complaint_details"("userFeedbackChannelId");
CREATE INDEX IF NOT EXISTS "ticket_complaint_details_feedbackReceiveChannelId_idx" ON "ticket_complaint_details"("feedbackReceiveChannelId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ticket_complaint_details_ticketId_fkey' AND conrelid = 'ticket_complaint_details'::regclass
    ) THEN
        ALTER TABLE "ticket_complaint_details"
            ADD CONSTRAINT "ticket_complaint_details_ticketId_fkey"
            FOREIGN KEY ("ticketId") REFERENCES "tickets"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ticket_complaint_details_channelId_fkey' AND conrelid = 'ticket_complaint_details'::regclass
    ) THEN
        ALTER TABLE "ticket_complaint_details"
            ADD CONSTRAINT "ticket_complaint_details_channelId_fkey"
            FOREIGN KEY ("channelId") REFERENCES "channels"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ticket_complaint_details_categoryId_fkey' AND conrelid = 'ticket_complaint_details'::regclass
    ) THEN
        ALTER TABLE "ticket_complaint_details"
            ADD CONSTRAINT "ticket_complaint_details_categoryId_fkey"
            FOREIGN KEY ("categoryId") REFERENCES "ticket_categories"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ticket_complaint_details_userFeedbackChannelId_fkey' AND conrelid = 'ticket_complaint_details'::regclass
    ) THEN
        ALTER TABLE "ticket_complaint_details"
            ADD CONSTRAINT "ticket_complaint_details_userFeedbackChannelId_fkey"
            FOREIGN KEY ("userFeedbackChannelId") REFERENCES "user_feedback_channels"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'ticket_complaint_details_feedbackReceiveChannelId_fkey' AND conrelid = 'ticket_complaint_details'::regclass
    ) THEN
        ALTER TABLE "ticket_complaint_details"
            ADD CONSTRAINT "ticket_complaint_details_feedbackReceiveChannelId_fkey"
            FOREIGN KEY ("feedbackReceiveChannelId") REFERENCES "feedback_receive_channels"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;

-- 软删行也必须回填：回收站里的投诉单仍要展示投诉字段。
INSERT INTO "ticket_complaint_details" (
    "ticketId", "feedbackTime", "channelId", "project", "brokerageEntity",
    "paymentChannel", "internalOrderNumber", "policyNumbers", "noPolicyNumber",
    "userFeedbackChannelId", "feedbackReceiveChannelId", "customerName", "phone",
    "customerRequest", "nuclearBodyStatus", "hasContacted", "contactTime",
    "contactId", "categoryId", "priority", "createdAt", "updatedAt"
)
SELECT
    t."id", t."feedbackTime", t."channelId", t."project", t."brokerageEntity",
    t."paymentChannel", t."internalOrderNumber", t."policyNumbers", t."noPolicyNumber",
    t."userFeedbackChannelId", t."feedbackReceiveChannelId", t."customerName", t."phone",
    t."customerRequest", t."nuclearBodyStatus", t."hasContacted", t."contactTime",
    t."contactId", t."categoryId", t."priority", t."createdAt", t."updatedAt"
FROM "tickets" t
JOIN "ticket_kinds" k ON k."id" = t."kindId"
WHERE k."key" <> 'refund_exception'
ON CONFLICT ("ticketId") DO NOTHING;

COMMIT;
