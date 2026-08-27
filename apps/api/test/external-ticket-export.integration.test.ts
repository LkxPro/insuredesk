import ExcelJS from "exceljs";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEMO_PASSWORD } from "../prisma/seed-data.ts";
import { parseEnv } from "../src/env.ts";
import type { Prisma, PrismaClient, Role, User } from "../src/generated/prisma/client.ts";
import { buildServer } from "../src/server.ts";
import { hashPassword } from "../src/services/auth.service.ts";
import { type IntegrationHarness, startIntegrationHarness } from "./integration-harness.ts";

/**
 * 导出口是 REST endpoint 而非 tRPC procedure,故走 buildServer + app.inject。
 * 导出对外部账号恒开,无权限位可关。
 */
describe("external ticket export (Testcontainers)", () => {
  let harness: IntegrationHarness;
  let prisma: PrismaClient;
  let app: FastifyInstance;
  let externalRole: Role;
  let externalUser: User;
  let externalPeer: User;

  beforeAll(async () => {
    harness = await startIntegrationHarness({ seed: ["rolesAndUsers"] });
    prisma = harness.prisma;

    externalRole = await prisma.role.create({
      data: {
        name: "外部用户",
        permissions: ["ticket.create_external", "ticket.process_external"],
        system: false,
        requiredTicketFields: [],
      },
    });

    const passwordHash = await hashPassword(DEMO_PASSWORD);
    externalUser = await prisma.user.create({
      data: {
        username: "ext-exporter",
        name: "外部导出员",
        passwordHash,
        roleId: externalRole.id,
        active: true,
      },
    });
    externalPeer = await prisma.user.create({
      data: {
        username: "ext-peer",
        name: "同角色他人",
        passwordHash,
        roleId: externalRole.id,
        active: true,
      },
    });

    const env = parseEnv({
      DATABASE_URL: harness.databaseUrl,
      SESSION_SECRET: "insuredesk-ext-export-test-secret-0123456",
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
    });
    app = buildServer(env);
    await app.ready();
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await harness?.stop();
  });

  beforeEach(async () => {
    await prisma.ticket.deleteMany();
  });

  async function sessionFor(username: string): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username, password: DEMO_PASSWORD },
    });
    const cookie = res.cookies.find((c) => c.name === "session");
    expect(cookie, `login as ${username}`).toBeDefined();
    return String(cookie?.value);
  }

  const CORE_ROW_KEYS = new Set([
    "createdAt",
    "deletedAt",
    "status",
    "completionTime",
    "completionStatusId",
    "assigneeId",
    "assignedAt",
    "contactPhone",
    "contactCount",
    "nextContactTime",
    "slaPolicyId",
    "dueAt",
    "followUpFrequency",
    "firstResponseRequirement",
  ]);

  function exportRequest(session: string | null, query: Record<string, string>) {
    return app.inject({
      method: "GET",
      url: "/api/external-tickets/export",
      query,
      ...(session ? { cookies: { session } } : {}),
    });
  }

  async function submitAs(
    user: User,
    role: Role,
    submissionText: string,
    row: Record<string, unknown> = {},
  ) {
    const result = await harness.callerFor(user, role).externalTicket.submit({ submissionText });
    const core: Record<string, unknown> = {};
    const detail: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      (CORE_ROW_KEYS.has(key) ? core : detail)[key] = value;
    }
    if (Object.keys(core).length > 0) {
      await prisma.ticket.update({
        where: { id: result.id },
        data: core as Prisma.TicketUpdateInput,
      });
    }
    if (Object.keys(detail).length > 0) {
      await prisma.ticketComplaintDetail.update({
        where: { ticketId: result.id },
        data: detail as Prisma.TicketComplaintDetailUpdateInput,
      });
    }
    return result;
  }

  const submit = (text: string, row: Record<string, unknown> = {}) =>
    submitAs(externalUser, externalRole, text, row);

  function parseCsv(payload: string): string[][] {
    const text = payload.replace(/^\uFEFF/, "").replace(/\r\n$/, "");
    return text.split("\r\n").map((line) => {
      const cells: string[] = [];
      let current = "";
      let quoted = false;
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (quoted) {
          if (char === '"' && line[i + 1] === '"') {
            current += '"';
            i++;
          } else if (char === '"') {
            quoted = false;
          } else {
            current += char;
          }
        } else if (char === '"') {
          quoted = true;
        } else if (char === ",") {
          cells.push(current);
          current = "";
        } else {
          current += char;
        }
      }
      cells.push(current);
      return cells;
    });
  }

  describe("守卫校验", () => {
    it("401 未登录；403 非外部账号（含管理员）", async () => {
      const anonymous = await exportRequest(null, { format: "csv" });
      expect(anonymous.statusCode).toBe(401);

      // 管理员经系统角色展开持有全部正向点，仍非外部账号
      const admin = await sessionFor("admin");
      const adminRes = await exportRequest(admin, { format: "csv" });
      expect(adminRes.statusCode).toBe(403);
      expect(adminRes.json().error).toContain("外部账号");
    });

    it("schema 拒绝的 query（未知格式/畸形日期）→ 400", async () => {
      const session = await sessionFor("ext-exporter");
      expect((await exportRequest(session, { format: "pdf" })).statusCode).toBe(400);
      expect(
        (await exportRequest(session, { format: "csv", createdFrom: "昨天" })).statusCode,
      ).toBe(400);
    });
  });

  describe("数据范围与筛选 (CSV)", () => {
    it("只导出本人提交的单，软删除外", async () => {
      await submit("本人的单", { customerName: "本人客户" });
      await submitAs(externalPeer, externalRole, "他人的单", { customerName: "他人客户" });
      await submit("被软删的单", { customerName: "软删客户", deletedAt: new Date() });

      const session = await sessionFor("ext-exporter");
      const res = await exportRequest(session, { format: "csv" });
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toContain("text/csv");
      expect(res.headers["content-disposition"]).toMatch(
        /attachment; filename="external-tickets-.*\.csv"/,
      );

      const rows = parseCsv(res.body);
      expect(rows).toHaveLength(2);
      const nameColumn = (rows[0] ?? []).indexOf("客户姓名");
      expect(rows[1]?.[nameColumn]).toBe("本人客户");
      expect(res.body).not.toContain("他人客户");
      expect(res.body).not.toContain("软删客户");
    });

    it("已完结单默认在导出内；显式 status 筛选可只导已完结", async () => {
      await submit("在途单", { customerName: "在途客户" });
      const done = await submit("已完结单", { customerName: "完结客户" });
      await prisma.ticket.update({ where: { id: done.id }, data: { status: "completed" } });

      const session = await sessionFor("ext-exporter");
      const defaulted = await exportRequest(session, { format: "csv" });
      expect(defaulted.body).toContain("在途客户");
      expect(defaulted.body).toContain("完结客户");

      const onlyCompleted = await exportRequest(session, { format: "csv", status: "completed" });
      expect(onlyCompleted.body).toContain("完结客户");
      expect(onlyCompleted.body).not.toContain("在途客户");
    });

    it("搜索扩展命中保单号", async () => {
      await submit("带保单的", { customerName: "保单客户", policyNumbers: ["PX-1", "PX-2"] });
      await submit("不带的", { customerName: "普通客户" });

      const session = await sessionFor("ext-exporter");
      const res = await exportRequest(session, { format: "csv", search: "PX-2" });
      expect(res.body).toContain("保单客户");
      expect(res.body).not.toContain("普通客户");
    });

    it("创建时间区间随导出下传，起止边界均在列", async () => {
      const from = new Date("2026-07-06T00:00:00.000Z");
      const to = new Date("2026-07-12T23:59:59.999Z");
      await submit("区间前", {
        customerName: "区间前客户",
        createdAt: new Date(from.getTime() - 1),
      });
      await submit("起边界", { customerName: "起边界客户", createdAt: from });
      await submit("止边界", { customerName: "止边界客户", createdAt: to });
      await submit("区间后", { customerName: "区间后客户", createdAt: new Date(to.getTime() + 1) });

      const session = await sessionFor("ext-exporter");
      const res = await exportRequest(session, {
        format: "csv",
        createdFrom: from.toISOString(),
        createdTo: to.toISOString(),
      });
      expect(res.body).toContain("起边界客户");
      expect(res.body).toContain("止边界客户");
      expect(res.body).not.toContain("区间前客户");
      expect(res.body).not.toContain("区间后客户");
    });

    it("列集固定为 5 列：保单号/客户姓名/客户电话/联系电话/工单原文", async () => {
      await submit("导出内容单", {
        customerName: "内容客户",
        phone: "13800000000",
        contactPhone: "13900000000",
        policyNumbers: ["PX-001"],
        assigneeId: (await prisma.user.findUniqueOrThrow({ where: { username: "manager" } })).id,
        dueAt: new Date(),
      });

      const session = await sessionFor("ext-exporter");
      const res = await exportRequest(session, { format: "csv", timeZone: "Asia/Shanghai" });
      const rows = parseCsv(res.body);
      expect(rows[0]).toEqual(["保单号", "客户姓名", "客户电话", "联系电话", "工单原文"]);
      expect(rows[1]).toEqual(["PX-001", "内容客户", "13800000000", "13900000000", "导出内容单"]);
    });

    it("空字段导出为空字符串，不留占位符", async () => {
      await submit("空字段单");

      const session = await sessionFor("ext-exporter");
      const res = await exportRequest(session, { format: "csv" });
      const rows = parseCsv(res.body);
      expect(rows[1]).toEqual(["", "", "", "", "空字段单"]);
    });
  });

  describe("Excel (xlsx)", () => {
    it("round-trips through exceljs with the same rows", async () => {
      await submit("甲单", { customerName: "甲客户" });
      await submit("乙单", { customerName: "乙客户" });

      const session = await sessionFor("ext-exporter");
      const res = await exportRequest(session, { format: "xlsx" });
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toBe(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(res.rawPayload as unknown as ArrayBuffer);
      const sheet = workbook.getWorksheet("工单");
      expect(sheet).toBeDefined();
      expect(sheet?.rowCount).toBe(3);
      expect(sheet?.getRow(1).getCell(1).value).toBe("保单号");
      const headerCells = (sheet?.getRow(1).values as Array<string | undefined>) ?? [];
      const nameColumn = headerCells.indexOf("客户姓名");
      const names = [2, 3].map((row) => sheet?.getRow(row).getCell(nameColumn).value);
      expect(names.sort()).toEqual(["乙客户", "甲客户"].sort());
    });
  });
});
