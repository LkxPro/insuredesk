import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client.ts";
import { type IntegrationHarness, startIntegrationHarness } from "./integration-harness.ts";

/**
 * 对着 migration.sql 原文跑（而非复刻一份 SQL）：已迁移的库上重放必须幂等
 * 无错；把工单的 slaPolicyId 清空后重放，回填按投诉等级文本映射回策略 id，
 * 未定级(null)工单保持 null。
 */
describe("sla_policy_entity migration (Testcontainers)", () => {
  let harness: IntegrationHarness;
  let prisma: PrismaClient;
  let migrationSql: string;

  beforeAll(async () => {
    harness = await startIntegrationHarness({ seed: ["slaPolicies"] });
    prisma = harness.prisma;
    migrationSql = readFileSync(
      fileURLToPath(
        new URL(
          "../prisma/migrations/20260817120000_sla_policy_entity/migration.sql",
          import.meta.url,
        ),
      ),
      "utf8",
    );
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  });

  it("重放幂等；工单文本→策略 id 回填可重复执行且不动未定级行", async () => {
    const urgent = await prisma.slaPolicy.findUniqueOrThrow({
      where: { complaintLevel: "特急投诉" },
    });
    await prisma.ticket.createMany({
      data: [
        { source: "manual", status: "unassigned", complaintLevel: "特急投诉" },
        { source: "manual", status: "unassigned", complaintLevel: null },
      ],
    });

    // 已迁移库上整段重放：IF NOT EXISTS / 守卫全空转，不报错、不改数
    await prisma.$executeRawUnsafe(migrationSql);

    const policyRows = await prisma.slaPolicy.findMany({ orderBy: { sortOrder: "asc" } });
    expect(policyRows.map((row) => [row.name, row.sortOrder, row.active])).toEqual([
      ["一般投诉", 1, true],
      ["高级投诉", 2, true],
      ["加急投诉", 3, true],
      ["特急投诉", 4, true],
    ]);

    // 模拟回填遗漏（等效于迁移前插入的行）：清空引用后重放补回
    await prisma.ticket.updateMany({ data: { slaPolicyId: null } });
    await prisma.$executeRawUnsafe(migrationSql);

    const leveled = await prisma.ticket.findFirstOrThrow({
      where: { complaintLevel: "特急投诉" },
    });
    expect(leveled.slaPolicyId).toBe(urgent.id);
    const unlabeled = await prisma.ticket.findFirstOrThrow({
      where: { complaintLevel: null },
    });
    expect(unlabeled.slaPolicyId).toBeNull();
  });
});
