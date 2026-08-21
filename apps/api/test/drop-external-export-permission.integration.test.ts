import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client.ts";
import { type IntegrationHarness, startIntegrationHarness } from "./integration-harness.ts";

describe("drop external export permission migration (Testcontainers)", () => {
  let harness: IntegrationHarness;
  let prisma: PrismaClient;
  let migrationSql: string;

  beforeAll(async () => {
    harness = await startIntegrationHarness({ traceId: "drop-external-export-migration" });
    prisma = harness.prisma;
    migrationSql = readFileSync(
      fileURLToPath(
        new URL(
          "../prisma/migrations/20260812000000_drop_external_export_permission/migration.sql",
          import.meta.url,
        ),
      ),
      "utf8",
    );
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  });

  it("摘掉所有角色权限数组里的死字符串，其余点原样留下", async () => {
    const external = await prisma.role.create({
      data: {
        name: "外部用户",
        permissions: [
          "ticket.create_external",
          "ticket.process_external",
          "ticket.export_external",
        ],
        system: false,
        requiredTicketFields: [],
      },
    });
    // 内部角色也可能被手工配上该点，摘除不按外部 marker 挑角色
    const internal = await prisma.role.create({
      data: {
        name: "内部误配",
        permissions: ["ticket.view", "ticket.export_external", "ticket.export"],
        system: false,
        requiredTicketFields: [],
      },
    });
    const clean = await prisma.role.create({
      data: {
        name: "只读观察",
        permissions: ["ticket.view"],
        system: false,
        requiredTicketFields: [],
      },
    });

    await prisma.$executeRawUnsafe(migrationSql);

    expect(
      (await prisma.role.findUniqueOrThrow({ where: { id: external.id } })).permissions,
    ).toEqual(["ticket.create_external", "ticket.process_external"]);
    expect(
      (await prisma.role.findUniqueOrThrow({ where: { id: internal.id } })).permissions,
    ).toEqual(["ticket.view", "ticket.export"]);
    expect((await prisma.role.findUniqueOrThrow({ where: { id: clean.id } })).permissions).toEqual([
      "ticket.view",
    ]);
  });
});
