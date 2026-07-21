-- AlterTable
ALTER TABLE "tickets" ADD COLUMN "policyNumbers" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- 存量单值按空白拆分迁入新列；GROUP BY + min(ord) 在去空、去重（大小写敏感）
-- 的同时保留各值首次出现的顺序，纯空白值与 NULL 一样落为空数组。
UPDATE "tickets"
SET "policyNumbers" = COALESCE(
  (
    SELECT array_agg(part ORDER BY first_ord)
    FROM (
      SELECT part, min(ord) AS first_ord
      FROM regexp_split_to_table("tickets"."policyNumber", '\s+') WITH ORDINALITY AS split(part, ord)
      WHERE part <> ''
      GROUP BY part
    ) AS deduped
  ),
  ARRAY[]::TEXT[]
)
WHERE "policyNumber" IS NOT NULL;

-- AlterTable
ALTER TABLE "tickets" DROP COLUMN "policyNumber";

-- 角色必填字段集存的是字段 key，随字段改名同步替换，已配必填的角色不失效
UPDATE "roles"
SET "requiredTicketFields" = array_replace("requiredTicketFields", 'policyNumber', 'policyNumbers')
WHERE 'policyNumber' = ANY("requiredTicketFields");
