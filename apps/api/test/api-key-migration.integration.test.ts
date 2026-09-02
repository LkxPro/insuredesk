import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client.ts";
import { type IntegrationHarness, startIntegrationHarness } from "./integration-harness.ts";

describe("open_api_keys migration (Testcontainers, real-migrations)", () => {
  let harness: IntegrationHarness;
  let prisma: PrismaClient;

  beforeAll(async () => {
    harness = await startIntegrationHarness({ mode: "real-migrations" });
    prisma = harness.prisma;
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  });

  it("api_keys / api_access_logs 列齐：keyHash 唯一、(keyId, at) 索引", async () => {
    const apiKeyColumns = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'api_keys' ORDER BY ordinal_position`,
    );
    // keyPreview 由后续迁移 ALTER 追加，序位置在 createdAt 之后
    expect(apiKeyColumns.map((c) => c.column_name)).toEqual([
      "id",
      "name",
      "keyHash",
      "userId",
      "expiresAt",
      "lastUsedAt",
      "status",
      "createdAt",
      "keyPreview",
    ]);

    const nullable = await prisma.$queryRawUnsafe<{ is_nullable: string }[]>(
      `SELECT is_nullable FROM information_schema.columns
       WHERE table_name = 'api_keys' AND column_name = 'expiresAt'`,
    );
    expect(nullable[0]?.is_nullable).toBe("YES");

    const logColumns = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'api_access_logs' ORDER BY ordinal_position`,
    );
    expect(logColumns.map((c) => c.column_name)).toEqual([
      "id",
      "keyId",
      "userId",
      "endpoint",
      "statusCode",
      "durationMs",
      "rowCount",
      "ip",
      "requestId",
      "at",
    ]);

    const indexes = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes
       WHERE tablename IN ('api_keys', 'api_access_logs', 'tickets', 'process_logs')`,
    );
    const names = indexes.map((row) => row.indexname);
    expect(names).toContain("api_keys_keyHash_key");
    expect(names).toContain("api_access_logs_keyId_at_idx");
    expect(names).toContain("tickets_updatedAt_id_idx");
    expect(names).toContain("process_logs_at_id_idx");
  });

  it("api_key_audit_logs：列齐、双索引、无任何外键（纯追加日志，不随对象级联抹除）", async () => {
    const columns = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'api_key_audit_logs' ORDER BY ordinal_position`,
    );
    expect(columns.map((c) => c.column_name)).toEqual([
      "id",
      "actorId",
      "action",
      "targetKeyId",
      "targetUserId",
      "keyName",
      "keyPreview",
      "requestId",
      "createdAt",
    ]);

    const fks = await prisma.$queryRawUnsafe<{ conname: string }[]>(
      `SELECT conname FROM pg_constraint
       WHERE conrelid = 'api_key_audit_logs'::regclass AND contype = 'f'`,
    );
    expect(fks).toEqual([]);

    const indexes = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'api_key_audit_logs'`,
    );
    const names = indexes.map((row) => row.indexname);
    expect(names).toContain("api_key_audit_logs_targetKeyId_createdAt_idx");
    expect(names).toContain("api_key_audit_logs_targetUserId_createdAt_idx");
  });

  it("keyHash 唯一索引执法：同哈希拒绝", async () => {
    const role = await prisma.role.create({
      data: { name: "r", permissions: [], system: false, requiredTicketFields: [] },
    });
    const user = await prisma.user.create({
      data: { username: "u", name: "u", roleId: role.id, active: true },
    });
    const data = {
      name: "k",
      keyHash: "deadbeef",
      keyPreview: "adbeef12",
      userId: user.id,
      expiresAt: new Date(Date.now() + 86_400_000),
    };
    await prisma.apiKey.create({ data });
    await expect(prisma.apiKey.create({ data: { ...data, name: "k2" } })).rejects.toThrow();
  });

  it("keyPreview 保留 DEFAULT ''：旧版代码不带 keyPreview 的裸 INSERT 仍落地（回滚兼容）", async () => {
    const defaults = await prisma.$queryRawUnsafe<{ column_default: string | null }[]>(
      `SELECT column_default FROM information_schema.columns
       WHERE table_name = 'api_keys' AND column_name = 'keyPreview'`,
    );
    expect(defaults[0]?.column_default).toBe("''::text");

    const role = await prisma.role.create({
      data: { name: "r-legacy", permissions: [], system: false, requiredTicketFields: [] },
    });
    const user = await prisma.user.create({
      data: { username: "u-legacy", name: "u-legacy", roleId: role.id, active: true },
    });
    await prisma.$executeRawUnsafe(
      `INSERT INTO api_keys (id, name, "keyHash", "userId") VALUES ($1, $2, $3, $4)`,
      "rollback-compat-key",
      "legacy",
      "cafebabe",
      user.id,
    );
    const row = await prisma.apiKey.findUniqueOrThrow({ where: { id: "rollback-compat-key" } });
    expect(row.keyPreview).toBe("");
  });

  it("增量游标复合索引被规划器采用（SET LOCAL enable_seqscan=off 防小表偏 seq scan）", async () => {
    const plans = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL enable_seqscan = off");
      const explain = (sql: string) => tx.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(sql);
      return {
        tickets: await explain(
          `EXPLAIN SELECT "id" FROM "tickets" ORDER BY "updatedAt", "id" LIMIT 50`,
        ),
        processLogs: await explain(
          `EXPLAIN SELECT "id" FROM "process_logs" ORDER BY "at", "id" LIMIT 50`,
        ),
      };
    });
    const flatten = (rows: { "QUERY PLAN": string }[]) =>
      rows.map((row) => row["QUERY PLAN"]).join("\n");
    expect(flatten(plans.tickets)).toContain("tickets_updatedAt_id_idx");
    expect(flatten(plans.processLogs)).toContain("process_logs_at_id_idx");
  });
});
