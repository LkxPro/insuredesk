import ExcelJS from "exceljs";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEMO_PASSWORD } from "../prisma/seed-data";
import { parseEnv } from "../src/env";
import type { PrismaClient, Role, User } from "../src/generated/prisma/client";
import { buildServer } from "../src/server";
import { hashPassword } from "../src/services/auth.service";
import { type IntegrationHarness, startIntegrationHarness } from "./integration-harness";

describe("external ticket export (Testcontainers)", () => {
  let harness: IntegrationHarness;
  let prisma: PrismaClient;
  let app: FastifyInstance;
  let externalRole: Role;
  let externalUser: User;
  let otherExternalUser: User;

  beforeAll(async () => {
    harness = await startIntegrationHarness();
    prisma = harness.prisma;
    externalRole = await prisma.role.create({
      data: {
        name: "外部用户",
        permissions: ["ticket.create_external", "ticket.process_external"],
        requiredTicketFields: [],
      },
    });
    const passwordHash = await hashPassword(DEMO_PASSWORD);
    externalUser = await prisma.user.create({
      data: {
        username: "external-exporter",
        name: "外部导出用户",
        passwordHash,
        roleId: externalRole.id,
        externalDetailFields: JSON.stringify([
          "workOrderNumber",
          "customerName",
          "phone",
          "feedbackTime",
          "status",
        ]),
        externalExportOrder: JSON.stringify(["phone", "customerName", "workOrderNumber"]),
      },
    });
    otherExternalUser = await prisma.user.create({
      data: {
        username: "other-external-exporter",
        name: "其他外部用户",
        passwordHash,
        roleId: externalRole.id,
      },
    });

    app = buildServer(
      parseEnv({
        DATABASE_URL: harness.databaseUrl,
        SESSION_SECRET: "external-ticket-export-test-secret-0123456789",
        NODE_ENV: "test",
        LOG_LEVEL: "silent",
      }),
    );
    await app.ready();
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await harness?.stop();
  });

  beforeEach(async () => {
    await prisma.externalTicketExportAudit.deleteMany();
    await prisma.ticket.deleteMany();
  });

  async function sessionFor(username: string): Promise<string> {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username, password: DEMO_PASSWORD },
    });
    const cookie = response.cookies.find((item) => item.name === "session");
    expect(cookie).toBeDefined();
    return String(cookie?.value);
  }

  it("exports only the account's matching tickets with authorized columns in personal order", async () => {
    await prisma.ticket.create({
      data: {
        workOrderNumber: "WO900001",
        source: "external_channel",
        creatorId: externalUser.id,
        submissionText: "需要查询的投诉",
        customerName: "张三",
        phone: null,
        feedbackTime: new Date("2026-08-07T02:00:00.000Z"),
        status: "processing",
      },
    });
    await prisma.ticket.create({
      data: {
        workOrderNumber: "WO900002",
        source: "external_channel",
        creatorId: otherExternalUser.id,
        submissionText: "其他账号的投诉",
        customerName: "不应导出",
        feedbackTime: new Date("2026-08-07T03:00:00.000Z"),
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/external-tickets/export",
      cookies: { session: await sessionFor(externalUser.username) },
      query: { format: "csv", search: "张三", timeZone: "Asia/Shanghai" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/csv");
    const rows = response.body
      .replace(/^\uFEFF/, "")
      .trim()
      .split("\r\n");
    expect(rows).toEqual([
      "客户电话,客户姓名,工单号,反馈时间,状态",
      ",张三,WO900001,2026-08-07 10:00,处理中",
    ]);
    const audits = await prisma.externalTicketExportAudit.findMany();
    expect(audits).toEqual([
      expect.objectContaining({
        userId: externalUser.id,
        format: "csv",
        fieldKeys: ["phone", "customerName", "workOrderNumber", "feedbackTime", "status"],
        rowCount: 1,
      }),
    ]);
    expect(JSON.parse(audits[0]?.filterSnapshot ?? "null")).toMatchObject({ search: "张三" });
  });

  it("exports the same authorized column contract as an XLSX workbook", async () => {
    await prisma.ticket.create({
      data: {
        workOrderNumber: "WO900003",
        source: "external_channel",
        creatorId: externalUser.id,
        submissionText: "XLSX 导出",
        customerName: "李四",
        phone: "138 0000-0000",
        feedbackTime: new Date("2026-08-07T04:30:00.000Z"),
        status: "assigned",
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/external-tickets/export",
      cookies: { session: await sessionFor(externalUser.username) },
      query: { format: "xlsx", timeZone: "Asia/Shanghai" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(response.rawPayload as unknown as ArrayBuffer);
    const sheet = workbook.worksheets[0];
    expect(sheet?.getRow(1).values).toEqual([
      undefined,
      "客户电话",
      "客户姓名",
      "工单号",
      "反馈时间",
      "状态",
    ]);
    expect(sheet?.getRow(2).values).toEqual([
      undefined,
      "138 0000-0000",
      "李四",
      "WO900003",
      "2026-08-07 12:30",
      "已分配",
    ]);
  });

  it("requires an authenticated external account", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/external-tickets/export",
      query: { format: "csv" },
    });

    expect(response.statusCode).toBe(401);
  });

  it("exports and searches only the latest public processing result", async () => {
    await prisma.user.update({
      where: { id: externalUser.id },
      data: {
        externalDetailFields: JSON.stringify(["workOrderNumber", "processingResult"]),
        externalExportOrder: JSON.stringify(["workOrderNumber", "processingResult"]),
      },
    });
    const ticket = await prisma.ticket.create({
      data: {
        workOrderNumber: "WO900004",
        source: "external_channel",
        creatorId: externalUser.id,
        submissionText: "最新处理结果",
        feedbackTime: new Date("2026-08-07T05:00:00.000Z"),
        status: "processing",
      },
    });
    await prisma.processLog.createMany({
      data: [
        {
          ticketId: ticket.id,
          action: "comment",
          internalOnly: false,
          remark: "公开处理结果",
          operatorId: externalUser.id,
          operatorName: externalUser.name,
          at: new Date("2026-08-07T05:01:00.000Z"),
        },
        {
          ticketId: ticket.id,
          action: "comment",
          internalOnly: true,
          remark: "内部敏感判断",
          operatorId: externalUser.id,
          operatorName: externalUser.name,
          at: new Date("2026-08-07T05:02:00.000Z"),
        },
      ],
    });

    const exportResponse = await app.inject({
      method: "GET",
      url: "/api/external-tickets/export",
      cookies: { session: await sessionFor(externalUser.username) },
      query: { format: "csv", timeZone: "Asia/Shanghai" },
    });
    expect(exportResponse.statusCode).toBe(200);
    expect(exportResponse.body).toContain("WO900004,公开处理结果");
    expect(exportResponse.body).not.toContain("内部敏感判断");

    const internalSearchResponse = await app.inject({
      method: "GET",
      url: "/api/external-tickets/export",
      cookies: { session: await sessionFor(externalUser.username) },
      query: { format: "csv", search: "内部敏感判断" },
    });
    expect(internalSearchResponse.body.replace(/^\uFEFF/, "").trim()).toBe("工单号,最新处理");
  });
});
