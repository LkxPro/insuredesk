-- The 完结状态 catalog has NO application-layer seed; the inserts below are
-- its source of truth.

-- CreateTable
CREATE TABLE "completion_statuses" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "completion_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "completion_statuses_name_key" ON "completion_statuses"("name");

-- Display order = the historical enum's declaration order
INSERT INTO "completion_statuses" ("id", "name", "displayOrder", "updatedAt") VALUES
    (gen_random_uuid()::text, '未取得有效联系', 1, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '已达成一致', 2, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '诉求过高，无法达成一致', 3, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '客户自行撤诉', 4, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '已协商解决', 5, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '已赔付', 6, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '已退保', 7, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '转其他部门处理', 8, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '无效工单', 9, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '正常完结', 10, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '冷处理', 11, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, '联系不上', 12, CURRENT_TIMESTAMP);

-- 兜底: any stored value outside the enum becomes a catalog row too, so the
-- name-based backfill below can never orphan a ticket (soft-deleted included).
-- Born 停用: 存量工单 keep displaying the name through the relation, but the
-- resolve dropdown (启用项 only) never offers legacy garbage. '' is excluded —
-- unfilled means NULL, never '' — so those rows fall to NULL in the backfill.
INSERT INTO "completion_statuses" ("id", "name", "active", "displayOrder", "updatedAt")
SELECT gen_random_uuid()::text, dirty."completionStatus", false, 100, CURRENT_TIMESTAMP
FROM (
    SELECT DISTINCT "completionStatus"
    FROM "tickets"
    WHERE "completionStatus" IS NOT NULL AND "completionStatus" <> ''
) AS dirty
ON CONFLICT ("name") DO NOTHING;

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "completionStatusId" TEXT;

-- Backfill the FK by name
UPDATE "tickets"
SET "completionStatusId" = cs."id"
FROM "completion_statuses" cs
WHERE "tickets"."completionStatus" = cs."name";

-- CreateIndex
CREATE INDEX "tickets_completionStatusId_idx" ON "tickets"("completionStatusId");

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_completionStatusId_fkey" FOREIGN KEY ("completionStatusId") REFERENCES "completion_statuses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "tickets" DROP COLUMN "completionStatus";
