ALTER TABLE "sla_policies" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "sla_policies" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "sla_policies" ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "sla_policies" ADD COLUMN IF NOT EXISTS "active" BOOLEAN NOT NULL DEFAULT true;

-- 存量行 backfill：name = 原投诉等级文本，sortOrder 按 一般/高级/加急/特急（出厂序）
UPDATE "sla_policies" SET "name" = "complaintLevel" WHERE "name" IS NULL;
UPDATE "sla_policies"
SET "sortOrder" = CASE "complaintLevel"
    WHEN '一般投诉' THEN 1
    WHEN '高级投诉' THEN 2
    WHEN '加急投诉' THEN 3
    WHEN '特急投诉' THEN 4
    ELSE "sortOrder" + 4
END
WHERE "sortOrder" = 0;

ALTER TABLE "sla_policies" ALTER COLUMN "name" SET NOT NULL;
ALTER TABLE "sla_policies" ALTER COLUMN "complaintLevel" DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "sla_policies_name_key" ON "sla_policies"("name");

-- Ticket.slaPolicyId 引用（Restrict：被引用策略只能停用）
ALTER TABLE "tickets" ADD COLUMN IF NOT EXISTS "slaPolicyId" TEXT;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'tickets_slaPolicyId_fkey' AND conrelid = 'tickets'::regclass
    ) THEN
        ALTER TABLE "tickets"
            ADD CONSTRAINT "tickets_slaPolicyId_fkey"
            FOREIGN KEY ("slaPolicyId") REFERENCES "sla_policies"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS "tickets_slaPolicyId_idx" ON "tickets"("slaPolicyId");

-- 存量工单按投诉等级文本映射到策略 id；未定级(null)保持 null
UPDATE "tickets" t
SET "slaPolicyId" = p."id"
FROM "sla_policies" p
WHERE t."complaintLevel" IS NOT NULL
  AND t."complaintLevel" = p."complaintLevel"
  AND t."slaPolicyId" IS NULL;
