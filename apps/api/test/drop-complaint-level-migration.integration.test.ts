import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client.ts";
import { type IntegrationHarness, startIntegrationHarness } from "./integration-harness.ts";

describe("drop_complaint_level migration (Testcontainers)", () => {
  let harness: IntegrationHarness;
  let prisma: PrismaClient;
  let migrationSql: string;

  beforeAll(async () => {
    harness = await startIntegrationHarness();
    prisma = harness.prisma;
    migrationSql = readFileSync(
      fileURLToPath(
        new URL(
          "../prisma/migrations/20260817180000_drop_complaint_level/migration.sql",
          import.meta.url,
        ),
      ),
      "utf8",
    );
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  });

  it("tickets 与 sla_policies 均无 complaintLevel 列", async () => {
    const columns = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.columns
      WHERE table_name IN ('tickets', 'sla_policies') AND column_name = 'complaintLevel'
    `;
    expect(columns).toEqual([]);
  });

  it("角色必填集键改写：complaintLevel → slaPolicyId（去重保序），重放幂等", async () => {
    const legacy = await prisma.role.create({
      data: {
        name: "存量必填角色",
        permissions: [],
        requiredTicketFields: ["customerName", "complaintLevel", "phone"],
      },
    });
    const alreadyBoth = await prisma.role.create({
      data: {
        name: "双键并存角色",
        permissions: [],
        requiredTicketFields: ["complaintLevel", "slaPolicyId", "phone"],
      },
    });
    const untouched = await prisma.role.create({
      data: { name: "无该键角色", permissions: [], requiredTicketFields: ["customerName"] },
    });

    await prisma.$executeRawUnsafe(migrationSql);

    expect(
      (await prisma.role.findUniqueOrThrow({ where: { id: legacy.id } })).requiredTicketFields,
    ).toEqual(["customerName", "slaPolicyId", "phone"]);
    expect(
      (await prisma.role.findUniqueOrThrow({ where: { id: alreadyBoth.id } })).requiredTicketFields,
    ).toEqual(["slaPolicyId", "phone"]);
    expect(
      (await prisma.role.findUniqueOrThrow({ where: { id: untouched.id } })).requiredTicketFields,
    ).toEqual(["customerName"]);

    await prisma.$executeRawUnsafe(migrationSql);
    expect(
      (await prisma.role.findUniqueOrThrow({ where: { id: legacy.id } })).requiredTicketFields,
    ).toEqual(["customerName", "slaPolicyId", "phone"]);
  });
});
