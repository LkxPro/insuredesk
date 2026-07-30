import type { Permission, TicketCreateInput } from "@insuredesk/shared";
import ExcelJS from "exceljs";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEMO_PASSWORD } from "../prisma/seed-data";
import { parseEnv } from "../src/env";
import type { Prisma, PrismaClient, Role, User } from "../src/generated/prisma/client";
import { appRouter } from "../src/routers/index";
import { buildServer } from "../src/server";
import { hashPassword } from "../src/services/auth.service";
import { type IntegrationHarness, startIntegrationHarness } from "./integration-harness";

const HOUR_MS = 60 * 60 * 1000;

/**
 * Acceptance tests for 导出工单, driven over the real HTTP surface
 * (buildServer + app.inject with session cookies — the download is a REST
 * endpoint, not a tRPC procedure):
 *
 * - ticket.export guard: 401 unauthenticated, 403 without the permission
 * - 按列表当前筛选条件导出: the file's rows equal ticket.list's rows for the
 *   same filters — soft-deletes excluded, data scope applied (个人档只能
 *   导出本人名下), computed 状态 at export time (导出时刻口径)
 * - both formats round-trip (CSV parsed as text, XLSX re-read via exceljs)
 * - 导出不产生 ProcessLog
 */
describe("ticket export (Testcontainers)", () => {
  let harness: IntegrationHarness;
  let prisma: PrismaClient;
  let app: FastifyInstance;
  let seeded: IntegrationHarness["seeded"];
  let channelIds: Map<string, string>;
  /** ticket.export WITHOUT ticket.view_all — the 个人档 exporter. */
  let scopedExporter: User;

  beforeAll(async () => {
    harness = await startIntegrationHarness({
      seed: ["rolesAndUsers", "slaPolicies", "channels"],
    });
    prisma = harness.prisma;
    seeded = harness.seeded;
    const databaseUrl = harness.databaseUrl;

    const channels = await prisma.channel.findMany({ orderBy: { displayOrder: "asc" } });
    channelIds = new Map(channels.map((c) => [c.name, c.id]));

    // No factory role holds ticket.export without ticket.view_all, so the
    // data-scope criterion needs a custom role: sees/export own tickets only.
    const scopedRole = await prisma.role.create({
      data: { name: "个人档导出", permissions: ["ticket.view", "ticket.export"] },
    });
    scopedExporter = await prisma.user.create({
      data: {
        username: "scoped-exporter",
        name: "档内导出员",
        email: "scoped-exporter@example.com",
        roleId: scopedRole.id,
        passwordHash: await hashPassword(DEMO_PASSWORD),
        active: true,
      },
    });

    const env = parseEnv({
      DATABASE_URL: databaseUrl,
      SESSION_SECRET: "insuredesk-export-test-secret-0123456789",
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
      url: "/api/tickets/export",
      query,
      ...(session ? { cookies: { session } } : {}),
    });
  }

  /** tRPC caller mirroring the list page — the consistency oracle. */
  function callerFor(user: User, role: Role) {
    return appRouter.createCaller({
      traceId: "ticket-export-test",
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        email: user.email,
        team: user.team,
        roleId: role.id,
        roleName: role.name,
        permissions: role.permissions as Permission[],
        requiredTicketFields: [],
        isExternal: false,
      },
      sessionToken: null,
    });
  }

  const manager = () => callerFor(seeded.users.manager, seeded.roles.csManager);

  const channelId = (name: string) => {
    const id = channelIds.get(name);
    if (!id) throw new Error(`渠道「${name}」未播种`);
    return id;
  };

  const baseInput = {
    feedbackTime: "2026-07-09T02:00:00.000Z",
    project: "融盛",
    brokerageEntity: "东方大地",
    paymentChannel: "连连支付",
    policyNumbers: ["P2026070900123"],
    userComplaintChannel: "400热线",
    customerName: "王小明",
    phone: "13800000000",
    customerRequest: "对保费收取金额有异议，要求核实并回复",
    nuclearBodyStatus: "待核实",
    hasContacted: false,
    complaintLevel: "一般投诉",
  } satisfies TicketCreateInput;

  async function makeTicket(
    input: Partial<TicketCreateInput> = {},
    row: Prisma.TicketUncheckedUpdateInput = {},
  ) {
    const created = await manager().ticket.create({
      ...baseInput,
      channelId: channelId("保司"),
      ...input,
    });
    if (Object.keys(row).length > 0) {
      await prisma.ticket.update({ where: { id: created.id }, data: row });
    }
    return created;
  }

  /** BOM-stripped CSV → array of rows (quoted-field-aware enough for our data). */
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
    it("401 without a session, 403 without ticket.export, and neither writes a file", async () => {
      const anonymous = await exportRequest(null, { format: "csv" });
      expect(anonymous.statusCode).toBe(401);

      // 只读观察 holds ticket.view_all but NOT ticket.export
      const observer = await sessionFor("observer");
      const forbidden = await exportRequest(observer, { format: "csv" });
      expect(forbidden.statusCode).toBe(403);
      expect(forbidden.json().error).toContain("ticket.export");

      // 一线客服 has no export permission either
      const frontline = await sessionFor("cs1");
      expect((await exportRequest(frontline, { format: "csv" })).statusCode).toBe(403);
    });

    it("rejects a query the shared schema rejects (unknown format) with 400", async () => {
      const session = await sessionFor("manager");
      const res = await exportRequest(session, { format: "pdf" });
      expect(res.statusCode).toBe(400);
      expect(res.json().zodError).toBeTruthy();
    });
  });

  describe("逗号分隔多选参数 (querystring 是扁平字符串)", () => {
    it("splits comma-joined filters and exports the union", async () => {
      await makeTicket({ channelId: channelId("支付"), customerName: "支付客户" });
      await makeTicket({ channelId: channelId("监管"), customerName: "监管客户" });
      await makeTicket({ channelId: channelId("保司"), customerName: "保司客户" });

      const session = await sessionFor("manager");
      const res = await exportRequest(session, {
        format: "csv",
        channelId: `${channelId("支付")},${channelId("监管")}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain("支付客户");
      expect(res.body).toContain("监管客户");
      expect(res.body).not.toContain("保司客户");
    });

    it("source 缺省排除归档单；空值参数 = 不过滤、归档单随导出", async () => {
      await makeTicket({ customerName: "活跃客户" });
      await makeTicket({ customerName: "归档客户" }, { source: "file_import" });

      const session = await sessionFor("manager");
      const defaulted = await exportRequest(session, { format: "csv" });
      expect(defaulted.statusCode).toBe(200);
      expect(defaulted.body).toContain("活跃客户");
      expect(defaulted.body).not.toContain("归档客户");

      // 与列表页"清空来源筛选"下传的标记一致：空值覆盖缺省
      const cleared = await exportRequest(session, { format: "csv", source: "" });
      expect(cleared.statusCode).toBe(200);
      expect(cleared.body).toContain("归档客户");

      const explicit = await exportRequest(session, { format: "csv", source: "file_import" });
      expect(explicit.statusCode).toBe(200);
      expect(explicit.body).toContain("归档客户");
      expect(explicit.body).not.toContain("活跃客户");
    });
  });

  describe("创建时间区间随导出下传", () => {
    it("exports only the rows inside the range, both edges included", async () => {
      const from = new Date("2026-07-06T00:00:00.000Z");
      const to = new Date("2026-07-12T23:59:59.999Z");
      await makeTicket({ customerName: "区间前" }, { createdAt: new Date(from.getTime() - 1) });
      await makeTicket({ customerName: "起边界" }, { createdAt: from });
      await makeTicket({ customerName: "止边界" }, { createdAt: to });
      await makeTicket({ customerName: "区间后" }, { createdAt: new Date(to.getTime() + 1) });

      const session = await sessionFor("manager");
      const res = await exportRequest(session, {
        format: "csv",
        createdFrom: from.toISOString(),
        createdTo: to.toISOString(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain("起边界");
      expect(res.body).toContain("止边界");
      expect(res.body).not.toContain("区间前");
      expect(res.body).not.toContain("区间后");
    });

    it("rejects a malformed range with 400 instead of exporting everything", async () => {
      await makeTicket({ customerName: "任意客户" });

      const session = await sessionFor("manager");
      const res = await exportRequest(session, { format: "csv", createdFrom: "昨天" });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("按列表当前筛选条件导出 (CSV)", () => {
    it("exports exactly the rows ticket.list returns for the same filters, soft-deletes excluded", async () => {
      const payment1 = await makeTicket({
        channelId: channelId("支付"),
        customerName: "支付客户一",
      });
      const payment2 = await makeTicket({
        channelId: channelId("支付"),
        customerName: "支付客户二",
      });
      await makeTicket({ channelId: channelId("保司"), customerName: "保司客户" });
      await makeTicket(
        { channelId: channelId("支付"), customerName: "已删除客户" },
        { deletedAt: new Date() },
      );

      const listed = await manager().ticket.list({ channelId: channelId("支付") });

      const session = await sessionFor("manager");
      const res = await exportRequest(session, { format: "csv", channelId: channelId("支付") });
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toContain("text/csv");
      expect(res.headers["content-disposition"]).toMatch(/attachment; filename="tickets-.*\.csv"/);

      const rows = parseCsv(res.body);
      const header = rows[0];
      expect(header?.[0]).toBe("工单号");
      expect(header).toContain("状态");
      expect(header).toContain("投诉等级");
      expect(header).toContain("完结状态");

      // Same rows, same order as the list — and nobody else's
      const exportedNumbers = rows.slice(1).map((cells) => cells[0]);
      expect(exportedNumbers).toEqual(listed.items.map((item) => item.workOrderNumber));
      expect(exportedNumbers).toContain(payment1.workOrderNumber);
      expect(exportedNumbers).toContain(payment2.workOrderNumber);

      const body = res.body;
      expect(body).toContain("支付客户一");
      expect(body).not.toContain("保司客户");
      expect(body).not.toContain("已删除客户");
    });

    it("exports 多值保单号 as one space-joined cell, [] as an empty cell", async () => {
      const multi = await makeTicket({ policyNumbers: ["PX-001", "PX-002"] });
      const blank = await makeTicket({ policyNumbers: [] });

      const session = await sessionFor("manager");
      const res = await exportRequest(session, { format: "csv" });
      expect(res.statusCode).toBe(200);

      const rows = parseCsv(res.body);
      const policyIndex = rows[0]?.indexOf("保单号") ?? -1;
      expect(policyIndex).toBeGreaterThan(-1);
      const cellByNumber = new Map(rows.slice(1).map((cells) => [cells[0], cells[policyIndex]]));
      expect(cellByNumber.get(multi.workOrderNumber)).toBe("PX-001 PX-002");
      expect(cellByNumber.get(blank.workOrderNumber)).toBe("");
    });

    it("escapes fields containing commas and quotes per RFC 4180", async () => {
      await makeTicket({ customerRequest: '要求"全额退保", 并书面道歉' });

      const session = await sessionFor("manager");
      const res = await exportRequest(session, { format: "csv" });

      const rows = parseCsv(res.body);
      const requestColumn = rows[0]?.indexOf("客户诉求") ?? -1;
      expect(rows[1]?.[requestColumn]).toBe('要求"全额退保", 并书面道歉');
    });

    it("计算状态按导出时刻口径 — an overdue row exports 已超时, not its stored status", async () => {
      await makeTicket(
        { customerName: "已超时客户" },
        { status: "processing", dueAt: new Date(Date.now() - HOUR_MS) },
      );

      const session = await sessionFor("manager");
      const res = await exportRequest(session, { format: "csv" });

      const rows = parseCsv(res.body);
      const statusColumn = rows[0]?.indexOf("状态") ?? -1;
      expect(rows[1]?.[statusColumn]).toBe("已超时");

      // …and filtering by the computed status selects that same row
      const filtered = await exportRequest(session, { format: "csv", status: "overdue" });
      expect(parseCsv(filtered.body)).toHaveLength(2); // header + the one row
    });

    it("formats date columns in the requested IANA zone", async () => {
      await makeTicket({}, { createdAt: new Date("2026-07-09T16:30:00.000Z") });

      const session = await sessionFor("manager");
      const res = await exportRequest(session, {
        format: "csv",
        timeZone: "Asia/Shanghai",
      });

      const rows = parseCsv(res.body);
      const createdColumn = rows[0]?.indexOf("创建时间") ?? -1;
      expect(rows[1]?.[createdColumn]).toBe("2026-07-10 00:30"); // UTC+8

      // An invalid zone degrades to UTC instead of failing the download
      const fallback = await exportRequest(session, { format: "csv", timeZone: "Not/AZone" });
      expect(fallback.statusCode).toBe(200);
      expect(parseCsv(fallback.body)[1]?.[createdColumn]).toBe("2026-07-09 16:30");
    });

    it("进线时间/投诉信息接收渠道 columns sit in their detail-page positions, dates in the requested zone", async () => {
      await makeTicket({
        contactTime: "2026-07-08T02:00:00.000Z",
        complaintReceiveChannel: "监管转办",
      });

      const session = await sessionFor("manager");
      const res = await exportRequest(session, { format: "csv", timeZone: "Asia/Shanghai" });
      expect(res.statusCode).toBe(200);

      const rows = parseCsv(res.body);
      const header = rows[0] ?? [];
      // 投诉信息接收渠道 紧跟 用户投诉渠道；进线时间 位于 是否已联系｜联系ID 之间
      expect(header.indexOf("投诉信息接收渠道")).toBe(header.indexOf("用户投诉渠道") + 1);
      expect(header.indexOf("进线时间")).toBe(header.indexOf("是否已联系") + 1);
      expect(header.indexOf("联系ID")).toBe(header.indexOf("进线时间") + 1);

      const row = rows[1] ?? [];
      expect(row[header.indexOf("投诉信息接收渠道")]).toBe("监管转办");
      expect(row[header.indexOf("进线时间")]).toBe("2026-07-08 10:00"); // UTC+8
    });
  });

  describe("数据范围", () => {
    it("个人档只能导出本人名下 — no ticket.view_all pins the export to own tickets", async () => {
      await makeTicket({ customerName: "无人认领" }); // unassigned pool
      const own = await makeTicket(
        { customerName: "档内自己的单" },
        { status: "assigned", assigneeId: scopedExporter.id, assignedAt: new Date() },
      );
      await makeTicket(
        { customerName: "主管的单" },
        { status: "assigned", assigneeId: seeded.users.manager.id, assignedAt: new Date() },
      );

      const session = await sessionFor("scoped-exporter");
      const res = await exportRequest(session, { format: "csv" });
      expect(res.statusCode).toBe(200);

      const rows = parseCsv(res.body);
      expect(rows).toHaveLength(2); // header + own ticket only
      expect(rows[1]?.[0]).toBe(own.workOrderNumber);
      expect(res.body).not.toContain("无人认领");
      expect(res.body).not.toContain("主管的单");
    });

    it("filters stay inside the exporter's scope, never widen it", async () => {
      await makeTicket({ channelId: channelId("支付"), customerName: "别人的支付单" });
      const own = await makeTicket(
        { channelId: channelId("支付"), customerName: "自己的支付单" },
        { status: "assigned", assigneeId: scopedExporter.id },
      );

      const session = await sessionFor("scoped-exporter");
      const res = await exportRequest(session, { format: "csv", channelId: channelId("支付") });

      const rows = parseCsv(res.body);
      expect(rows.slice(1).map((cells) => cells[0])).toEqual([own.workOrderNumber]);
    });

    it("个人档导出包含本人创建的单 — 未指派与已指派他人均在列", async () => {
      const createdUnassigned = await makeTicket(
        { customerName: "档主创建未指派" },
        { creatorId: scopedExporter.id },
      );
      const createdHandedOff = await makeTicket(
        { customerName: "档主创建主管处理" },
        {
          creatorId: scopedExporter.id,
          status: "assigned",
          assigneeId: seeded.users.manager.id,
          assignedAt: new Date(),
        },
      );
      await makeTicket({ customerName: "别人的单" });

      const session = await sessionFor("scoped-exporter");
      const res = await exportRequest(session, { format: "csv" });
      expect(res.statusCode).toBe(200);

      const rows = parseCsv(res.body);
      expect(
        rows
          .slice(1)
          .map((cells) => cells[0])
          .sort(),
      ).toEqual([createdUnassigned.workOrderNumber, createdHandedOff.workOrderNumber].sort());
      expect(res.body).not.toContain("别人的单");
    });
  });

  describe("Excel (xlsx)", () => {
    it("round-trips through exceljs with the same rows the list returns", async () => {
      const urgent = await makeTicket({ complaintLevel: "特急投诉", customerName: "特急客户" });
      const normal = await makeTicket({ customerName: "普通客户" });

      const session = await sessionFor("manager");
      const res = await exportRequest(session, { format: "xlsx", sortBy: "createdAt" });
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toBe(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      expect(res.headers["content-disposition"]).toMatch(/attachment; filename="tickets-.*\.xlsx"/);

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(res.rawPayload as unknown as ArrayBuffer);
      const sheet = workbook.getWorksheet("工单");
      expect(sheet).toBeDefined();
      expect(sheet?.rowCount).toBe(3); // header + 2 tickets

      expect(sheet?.getRow(1).getCell(1).value).toBe("工单号");
      // createdAt desc: the later-created 普通客户 row comes first
      expect(sheet?.getRow(2).getCell(1).value).toBe(normal.workOrderNumber);
      expect(sheet?.getRow(3).getCell(1).value).toBe(urgent.workOrderNumber);

      const headerCells = (sheet?.getRow(1).values as Array<string | undefined>) ?? [];
      const levelColumn = headerCells.indexOf("投诉等级");
      expect(sheet?.getRow(3).getCell(levelColumn).value).toBe("特急投诉");
      const dueColumn = headerCells.indexOf("处理时限");
      expect(sheet?.getRow(3).getCell(dueColumn).value ?? "").toBe(""); // 特急: no dueAt
    });
  });

  describe("导出不产生 ProcessLog", () => {
    it("leaves the ProcessLog table untouched across both formats", async () => {
      await makeTicket();
      await makeTicket({ customerName: "第二单" });
      const before = await prisma.processLog.count();

      const session = await sessionFor("manager");
      await exportRequest(session, { format: "csv" });
      await exportRequest(session, { format: "xlsx" });

      expect(await prisma.processLog.count()).toBe(before);
    });
  });
});
