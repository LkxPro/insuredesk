-- AlterTable
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "noPolicyNumber" BOOLEAN NOT NULL DEFAULT false;

-- 历史"伪无"值：客服曾以 无/无保单信息/0 充当"没有保单号"
UPDATE "tickets"
SET "noPolicyNumber" = true,
    "policyNumbers" = ARRAY[]::TEXT[]
WHERE cardinality("policyNumbers") > 0
  AND NOT EXISTS (
    SELECT 1
    FROM unnest("policyNumbers") AS e
    WHERE e NOT IN ('无', '无保单信息', '0')
  );
