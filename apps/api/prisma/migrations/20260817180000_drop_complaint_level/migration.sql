ALTER TABLE "tickets" DROP COLUMN IF EXISTS "complaintLevel";
ALTER TABLE "sla_policies" DROP COLUMN IF EXISTS "complaintLevel";

-- 存量角色必填集里的「投诉等级」必填由「时效策略」承接：键改名 + 去重，
-- 保留首次出现顺序（必填缺失报错文案按数组序出字段名）
UPDATE "roles"
SET "requiredTicketFields" = (
    SELECT COALESCE(array_agg(v ORDER BY first_ord), '{}')
    FROM (
        SELECT v, MIN(ord) AS first_ord
        FROM unnest(array_replace("requiredTicketFields", 'complaintLevel', 'slaPolicyId'))
            WITH ORDINALITY AS u(v, ord)
        GROUP BY v
    ) dedup
)
WHERE 'complaintLevel' = ANY("requiredTicketFields");
