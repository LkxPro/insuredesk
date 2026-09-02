BEGIN;

-- 存量行无 preview 可回填（库内只存哈希，明文不可恢复）：默认空串落地。
-- DEFAULT '' 为滚动部署回滚兼容而保留：回滚窗口内旧版代码 INSERT 不提供
-- keyPreview，去掉默认值旧版写入即报错。
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "keyPreview" TEXT NOT NULL DEFAULT '';
ALTER TABLE "api_keys" ALTER COLUMN "expiresAt" DROP NOT NULL;

-- CreateTable
CREATE TABLE IF NOT EXISTS "api_key_audit_logs" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetKeyId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "keyName" TEXT NOT NULL,
    "keyPreview" TEXT NOT NULL,
    "requestId" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_key_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "api_key_audit_logs_targetKeyId_createdAt_idx" ON "api_key_audit_logs"("targetKeyId", "createdAt");
CREATE INDEX IF NOT EXISTS "api_key_audit_logs_targetUserId_createdAt_idx" ON "api_key_audit_logs"("targetUserId", "createdAt");

COMMIT;
