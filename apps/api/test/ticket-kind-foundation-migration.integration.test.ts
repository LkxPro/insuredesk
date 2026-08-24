import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client.ts";
import { type IntegrationHarness, startIntegrationHarness } from "./integration-harness.ts";

describe("ticket_kind_foundation migration (Testcontainers)", () => {
  let harness: IntegrationHarness;
  let prisma: PrismaClient;
  let migrationSql: string;

  beforeAll(async () => {
    harness = await startIntegrationHarness({ seed: ["slaPolicies"] });
    prisma = harness.prisma;
    migrationSql = readFileSync(
      fileURLToPath(
        new URL(
          "../prisma/migrations/20260825000000_ticket_kind_foundation/migration.sql",
          import.meta.url,
        ),
      ),
      "utf8",
    );
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  });

  async function createTicketRow(source = "manual") {
    const complaint = await prisma.ticketKind.findUniqueOrThrow({
      where: { key: "complaint" },
    });
    return prisma.ticket.create({
      data: { source, kindId: complaint.id, slaAnchorAt: new Date() },
    });
  }

  it("迁移后 ticket_kinds 含 complaint/refund_exception 两行（全启用、声明序）", async () => {
    const rows = await prisma.ticketKind.findMany({ orderBy: { displayOrder: "asc" } });
    expect(rows.map((row) => [row.key, row.name, row.active, row.displayOrder])).toEqual([
      ["complaint", "投诉", true, 1],
      ["refund_exception", "退费异常", true, 2],
    ]);
  });

  it("存量工单回填 kindId=complaint、slaAnchorAt=createdAt；存量四条策略归投诉组；重放幂等", async () => {
    const complaint = await prisma.ticketKind.findUniqueOrThrow({
      where: { key: "complaint" },
    });

    // 造回「迁移前」形态，否则 backfill 的 WHERE 空转
    await prisma.$executeRawUnsafe(`ALTER TABLE "tickets" ALTER COLUMN "kindId" DROP NOT NULL`);
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "tickets" ALTER COLUMN "slaAnchorAt" DROP NOT NULL`,
    );
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "sla_policies" ALTER COLUMN "kindId" DROP NOT NULL`,
    );
    await prisma.$executeRawUnsafe(`UPDATE "sla_policies" SET "kindId" = NULL`);

    const createdAt = new Date("2026-06-01T08:00:00.000Z");
    const [{ id: legacyTicketId }] = await prisma.$queryRaw<[{ id: string }]>`
      INSERT INTO "tickets" ("id", "source", "status", "createdAt", "updatedAt")
      VALUES (gen_random_uuid()::text, 'manual', 'completed', ${createdAt}, CURRENT_TIMESTAMP)
      RETURNING "id"
    `;

    await prisma.$executeRawUnsafe(migrationSql);

    const backfilled = await prisma.ticket.findUniqueOrThrow({ where: { id: legacyTicketId } });
    expect(backfilled.kindId).toBe(complaint.id);
    expect(backfilled.slaAnchorAt.toISOString()).toBe(createdAt.toISOString());

    const policies = await prisma.slaPolicy.findMany();
    expect(policies).toHaveLength(4);
    for (const policy of policies) {
      expect(policy.kindId).toBe(complaint.id);
    }

    await prisma.$executeRawUnsafe(migrationSql);
    expect(await prisma.ticketKind.count()).toBe(2);
    const after = await prisma.ticket.findUniqueOrThrow({ where: { id: legacyTicketId } });
    expect(after.kindId).toBe(complaint.id);
    expect(after.slaAnchorAt.toISOString()).toBe(createdAt.toISOString());
  });

  it("ticket_refund_details 的 (platform, endorNo) 联合唯一：同键拒绝，跨平台同 endorNo 放行", async () => {
    const first = await createTicketRow("jb-insurance");
    const second = await createTicketRow("jb-insurance");
    const base = {
      sysOrderId: "SYS-1",
      workOrderType: "卡异常-退费失败",
      expectedAmount: "100.00",
      refundCreateTime: new Date("2026-08-18T08:40:00.000Z"),
      refundTrades: [{ tradeNo: "1", payNo: "PAY-1", expectedAmount: "100.00" }],
    };
    await prisma.ticketRefundDetail.create({
      data: { ...base, ticketId: first.id, platform: "jb-insurance", endorNo: "ENDOR-1" },
    });

    await expect(
      prisma.ticketRefundDetail.create({
        data: { ...base, ticketId: second.id, platform: "jb-insurance", endorNo: "ENDOR-1" },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.ticketRefundDetail.create({
        data: { ...base, ticketId: second.id, platform: "other-platform", endorNo: "ENDOR-1" },
      }),
    ).resolves.toMatchObject({ platform: "other-platform" });
  });

  it("callback_deliveries 落行默认 pending；删工单级联带走投递行", async () => {
    const ticket = await createTicketRow("jb-insurance");
    const row = await prisma.callbackDelivery.create({
      data: {
        ticketId: ticket.id,
        sysOrderId: "SYS-1",
        endorNo: "ENDOR-9",
        workOrderNumber: ticket.workOrderNumber,
        actualAmount: "100.00",
      },
    });
    expect(row.status).toBe("pending");
    expect(row.attempts).toBe(0);

    await prisma.ticket.delete({ where: { id: ticket.id } });
    expect(await prisma.callbackDelivery.findUnique({ where: { id: row.id } })).toBeNull();
  });
});
