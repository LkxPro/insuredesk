import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client.ts";
import { type IntegrationHarness, startIntegrationHarness } from "./integration-harness.ts";

describe("complaint_details_side_table migration (Testcontainers)", () => {
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
          "../prisma/migrations/20260827000000_complaint_details_side_table/migration.sql",
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

  it("回填覆盖全部非 refund_exception 行（含软删/第三种类），退费行不建 detail", async () => {
    const complaint = await legacyTicket(complaintKindId);
    const softDeleted = await legacyTicket(complaintKindId, { deleted: true });
    const thirdKind = await legacyTicket(thirdKindId);
    const refund = await legacyTicket(refundKindId);

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
      await prisma.ticketComplaintDetail.findUnique({ where: { ticketId: refund.id } }),
    ).toBeNull();
  });

  it("幂等重放：不覆盖已存在 detail 行，重跑行数不变", async () => {
    const ticket = await legacyTicket(complaintKindId);
    await prisma.ticketComplaintDetail.create({
      data: { ticketId: ticket.id, customerName: "已存在" },
    });

    await prisma.$executeRawUnsafe(migrationSql);
    const afterFirst = await prisma.ticketComplaintDetail.count();
    expect(
      (
        await prisma.ticketComplaintDetail.findUniqueOrThrow({
          where: { ticketId: ticket.id },
        })
      ).customerName,
    ).toBe("已存在");

    await prisma.$executeRawUnsafe(migrationSql);
    expect(await prisma.ticketComplaintDetail.count()).toBe(afterFirst);
    expect(
      (
        await prisma.ticketComplaintDetail.findUniqueOrThrow({
          where: { ticketId: ticket.id },
        })
      ).customerName,
    ).toBe("已存在");
  });
});
