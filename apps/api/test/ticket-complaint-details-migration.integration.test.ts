import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client.ts";
import { type IntegrationHarness, startIntegrationHarness } from "./integration-harness.ts";

const LEGACY_COLUMNS = [
  "feedbackTime",
  "channelId",
  "project",
  "brokerageEntity",
  "paymentChannel",
  "internalOrderNumber",
  "policyNumbers",
  "noPolicyNumber",
  "userFeedbackChannelId",
  "feedbackReceiveChannelId",
  "customerName",
  "phone",
  "customerRequest",
  "nuclearBodyStatus",
  "hasContacted",
  "contactTime",
  "contactId",
  "categoryId",
  "priority",
] as const;

describe("drop_complaint_legacy_columns migration (Testcontainers)", () => {
  let harness: IntegrationHarness;
  let prisma: PrismaClient;
  let migrationSql: string;
  let complaintKindId: string;
  let refundKindId: string;
  let thirdKindId: string;

  beforeAll(async () => {
    harness = await startIntegrationHarness({ seed: ["channels", "categories"] });
    prisma = harness.prisma;
    migrationSql = readFileSync(
      fileURLToPath(
        new URL(
          "../prisma/migrations/20260827120000_drop_complaint_legacy_columns/migration.sql",
          import.meta.url,
        ),
      ),
      "utf8",
    );
    complaintKindId = (await prisma.ticketKind.findUniqueOrThrow({ where: { key: "complaint" } }))
      .id;
    refundKindId = (
      await prisma.ticketKind.findUniqueOrThrow({ where: { key: "refund_exception" } })
    ).id;
    thirdKindId = (
      await prisma.ticketKind.create({ data: { key: "custom_third", name: "自定义第三种类" } })
    ).id;
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  });

  // template 库已全量迁移（旧列不存在）：补回旧列模拟迁移前状态。
  beforeEach(async () => {
    await prisma.ticket.deleteMany();
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "tickets"
        ADD COLUMN IF NOT EXISTS "feedbackTime" TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS "channelId" TEXT,
        ADD COLUMN IF NOT EXISTS "project" TEXT,
        ADD COLUMN IF NOT EXISTS "brokerageEntity" TEXT,
        ADD COLUMN IF NOT EXISTS "paymentChannel" TEXT,
        ADD COLUMN IF NOT EXISTS "internalOrderNumber" TEXT,
        ADD COLUMN IF NOT EXISTS "policyNumbers" TEXT[] DEFAULT ARRAY[]::TEXT[],
        ADD COLUMN IF NOT EXISTS "noPolicyNumber" BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "userFeedbackChannelId" TEXT,
        ADD COLUMN IF NOT EXISTS "feedbackReceiveChannelId" TEXT,
        ADD COLUMN IF NOT EXISTS "customerName" TEXT,
        ADD COLUMN IF NOT EXISTS "phone" TEXT,
        ADD COLUMN IF NOT EXISTS "customerRequest" TEXT,
        ADD COLUMN IF NOT EXISTS "nuclearBodyStatus" TEXT,
        ADD COLUMN IF NOT EXISTS "hasContacted" BOOLEAN,
        ADD COLUMN IF NOT EXISTS "contactTime" TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS "contactId" TEXT,
        ADD COLUMN IF NOT EXISTS "categoryId" TEXT,
        ADD COLUMN IF NOT EXISTS "priority" TEXT
    `);
  });

  async function legacyTicket(kindId: string, opts: { deleted?: boolean } = {}) {
    const ticket = await prisma.ticket.create({
      data: {
        source: "manual",
        kindId,
        slaAnchorAt: new Date("2026-08-01T00:00:00.000Z"),
        status: "unassigned",
        deletedAt: opts.deleted ? new Date("2026-08-10T00:00:00.000Z") : null,
      },
    });
    await prisma.$executeRaw`
      UPDATE "tickets" SET
        "feedbackTime" = '2026-08-02T03:04:05.000Z',
        "channelId" = ${harness.channelId("保司")},
        "project" = '融盛',
        "brokerageEntity" = '东方大地',
        "paymentChannel" = '连连支付',
        "internalOrderNumber" = 'SO-LEGACY',
        "policyNumbers" = ARRAY['P-1','P-2']::TEXT[],
        "noPolicyNumber" = false,
        "userFeedbackChannelId" = NULL,
        "feedbackReceiveChannelId" = NULL,
        "customerName" = '存量客户',
        "phone" = '13800000009',
        "customerRequest" = '存量诉求',
        "nuclearBodyStatus" = '待核实',
        "hasContacted" = true,
        "contactTime" = '2026-08-03T03:04:05.000Z',
        "contactId" = 'CALL-LEGACY',
        "categoryId" = ${harness.categoryId("理赔投诉")},
        "priority" = 'high'
      WHERE "id" = ${ticket.id}
    `;
    return ticket;
  }

  async function survivingLegacyColumns(): Promise<string[]> {
    const rows = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'tickets'
    `;
    return rows
      .map((row) => row.column_name)
      .filter((name) => (LEGACY_COLUMNS as readonly string[]).includes(name))
      .sort();
  }

  it("兜底回填覆盖全部非 refund_exception 行（含软删/第三种类/空白单），退费行不建 detail，DROP 后旧列不存在", async () => {
    const complaint = await legacyTicket(complaintKindId);
    const softDeleted = await legacyTicket(complaintKindId, { deleted: true });
    const thirdKind = await legacyTicket(thirdKindId);
    const refund = await legacyTicket(refundKindId);
    const blank = await prisma.ticket.create({
      data: {
        source: "manual",
        kindId: complaintKindId,
        slaAnchorAt: new Date("2026-08-01T00:00:00.000Z"),
        status: "unassigned",
      },
    });

    await prisma.$executeRawUnsafe(migrationSql);

    const detail = await prisma.ticketComplaintDetail.findUniqueOrThrow({
      where: { ticketId: complaint.id },
    });
    expect(detail).toMatchObject({
      feedbackTime: new Date("2026-08-02T03:04:05.000Z"),
      channelId: harness.channelId("保司"),
      project: "融盛",
      brokerageEntity: "东方大地",
      paymentChannel: "连连支付",
      internalOrderNumber: "SO-LEGACY",
      policyNumbers: ["P-1", "P-2"],
      noPolicyNumber: false,
      userFeedbackChannelId: null,
      feedbackReceiveChannelId: null,
      customerName: "存量客户",
      phone: "13800000009",
      customerRequest: "存量诉求",
      nuclearBodyStatus: "待核实",
      hasContacted: true,
      contactTime: new Date("2026-08-03T03:04:05.000Z"),
      contactId: "CALL-LEGACY",
      categoryId: harness.categoryId("理赔投诉"),
      priority: "high",
    });
    expect(
      await prisma.ticketComplaintDetail.findUnique({ where: { ticketId: softDeleted.id } }),
    ).not.toBeNull();
    expect(
      await prisma.ticketComplaintDetail.findUnique({ where: { ticketId: thirdKind.id } }),
    ).not.toBeNull();
    expect(
      (await prisma.ticketComplaintDetail.findUniqueOrThrow({ where: { ticketId: blank.id } }))
        .policyNumbers,
    ).toEqual([]);
    expect(
      await prisma.ticketComplaintDetail.findUnique({ where: { ticketId: refund.id } }),
    ).toBeNull();
    expect(await survivingLegacyColumns()).toEqual([]);
  });

  it("逐列值不一致：断言拦截且整体回滚，旧列与既有 detail 行原样保留", async () => {
    const ticket = await legacyTicket(complaintKindId);
    await prisma.ticketComplaintDetail.create({
      data: { ticketId: ticket.id, customerName: "编辑后的值" },
    });

    await expect(prisma.$executeRawUnsafe(migrationSql)).rejects.toThrow(/不一致/);

    expect(await survivingLegacyColumns()).toEqual([...LEGACY_COLUMNS].sort());
    expect(
      (
        await prisma.ticketComplaintDetail.findUniqueOrThrow({
          where: { ticketId: ticket.id },
        })
      ).customerName,
    ).toBe("编辑后的值");
  });

  it("退费单混入侧表行：行集断言拦截且整体回滚", async () => {
    const refund = await legacyTicket(refundKindId);
    await prisma.ticketComplaintDetail.create({ data: { ticketId: refund.id } });

    await expect(prisma.$executeRawUnsafe(migrationSql)).rejects.toThrow(/不一致/);

    expect(await survivingLegacyColumns()).toEqual([...LEGACY_COLUMNS].sort());
  });
});
