import { TICKET_IMPORT_HEADERS } from "@insuredesk/shared";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedDemoTickets } from "../prisma/seed-data.ts";
import type { PrismaClient, Role, User } from "../src/generated/prisma/client.ts";
import { importTickets } from "../src/services/ticket-import.service.ts";
import { type IntegrationHarness, startIntegrationHarness } from "./integration-harness.ts";

describe("四个建单点的 kindId/slaAnchorAt 盖章 (Testcontainers)", () => {
  let harness: IntegrationHarness;
  let prisma: PrismaClient;
  let complaintKindId: string;
  let externalUser: User;
  let externalRole: Role;

  beforeAll(async () => {
    harness = await startIntegrationHarness({
      seed: ["rolesAndUsers", "slaPolicies", "channels", "categories"],
    });
    prisma = harness.prisma;
    complaintKindId = (await prisma.ticketKind.findUniqueOrThrow({ where: { key: "complaint" } }))
      .id;

    externalRole = await prisma.role.create({
      data: {
        name: "外部用户",
        permissions: ["ticket.create_external", "ticket.process_external"],
        system: false,
        requiredTicketFields: [],
      },
    });
    externalUser = await prisma.user.create({
      data: {
        username: "external-stamp",
        name: "外部账号",
        passwordHash: "dummy",
        roleId: externalRole.id,
        active: true,
      },
    });
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  });

  async function expectComplaintStamp(ticketIds: string[]) {
    const rows = await prisma.ticket.findMany({ where: { id: { in: ticketIds } } });
    expect(rows).toHaveLength(ticketIds.length);
    for (const row of rows) {
      expect(row.kindId).toBe(complaintKindId);
      expect(row.slaAnchorAt.getTime()).toBe(row.createdAt.getTime());
    }
  }

  it("手工建单 createTicket", async () => {
    const created = await harness
      .callerFor(harness.seeded.users.manager, harness.seeded.roles.csManager)
      .ticket.create({ customerName: "手工客户", slaPolicyId: harness.slaPolicyId("一般投诉") });

    await expectComplaintStamp([created.id]);

    const row = await prisma.ticket.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.dueAt?.getTime()).toBe(row.createdAt.getTime() + 48 * 60 * 60 * 1000);
  });

  it("外部账号提交 externalTicket.submit", async () => {
    const result = await harness
      .callerFor(externalUser, externalRole)
      .externalTicket.submit({ submissionText: "外部提交的客户反馈原文" });

    await expectComplaintStamp([result.id]);
  });

  it("Excel 批量导入 importTickets", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("工单");
    sheet.addRow(TICKET_IMPORT_HEADERS);
    sheet.addRow(TICKET_IMPORT_HEADERS.map((header) => (header === "客户姓名" ? "导入客户" : "")));
    const body = Buffer.from(await workbook.xlsx.writeBuffer());

    const { imported } = await importTickets(
      harness.deps,
      harness.authUserFor(harness.seeded.users.manager, harness.seeded.roles.csManager),
      { body, filename: "stamp.xlsx" },
    );
    expect(imported).toBe(1);

    const rows = await prisma.ticket.findMany({ where: { customerName: "导入客户" } });
    await expectComplaintStamp(rows.map((row) => row.id));
  });

  it("demo 种子 seedDemoTickets（含 feishu/community 直插路径）", async () => {
    const { created } = await seedDemoTickets(prisma, harness.seeded);
    expect(created.length).toBeGreaterThan(0);
    await expectComplaintStamp(created.map((ticket) => ticket.id));
    // demo 覆盖到非 manual 来源才算数（直插路径不经过 createTicket）
    const sources = new Set(created.map((ticket) => ticket.source));
    expect(sources).toContain("feishu_form");
    expect(sources).toContain("community");
  });
});
