import ExcelJS from "exceljs";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEMO_PASSWORD } from "../prisma/seed-data";
import { parseEnv } from "../src/env";
import type { PrismaClient, Role, User } from "../src/generated/prisma/client";
import { buildServer } from "../src/server";
import { hashPassword } from "../src/services/auth.service";
import { type IntegrationHarness, startIntegrationHarness } from "./integration-harness";

/**
 * Acceptance tests for 外部导出工单, driven over the real HTTP surface
 * (buildServer + app.inject with session cookies — the download is a REST
 * endpoint, not a tRPC procedure):
 *
 * - guard 顺序: 401 未登录 → 403 无 ticket.export_external → 403 非外部账号
 *   （管理员展开后持有该点也不能走外部口子）
 * - 数据范围恒为本人提交的单，筛选（状态/搜索含保单号/创建时间区间/
 *   includeCompleted）与外部列表同口径；无翻页参数 = 筛选结果全集
 * - 两种格式 round-trip（CSV 按文本解析，XLSX 经 exceljs 重读）
 */
describe("external ticket export (Testcontainers)", () => {
  let harness: IntegrationHarness;
  let prisma: PrismaClient;
  let app: FastifyInstance;
  let externalRole: Role;
  let externalUser: User;
  let externalPeer: User;
  /** 无导出位的外部角色 —— 权限位关闭后的形态（登录走用户名，无需留账号句柄）。 */
  let noExportRole: Role;

  beforeAll(async () => {
    harness = await startIntegrationHarness({ seed: ["rolesAndUsers"] });
    prisma = harness.prisma;

    externalRole = await prisma.role.create({
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
    noExportRole = await prisma.role.create({
      data: {
        name: "外部用户（无导出）",
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
    await prisma.user.create({
      data: {
        username: "ext-no-export",
        name: "无导出外部员",
        passwordHash,
        roleId: noExportRole.id,
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

  /** Log in over the real endpoint; returns the session cookie value. */
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
    if (Object.keys(row).length > 0) {
      await prisma.ticket.update({ where: { id: result.id }, data: row });
    }
    return result;
  }

  const submit = (text: string, row: Record<string, unknown> = {}) =>
    submitAs(externalUser, externalRole, text, row);

  /** BOM-stripped CSV → rows (quoted-field-aware enough for our data). */
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

  describe("权限校验 (UI 无入口之外，API 也拒绝)", () => {
    it("401 未登录；403 无导出位的外部账号；403 非外部账号（含管理员）", async () => {
      const anonymous = await exportRequest(null, { format: "csv" });
      expect(anonymous.statusCode).toBe(401);

      const noExport = await sessionFor("ext-no-export");
      const forbidden = await exportRequest(noExport, { format: "csv" });
      expect(forbidden.statusCode).toBe(403);
      expect(forbidden.json().error).toContain("ticket.export_external");

      // 管理员经系统角色展开持有全部正向点（含 ticket.export_external），仍非外部账号
      const admin = await sessionFor("admin");
      const adminRes = await exportRequest(admin, { format: "csv" });
      expect(adminRes.statusCode).toBe(403);
      expect(adminRes.json().error).toContain("外部账号");

      // 内部普通角色本无该点
      const manager = await sessionFor("manager");
      expect((await exportRequest(manager, { format: "csv" })).statusCode).toBe(403);
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
      const own = await submit("本人的单", { customerName: "本人客户" });
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
      expect(rows).toHaveLength(2); // header + 本人一单
      expect(rows[1]?.[0]).toBe(own.workOrderNumber);
      expect(res.body).toContain("本人客户");
      expect(res.body).not.toContain("他人客户");
      expect(res.body).not.toContain("软删客户");
    });

    it("默认排除已完结；includeCompleted=1 或显式 status 筛选可查出", async () => {
      await submit("在途单", { customerName: "在途客户" });
      const done = await submit("已完结单", { customerName: "完结客户" });
      await prisma.ticket.update({ where: { id: done.id }, data: { status: "completed" } });

      const session = await sessionFor("ext-exporter");
      const defaulted = await exportRequest(session, { format: "csv" });
      expect(defaulted.body).toContain("在途客户");
      expect(defaulted.body).not.toContain("完结客户");

      const withCompleted = await exportRequest(session, { format: "csv", includeCompleted: "1" });
      expect(withCompleted.body).toContain("完结客户");

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

    it("列集为外部表面字段：有工单原文/保单号，无内部运营列", async () => {
      await submit("导出内容单", {
        customerName: "内容客户",
        policyNumbers: ["PX-001"],
        assigneeId: (await prisma.user.findUniqueOrThrow({ where: { username: "manager" } })).id,
        dueAt: new Date(),
      });

      const session = await sessionFor("ext-exporter");
      const res = await exportRequest(session, { format: "csv", timeZone: "Asia/Shanghai" });
      const rows = parseCsv(res.body);
      const header = rows[0] ?? [];
      expect(header).toContain("工单原文");
      expect(header).toContain("保单号");
      expect(header).toContain("客户姓名");
      expect(header).toContain("处理结果");
      expect(header).not.toContain("责任人");
      expect(header).not.toContain("处理时限");
      expect(header).not.toContain("跟进频次");

      const row = rows[1] ?? [];
      expect(row[header.indexOf("保单号")]).toBe("PX-001");
      expect(row[header.indexOf("工单原文")]).toBe("导出内容单");
    });

    it("日期列按请求时区格式化，非法时区回落 UTC", async () => {
      await submit("时区单", { createdAt: new Date("2026-07-09T16:30:00.000Z") });

      const session = await sessionFor("ext-exporter");
      const res = await exportRequest(session, { format: "csv", timeZone: "Asia/Shanghai" });
      const rows = parseCsv(res.body);
      const createdColumn = rows[0]?.indexOf("创建时间") ?? -1;
      expect(rows[1]?.[createdColumn]).toBe("2026-07-10 00:30"); // UTC+8

      const fallback = await exportRequest(session, { format: "csv", timeZone: "Not/AZone" });
      expect(fallback.statusCode).toBe(200);
      expect(parseCsv(fallback.body)[1]?.[createdColumn]).toBe("2026-07-09 16:30");
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
      expect(sheet?.rowCount).toBe(3); // header + 2 tickets
      expect(sheet?.getRow(1).getCell(1).value).toBe("工单号");
      const headerCells = (sheet?.getRow(1).values as Array<string | undefined>) ?? [];
      const nameColumn = headerCells.indexOf("客户姓名");
      const names = [2, 3].map((row) => sheet?.getRow(row).getCell(nameColumn).value);
      expect(names.sort()).toEqual(["乙客户", "甲客户"].sort());
    });
  });
});
