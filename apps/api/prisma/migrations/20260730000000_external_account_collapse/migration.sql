-- 机构层坍塌为外部账号单一层（issue #179）。数据步骤必须先于列/表删除：
-- 判定旧外部账号与机构工单都靠 externalOrgId 列。

-- AlterTable: users - 6 预填平列 + 可见字段白名单
ALTER TABLE "users"
ADD COLUMN     "prefillBrokerageEntity" TEXT,
ADD COLUMN     "prefillChannelId" TEXT,
ADD COLUMN     "prefillComplaintReceiveChannel" TEXT,
ADD COLUMN     "prefillPaymentChannel" TEXT,
ADD COLUMN     "prefillProject" TEXT,
ADD COLUMN     "prefillUserComplaintChannel" TEXT,
ADD COLUMN     "visibleTicketFields" TEXT;

-- 权限点改名：external_org.manage → external_account.manage
UPDATE "roles"
SET "permissions" = array_replace("permissions", 'external_org.manage', 'external_account.manage')
WHERE "permissions" @> ARRAY['external_org.manage'];

-- 删除旧外部账号：先断开其名下工单的 creatorId（FK 本身也是 SET NULL，
-- 显式写出让意图不依赖 FK 动作），再清掉挡 RESTRICT 的收件箱与排班
UPDATE "tickets" SET "creatorId" = NULL
WHERE "creatorId" IN (SELECT "id" FROM "users" WHERE "externalOrgId" IS NOT NULL);

DELETE FROM "app_notifications"
WHERE "targetUserId" IN (SELECT "id" FROM "users" WHERE "externalOrgId" IS NOT NULL);

DELETE FROM "schedules"
WHERE "userId" IN (SELECT "id" FROM "users" WHERE "externalOrgId" IS NOT NULL);

DELETE FROM "users" WHERE "externalOrgId" IS NOT NULL;

-- 机构工单软删（保留追溯，不进默认列表与统计）
UPDATE "tickets"
SET "deletedAt" = CURRENT_TIMESTAMP,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "externalOrgId" IS NOT NULL AND "deletedAt" IS NULL;

-- DropForeignKey
ALTER TABLE "external_orgs" DROP CONSTRAINT "external_orgs_channelId_fkey";

-- DropForeignKey
ALTER TABLE "tickets" DROP CONSTRAINT "tickets_externalOrgId_fkey";

-- DropForeignKey
ALTER TABLE "users" DROP CONSTRAINT "users_externalOrgId_fkey";

-- AlterTable
ALTER TABLE "tickets" DROP COLUMN "externalOrgId";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "externalOrgId";

-- DropTable
DROP TABLE "external_orgs";

-- CreateIndex
CREATE INDEX "users_prefillChannelId_idx" ON "users"("prefillChannelId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_prefillChannelId_fkey" FOREIGN KEY ("prefillChannelId") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
