BEGIN;

-- CreateTable
CREATE TABLE IF NOT EXISTS "api_keys" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "lastUsedAt" TIMESTAMPTZ,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "api_access_logs" (
    "id" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "ip" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "api_access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "api_keys_keyHash_key" ON "api_keys"("keyHash");
CREATE INDEX IF NOT EXISTS "api_keys_userId_idx" ON "api_keys"("userId");
CREATE INDEX IF NOT EXISTS "api_access_logs_keyId_at_idx" ON "api_access_logs"("keyId", "at");

-- 开放 API 全局增量流的游标索引：tickets 按 (updatedAt, id)、process_logs 按 (at, id) 翻页。
CREATE INDEX IF NOT EXISTS "tickets_updatedAt_id_idx" ON "tickets"("updatedAt", "id");
CREATE INDEX IF NOT EXISTS "process_logs_at_id_idx" ON "process_logs"("at", "id");

-- AddForeignKey
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'api_keys_userId_fkey' AND conrelid = 'api_keys'::regclass
    ) THEN
        ALTER TABLE "api_keys"
            ADD CONSTRAINT "api_keys_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "users"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'api_access_logs_keyId_fkey' AND conrelid = 'api_access_logs'::regclass
    ) THEN
        ALTER TABLE "api_access_logs"
            ADD CONSTRAINT "api_access_logs_keyId_fkey"
            FOREIGN KEY ("keyId") REFERENCES "api_keys"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

COMMIT;
