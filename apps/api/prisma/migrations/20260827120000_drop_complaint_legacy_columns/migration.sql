BEGIN;

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

-- 旧列是侧表之外的最后一份副本：DROP 前必须证明侧表已保真承接，否则丢数。
DO $$
DECLARE
    mismatches BIGINT;
BEGIN
    SELECT COUNT(*) INTO mismatches FROM (
        (
            SELECT t."id" FROM "tickets" t
            JOIN "ticket_kinds" k ON k."id" = t."kindId"
            WHERE k."key" <> 'refund_exception'
            EXCEPT
            SELECT d."ticketId" FROM "ticket_complaint_details" d
        )
        UNION ALL
        (
            SELECT d."ticketId" FROM "ticket_complaint_details" d
            EXCEPT
            SELECT t."id" FROM "tickets" t
            JOIN "ticket_kinds" k ON k."id" = t."kindId"
            WHERE k."key" <> 'refund_exception'
        )
    ) diff;
    IF mismatches > 0 THEN
        RAISE EXCEPTION 'ticket_complaint_details 与非退费工单行集不一致（% 行），放弃 DROP 并回滚', mismatches;
    END IF;

    SELECT COUNT(*) INTO mismatches
    FROM "tickets" t
    JOIN "ticket_kinds" k ON k."id" = t."kindId" AND k."key" <> 'refund_exception'
    JOIN "ticket_complaint_details" d ON d."ticketId" = t."id"
    WHERE NOT (
           d."feedbackTime" IS NOT DISTINCT FROM t."feedbackTime"
        AND d."channelId" IS NOT DISTINCT FROM t."channelId"
        AND d."project" IS NOT DISTINCT FROM t."project"
        AND d."brokerageEntity" IS NOT DISTINCT FROM t."brokerageEntity"
        AND d."paymentChannel" IS NOT DISTINCT FROM t."paymentChannel"
        AND d."internalOrderNumber" IS NOT DISTINCT FROM t."internalOrderNumber"
        AND d."policyNumbers" IS NOT DISTINCT FROM t."policyNumbers"
        AND d."noPolicyNumber" IS NOT DISTINCT FROM t."noPolicyNumber"
        AND d."userFeedbackChannelId" IS NOT DISTINCT FROM t."userFeedbackChannelId"
        AND d."feedbackReceiveChannelId" IS NOT DISTINCT FROM t."feedbackReceiveChannelId"
        AND d."customerName" IS NOT DISTINCT FROM t."customerName"
        AND d."phone" IS NOT DISTINCT FROM t."phone"
        AND d."customerRequest" IS NOT DISTINCT FROM t."customerRequest"
        AND d."nuclearBodyStatus" IS NOT DISTINCT FROM t."nuclearBodyStatus"
        AND d."hasContacted" IS NOT DISTINCT FROM t."hasContacted"
        AND d."contactTime" IS NOT DISTINCT FROM t."contactTime"
        AND d."contactId" IS NOT DISTINCT FROM t."contactId"
        AND d."categoryId" IS NOT DISTINCT FROM t."categoryId"
        AND d."priority" IS NOT DISTINCT FROM t."priority"
    );
    IF mismatches > 0 THEN
        RAISE EXCEPTION 'ticket_complaint_details 与 tickets 旧列逐列比对不一致（% 行），放弃 DROP 并回滚', mismatches;
    END IF;
END $$;

ALTER TABLE "tickets"
    DROP COLUMN IF EXISTS "feedbackTime",
    DROP COLUMN IF EXISTS "channelId",
    DROP COLUMN IF EXISTS "project",
    DROP COLUMN IF EXISTS "brokerageEntity",
    DROP COLUMN IF EXISTS "paymentChannel",
    DROP COLUMN IF EXISTS "internalOrderNumber",
    DROP COLUMN IF EXISTS "policyNumbers",
    DROP COLUMN IF EXISTS "noPolicyNumber",
    DROP COLUMN IF EXISTS "userFeedbackChannelId",
    DROP COLUMN IF EXISTS "feedbackReceiveChannelId",
    DROP COLUMN IF EXISTS "customerName",
    DROP COLUMN IF EXISTS "phone",
    DROP COLUMN IF EXISTS "customerRequest",
    DROP COLUMN IF EXISTS "nuclearBodyStatus",
    DROP COLUMN IF EXISTS "hasContacted",
    DROP COLUMN IF EXISTS "contactTime",
    DROP COLUMN IF EXISTS "contactId",
    DROP COLUMN IF EXISTS "categoryId",
    DROP COLUMN IF EXISTS "priority";

COMMIT;
