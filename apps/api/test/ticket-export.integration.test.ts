import type { Permission, TicketCreateInput } from "@insuredesk/shared";
import ExcelJS from "exceljs";
import type { FastifyInstance } from "fastify";
import JSZip from "jszip";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DEMO_PASSWORD } from "../prisma/seed-data.ts";
import { parseEnv } from "../src/env.ts";
import type { Prisma, PrismaClient, Role, User } from "../src/generated/prisma/client.ts";
import { appRouter } from "../src/routers/index.ts";
import { buildServer } from "../src/server.ts";
import { hashPassword } from "../src/services/auth.service.ts";
import { type IntegrationHarness, startIntegrationHarness } from "./integration-harness.ts";

const HOUR_MS = 60 * 60 * 1000;

describe("ticket export (Testcontainers)", () => {
  let harness: IntegrationHarness;
  let prisma: PrismaClient;
  let app: FastifyInstance;
  let seeded: IntegrationHarness["seeded"];
  let channelIds: Map<string, string>;
  let scopedExporter: User;
  let complaintKindId: string;
  let refundKindId: string;

  beforeAll(async () => {
    harness = await startIntegrationHarness({
      seed: ["rolesAndUsers", "slaPolicies", "channels"],
    });
    prisma = harness.prisma;
    seeded = harness.seeded;
    complaintKindId = (await prisma.ticketKind.findUniqueOrThrow({ where: { key: "complaint" } }))
      .id;
    refundKindId = (
      await prisma.ticketKind.findUniqueOrThrow({ where: { key: "refund_exception" } })
    ).id;

    baseInput = {
      feedbackTime: "2026-07-09T02:00:00.000Z",
      project: "融盛",
      brokerageEntity: "东方大地",
      paymentChannel: "连连支付",
      policyNumbers: ["P2026070900123"],
      userFeedbackChannelId: harness.userFeedbackChannelId("保司400热线"),
      customerName: "王小明",
      phone: "13800000000",
      customerRequest: "对保费收取金额有异议，要求核实并回复",
      nuclearBodyStatus: "待核实",
      hasContacted: false,
      slaPolicyId: harness.slaPolicyId("一般投诉"),
      allowDuplicate: true,
    };
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

  let baseInput: TicketCreateInput & { allowDuplicate?: boolean };

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

  async function splitCsvTexts(payload: Buffer): Promise<Map<string, string>> {
    const zip = await JSZip.loadAsync(payload);
    const texts = new Map<string, string>();
    for (const [name, file] of Object.entries(zip.files)) {
      texts.set(name.replace(/\.csv$/, ""), await file.async("string"));
    }
    return texts;
  }

  async function complaintCsvText(payload: Buffer): Promise<string> {
    const texts = await splitCsvTexts(payload);
    const text = texts.get("投诉");
    expect(text, "zip 内含投诉.csv").toBeDefined();
    return text ?? "";
  }

  const COMPLAINT_HEADER = [
    "工单号",
    "状态",
    "客户姓名",
    "客户电话",
    "联系电话",
    "保单号",
    "渠道",
    "时效策略",
    "分类",
    "优先级",
    "来源",
    "项目",
    "经纪主体",
    "支付渠道",
    "内部订单号",
    "用户反馈渠道",
    "反馈信息接收渠道",
    "客户诉求",
    "核体状态",
    "是否已联系",
    "进线时间",
    "联系ID",
    "责任人",
    "反馈时间",
    "创建时间",
    "分配时间",
    "处理时限",
    "下次联系时间",
    "联系次数",
    "跟进频次",
    "首响要求",
    "跟进记录",
    "完结时间",
    "完结状态",
  ];
  const REFUND_HEADER = [
    "工单号",
    "状态",
    "客户姓名",
    "客户电话",
    "联系电话",
    "时效策略",
    "来源",
    "责任人",
    "创建时间",
    "分配时间",
    "处理时限",
    "下次联系时间",
    "联系次数",
    "跟进频次",
    "首响要求",
    "跟进记录",
    "完结时间",
    "完结状态",
    "退费异常原因",
    "应退金额",
    "补偿金",
  ];

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

    it("旧 complaintLevel 查询参数返回 400 与明确校验错误", async () => {
      const session = await sessionFor("manager");
      const res = await exportRequest(session, { format: "csv", complaintLevel: "特急投诉" });
      expect(res.statusCode).toBe(400);
      expect(JSON.stringify(res.json().zodError)).toContain("投诉等级文本轨已下线");
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
      const complaint = await complaintCsvText(res.rawPayload);
      expect(complaint).toContain("支付客户");
      expect(complaint).toContain("监管客户");
      expect(complaint).not.toContain("保司客户");
    });

    it("source 缺省排除归档单；空值参数 = 不过滤、归档单随导出", async () => {
      await makeTicket({ customerName: "活跃客户" });
      await makeTicket({ customerName: "归档客户" }, { source: "file_import" });

      const session = await sessionFor("manager");
      const defaulted = await exportRequest(session, { format: "csv" });
      expect(defaulted.statusCode).toBe(200);
      const defaultedText = await complaintCsvText(defaulted.rawPayload);
      expect(defaultedText).toContain("活跃客户");
      expect(defaultedText).not.toContain("归档客户");

      // 与列表页"清空来源筛选"下传的标记一致：空值覆盖缺省
      const cleared = await exportRequest(session, { format: "csv", source: "" });
      expect(cleared.statusCode).toBe(200);
      expect(await complaintCsvText(cleared.rawPayload)).toContain("归档客户");

      const explicit = await exportRequest(session, { format: "csv", source: "file_import" });
      expect(explicit.statusCode).toBe(200);
      const explicitText = await complaintCsvText(explicit.rawPayload);
      expect(explicitText).toContain("归档客户");
      expect(explicitText).not.toContain("活跃客户");
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
      const complaint = await complaintCsvText(res.rawPayload);
      expect(complaint).toContain("起边界");
      expect(complaint).toContain("止边界");
      expect(complaint).not.toContain("区间前");
      expect(complaint).not.toContain("区间后");
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
      expect(res.headers["content-type"]).toBe("application/zip");
      expect(res.headers["content-disposition"]).toMatch(/attachment; filename="tickets-.*\.zip"/);

      const rows = parseCsv(await complaintCsvText(res.rawPayload));
      const header = rows[0];
      expect(header?.[0]).toBe("工单号");
      expect(header).toContain("状态");
      expect(header).toContain("时效策略");
      expect(header).not.toContain("投诉等级");
      expect(header).not.toContain("种类");
      expect(header).toContain("完结状态");

      const exportedNumbers = rows.slice(1).map((cells) => cells[0]);
      expect(exportedNumbers).toEqual(listed.items.map((item) => item.workOrderNumber));
      expect(exportedNumbers).toContain(payment1.workOrderNumber);
      expect(exportedNumbers).toContain(payment2.workOrderNumber);

      const body = await complaintCsvText(res.rawPayload);
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

      const rows = parseCsv(await complaintCsvText(res.rawPayload));
      const policyIndex = rows[0]?.indexOf("保单号") ?? -1;
      expect(policyIndex).toBeGreaterThan(-1);
      const cellByNumber = new Map(rows.slice(1).map((cells) => [cells[0], cells[policyIndex]]));
      expect(cellByNumber.get(multi.workOrderNumber)).toBe("PX-001 PX-002");
      expect(cellByNumber.get(blank.workOrderNumber)).toBe("");
    });

    it("「无保单号」工单导出 无，与未填写的空单元格区分", async () => {
      const none = await makeTicket({ policyNumbers: [], noPolicyNumber: true });
      const blank = await makeTicket({ policyNumbers: [] });

      const session = await sessionFor("manager");
      const res = await exportRequest(session, { format: "csv" });
      expect(res.statusCode).toBe(200);

      const rows = parseCsv(await complaintCsvText(res.rawPayload));
      const policyIndex = rows[0]?.indexOf("保单号") ?? -1;
      const cellByNumber = new Map(rows.slice(1).map((cells) => [cells[0], cells[policyIndex]]));
      expect(cellByNumber.get(none.workOrderNumber)).toBe("无");
      expect(cellByNumber.get(blank.workOrderNumber)).toBe("");
    });

    it("escapes fields containing commas and quotes per RFC 4180", async () => {
      await makeTicket({ customerRequest: '要求"全额退保", 并书面道歉' });

      const session = await sessionFor("manager");
      const res = await exportRequest(session, { format: "csv" });

      const rows = parseCsv(await complaintCsvText(res.rawPayload));
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

      const rows = parseCsv(await complaintCsvText(res.rawPayload));
      const statusColumn = rows[0]?.indexOf("状态") ?? -1;
      expect(rows[1]?.[statusColumn]).toBe("已超时");

      const filtered = await exportRequest(session, { format: "csv", status: "overdue" });
      expect(parseCsv(await complaintCsvText(filtered.rawPayload))).toHaveLength(2);
    });

    it("formats date columns in the requested IANA zone", async () => {
      await makeTicket({}, { createdAt: new Date("2026-07-09T16:30:00.000Z") });

      const session = await sessionFor("manager");
      const res = await exportRequest(session, {
        format: "csv",
        timeZone: "Asia/Shanghai",
      });

      const rows = parseCsv(await complaintCsvText(res.rawPayload));
      const createdColumn = rows[0]?.indexOf("创建时间") ?? -1;
      expect(rows[1]?.[createdColumn]).toBe("2026-07-10 00:30");

      // An invalid zone degrades to UTC instead of failing the download
      const fallback = await exportRequest(session, { format: "csv", timeZone: "Not/AZone" });
      expect(fallback.statusCode).toBe(200);
      const fallbackRows = parseCsv(await complaintCsvText(fallback.rawPayload));
      expect(fallbackRows[1]?.[createdColumn]).toBe("2026-07-09 16:30");
    });

    it("进线时间/反馈信息接收渠道 columns sit in their detail-page positions, dates in the requested zone", async () => {
      await makeTicket({
        contactTime: "2026-07-08T02:00:00.000Z",
        feedbackReceiveChannelId: harness.feedbackReceiveChannelId("内部客服热线"),
      });

      const session = await sessionFor("manager");
      const res = await exportRequest(session, { format: "csv", timeZone: "Asia/Shanghai" });
      expect(res.statusCode).toBe(200);

      const rows = parseCsv(await complaintCsvText(res.rawPayload));
      const header = rows[0] ?? [];
      expect(header.indexOf("反馈信息接收渠道")).toBe(header.indexOf("用户反馈渠道") + 1);
      expect(header.indexOf("进线时间")).toBe(header.indexOf("是否已联系") + 1);
      expect(header.indexOf("联系ID")).toBe(header.indexOf("进线时间") + 1);

      const row = rows[1] ?? [];
      expect(row[header.indexOf("反馈信息接收渠道")]).toBe("内部客服热线");
      expect(row[header.indexOf("用户反馈渠道")]).toBe("保司400热线");
      expect(row[header.indexOf("进线时间")]).toBe("2026-07-08 10:00");
    });
  });

  describe("按种类拆分导出", () => {
    async function makeRefundTicket() {
      const created = await makeTicket(
        { customerName: "退费客户" },
        { kindId: refundKindId, source: "jb-insurance" },
      );
      await prisma.ticketRefundDetail.create({
        data: {
          ticketId: created.id,
          platform: "jb-insurance",
          endorNo: "ENDOR-EXP-1",
          sysOrderId: "SO-EXP-1",
          workOrderType: "卡异常-退费失败",
          expectedAmount: "100.00",
          refundCreateTime: new Date("2026-08-24T08:40:00.000Z"),
          refundTrades: [{ tradeNo: "1", payNo: "PAY-EXP-1", expectedAmount: "100.00" }],
          holderName: "退费投保人",
          holderPhone: "13911112222",
          failureReason: "银行卡状态异常",
          compensationAmount: "20.50",
          pushedFields: ["sysOrderId"],
        },
      });
      return created;
    }

    it("csv 未锁定种类 → zip 双文件：各自列集、无种类列；退费客户姓名/电话取 holder 字段", async () => {
      const complaint = await makeTicket({ customerName: "投诉客户" });
      const refund = await makeRefundTicket();

      const session = await sessionFor("manager");
      const res = await exportRequest(session, { format: "csv" });
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toBe("application/zip");
      expect(res.headers["content-disposition"]).toMatch(/attachment; filename="tickets-.*\.zip"/);

      const files = await splitCsvTexts(res.rawPayload);
      expect([...files.keys()].sort()).toEqual(["投诉", "退费异常"].sort());

      const complaintRows = parseCsv(files.get("投诉") ?? "");
      const refundRows = parseCsv(files.get("退费异常") ?? "");
      const complaintHeader = complaintRows[0] ?? [];
      const refundHeader = refundRows[0] ?? [];
      expect(complaintHeader).toEqual(COMPLAINT_HEADER);
      expect(refundHeader).toEqual(REFUND_HEADER);

      expect(complaintRows.slice(1).map((cells) => cells[0])).toEqual([complaint.workOrderNumber]);
      expect(refundRows).toHaveLength(2);
      const refundRow = refundRows[1] ?? [];
      expect(refundRow[0]).toBe(refund.workOrderNumber);
      expect(refundRow[refundHeader.indexOf("客户姓名")]).toBe("退费投保人");
      expect(refundRow[refundHeader.indexOf("客户电话")]).toBe("13911112222");
      expect(refundRow[refundHeader.indexOf("退费异常原因")]).toBe("银行卡状态异常");
      expect(refundRow[refundHeader.indexOf("应退金额")]).toBe("100.00");
      expect(refundRow[refundHeader.indexOf("补偿金")]).toBe("20.50");
    });

    it("未锁定种类时某一类为空仍输出双 sheet/双文件（拆分不依赖结果集）", async () => {
      await makeTicket({ customerName: "只有投诉" });

      const session = await sessionFor("manager");
      const csv = await exportRequest(session, { format: "csv" });
      const files = await splitCsvTexts(csv.rawPayload);
      expect([...files.keys()].sort()).toEqual(["投诉", "退费异常"].sort());
      expect(parseCsv(files.get("退费异常") ?? "")).toHaveLength(1);

      const xlsx = await exportRequest(session, { format: "xlsx" });
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(xlsx.rawPayload as unknown as ArrayBuffer);
      expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["投诉", "退费异常"]);
      expect(workbook.getWorksheet("退费异常")?.rowCount).toBe(1);
    });

    it("无行为绑定的第三种类行归投诉 sheet", async () => {
      const thirdKind = await prisma.ticketKind.create({
        data: { key: `custom-${Date.now()}`, name: "自定义种类" },
      });
      const third = await makeTicket({ customerName: "三类客户" }, { kindId: thirdKind.id });
      await makeRefundTicket();

      const session = await sessionFor("manager");
      const res = await exportRequest(session, { format: "csv" });
      const files = await splitCsvTexts(res.rawPayload);
      const complaintText = files.get("投诉") ?? "";
      expect(complaintText).toContain(third.workOrderNumber);
      expect(files.get("退费异常")).not.toContain(third.workOrderNumber);
      expect(parseCsv(complaintText)[0]).not.toContain("退费异常原因");
    });

    it("kindId 锁单一种类 → 直接出单文件：退费锁出退费列集，投诉锁出投诉列集", async () => {
      const complaint = await makeTicket({ customerName: "投诉客户" });
      const refund = await makeRefundTicket();

      const session = await sessionFor("manager");
      const refundOnly = await exportRequest(session, { format: "csv", kindId: refundKindId });
      expect(refundOnly.statusCode).toBe(200);
      expect(refundOnly.headers["content-type"]).toContain("text/csv");
      expect(refundOnly.headers["content-disposition"]).toMatch(
        /attachment; filename="tickets-.*\.csv"/,
      );
      const refundRows = parseCsv(refundOnly.body);
      const refundHeader = refundRows[0] ?? [];
      expect(refundHeader).toContain("退费异常原因");
      expect(refundHeader).toContain("应退金额");
      expect(refundHeader).toContain("补偿金");
      expect(refundHeader).not.toContain("种类");
      expect(refundRows[1]?.[0]).toBe(refund.workOrderNumber);
      expect(refundOnly.body).not.toContain("投诉客户");

      const complaintOnly = await exportRequest(session, {
        format: "csv",
        kindId: complaintKindId,
      });
      expect(complaintOnly.headers["content-type"]).toContain("text/csv");
      const complaintRows = parseCsv(complaintOnly.body);
      expect(complaintRows[0]).not.toContain("退费异常原因");
      expect(complaintRows[0]).not.toContain("种类");
      expect(complaintRows[1]?.[0]).toBe(complaint.workOrderNumber);
      expect(complaintOnly.body).not.toContain("退费客户");
    });

    it("单 kind 判定按请求 kindId 而非结果集：锁定退费但无退费行仍出退费单文件", async () => {
      await makeTicket({ customerName: "投诉客户" });

      const session = await sessionFor("manager");
      const res = await exportRequest(session, { format: "csv", kindId: refundKindId });
      expect(res.headers["content-type"]).toContain("text/csv");
      const rows = parseCsv(res.body);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toContain("应退金额");
    });

    it("kindId 多选 = 未锁定 → 仍 zip 双文件", async () => {
      await makeTicket({ customerName: "投诉客户" });

      const session = await sessionFor("manager");
      const res = await exportRequest(session, {
        format: "csv",
        kindId: `${complaintKindId},${refundKindId}`,
      });
      expect(res.headers["content-type"]).toBe("application/zip");
      const files = await splitCsvTexts(res.rawPayload);
      expect([...files.keys()].sort()).toEqual(["投诉", "退费异常"].sort());
    });

    it("xlsx 锁单一种类 → 单 sheet 文件，sheet 名取种类名，客户姓名/电话取 holder 字段", async () => {
      await makeRefundTicket();

      const session = await sessionFor("manager");
      const res = await exportRequest(session, { format: "xlsx", kindId: refundKindId });
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-disposition"]).toMatch(/attachment; filename="tickets-.*\.xlsx"/);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(res.rawPayload as unknown as ArrayBuffer);
      expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["退费异常"]);
      const sheet = workbook.getWorksheet("退费异常");
      const header = (sheet?.getRow(1).values as Array<string | undefined>) ?? [];
      expect(header.slice(1)).toEqual(REFUND_HEADER);
      const nameColumn = header.indexOf("客户姓名");
      const phoneColumn = header.indexOf("客户电话");
      expect(sheet?.getRow(2).getCell(nameColumn).value).toBe("退费投保人");
      expect(sheet?.getRow(2).getCell(phoneColumn).value).toBe("13911112222");
    });

    it("种类名被管理员改成 Excel 非法字符时，xlsx sheet 名消毒而非 500", async () => {
      await prisma.ticketKind.update({
        where: { id: complaintKindId },
        data: { name: "投诉[旧]?" },
      });
      try {
        const session = await sessionFor("manager");
        const res = await exportRequest(session, { format: "xlsx" });
        expect(res.statusCode).toBe(200);
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(res.rawPayload as unknown as ArrayBuffer);
        expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["投诉旧", "退费异常"]);
      } finally {
        await prisma.ticketKind.update({ where: { id: complaintKindId }, data: { name: "投诉" } });
      }
    });

    it("种类名消毒后撞 fallback 时，sheet/zip 名加后缀分配而非 500 或静默覆盖", async () => {
      await prisma.ticketKind.update({ where: { id: complaintKindId }, data: { name: "Sheet2" } });
      await prisma.ticketKind.update({ where: { id: refundKindId }, data: { name: "///" } });
      try {
        const session = await sessionFor("manager");
        const xlsx = await exportRequest(session, { format: "xlsx" });
        expect(xlsx.statusCode).toBe(200);
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(xlsx.rawPayload as unknown as ArrayBuffer);
        expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Sheet2", "Sheet2 (2)"]);

        const csv = await exportRequest(session, { format: "csv" });
        expect(csv.statusCode).toBe(200);
        const files = await splitCsvTexts(csv.rawPayload);
        expect([...files.keys()].sort()).toEqual(["Sheet2", "Sheet2 (2)"].sort());
      } finally {
        await prisma.ticketKind.update({ where: { id: complaintKindId }, data: { name: "投诉" } });
        await prisma.ticketKind.update({ where: { id: refundKindId }, data: { name: "退费异常" } });
      }
    });

    it("种类名仅大小写不同也加后缀（ExcelJS 唯一性比较大小写不敏感）", async () => {
      await prisma.ticketKind.update({ where: { id: complaintKindId }, data: { name: "abc" } });
      await prisma.ticketKind.update({ where: { id: refundKindId }, data: { name: "ABC" } });
      try {
        const session = await sessionFor("manager");
        const res = await exportRequest(session, { format: "xlsx" });
        expect(res.statusCode).toBe(200);
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(res.rawPayload as unknown as ArrayBuffer);
        expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["abc", "ABC (2)"]);

        const csv = await exportRequest(session, { format: "csv" });
        expect(csv.statusCode).toBe(200);
        const files = await splitCsvTexts(csv.rawPayload);
        expect([...files.keys()].sort()).toEqual(["abc", "ABC (2)"].sort());
      } finally {
        await prisma.ticketKind.update({ where: { id: complaintKindId }, data: { name: "投诉" } });
        await prisma.ticketKind.update({ where: { id: refundKindId }, data: { name: "退费异常" } });
      }
    });
  });

  describe("跟进记录列 (读时拼接全量 comment)", () => {
    it("列头为跟进记录, 位于首响要求之后、完结时间之前; 无跟进的工单为空单元格", async () => {
      await makeTicket({ customerName: "无跟进客户" });

      const session = await sessionFor("manager");
      const res = await exportRequest(session, { format: "csv" });
      expect(res.statusCode).toBe(200);

      const rows = parseCsv(await complaintCsvText(res.rawPayload));
      const header = rows[0] ?? [];
      expect(header).not.toContain("处理结果");
      const followUpColumn = header.indexOf("跟进记录");
      expect(followUpColumn).toBeGreaterThan(-1);
      expect(followUpColumn).toBe(header.indexOf("首响要求") + 1);
      expect(header.indexOf("完结时间")).toBe(followUpColumn + 1);

      expect(rows[1]?.[followUpColumn]).toBe("");
    });

    it("拼接全部 comment 跟进: 按 at 升序、每行 [yyyy-MM-dd HH:mm] 姓名：内容, 含 internalOnly, 不含完结备注", async () => {
      const ticket = await makeTicket({ customerName: "多跟进客户" });
      await prisma.processLog.createMany({
        data: [
          {
            ticketId: ticket.id,
            action: "comment",
            remark: "第二次联系，客户接受方案",
            operatorId: seeded.users.manager.id,
            operatorName: seeded.users.manager.name,
            internalOnly: true,
            at: new Date("2026-07-10T02:00:00.000Z"),
          },
          {
            ticketId: ticket.id,
            action: "comment",
            remark: "首次联系，核对扣费明细",
            operatorId: seeded.users.cs1.id,
            operatorName: seeded.users.cs1.name,
            at: new Date("2026-07-09T06:00:00.000Z"),
          },
          {
            ticketId: ticket.id,
            action: "resolve",
            remark: "完结备注不属于跟进记录",
            operatorId: seeded.users.manager.id,
            operatorName: seeded.users.manager.name,
            at: new Date("2026-07-11T02:00:00.000Z"),
          },
        ],
      });

      const session = await sessionFor("manager");
      const res = await exportRequest(session, {
        format: "csv",
        timeZone: "Asia/Shanghai",
      });
      expect(res.statusCode).toBe(200);

      const rows = parseCsv(await complaintCsvText(res.rawPayload));
      const followUpColumn = (rows[0] ?? []).indexOf("跟进记录");
      expect(followUpColumn).toBeGreaterThan(-1);
      expect(rows[1]?.[followUpColumn]).toBe(
        `[2026-07-09 14:00] ${seeded.users.cs1.name}：首次联系，核对扣费明细\n` +
          `[2026-07-10 10:00] ${seeded.users.manager.name}：第二次联系，客户接受方案`,
      );
    });
  });

  describe("数据范围", () => {
    it("个人档只能导出本人名下 — no ticket.view_all pins the export to own tickets", async () => {
      await makeTicket({ customerName: "无人认领" });
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

      const text = await complaintCsvText(res.rawPayload);
      const rows = parseCsv(text);
      expect(rows).toHaveLength(2);
      expect(rows[1]?.[0]).toBe(own.workOrderNumber);
      expect(text).not.toContain("无人认领");
      expect(text).not.toContain("主管的单");
    });

    it("filters stay inside the exporter's scope, never widen it", async () => {
      await makeTicket({ channelId: channelId("支付"), customerName: "别人的支付单" });
      const own = await makeTicket(
        { channelId: channelId("支付"), customerName: "自己的支付单" },
        { status: "assigned", assigneeId: scopedExporter.id },
      );

      const session = await sessionFor("scoped-exporter");
      const res = await exportRequest(session, { format: "csv", channelId: channelId("支付") });

      const rows = parseCsv(await complaintCsvText(res.rawPayload));
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

      const text = await complaintCsvText(res.rawPayload);
      const rows = parseCsv(text);
      expect(
        rows
          .slice(1)
          .map((cells) => cells[0])
          .sort(),
      ).toEqual([createdUnassigned.workOrderNumber, createdHandedOff.workOrderNumber].sort());
      expect(text).not.toContain("别人的单");
    });
  });

  describe("Excel (xlsx)", () => {
    it("双 sheet 各自列集：投诉 sheet 与列表同序，退费 sheet 独立列集", async () => {
      const urgent = await makeTicket({
        slaPolicyId: harness.slaPolicyId("特急投诉"),
        customerName: "特急客户",
      });
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
      expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["投诉", "退费异常"]);

      const sheet = workbook.getWorksheet("投诉");
      expect(sheet).toBeDefined();
      expect(sheet?.rowCount).toBe(3);

      expect(sheet?.getRow(1).getCell(1).value).toBe("工单号");
      expect(sheet?.getRow(2).getCell(1).value).toBe(normal.workOrderNumber);
      expect(sheet?.getRow(3).getCell(1).value).toBe(urgent.workOrderNumber);

      const headerCells = (sheet?.getRow(1).values as Array<string | undefined>) ?? [];
      expect(headerCells.slice(1)).toEqual(COMPLAINT_HEADER);
      const policyColumn = headerCells.indexOf("时效策略");
      expect(policyColumn).toBeGreaterThan(-1);
      expect(sheet?.getRow(3).getCell(policyColumn).value).toBe("特急投诉");
      expect(sheet?.getRow(2).getCell(policyColumn).value).toBe("一般投诉");
      const dueColumn = headerCells.indexOf("处理时限");
      expect(sheet?.getRow(3).getCell(dueColumn).value ?? "").toBe("");

      const refundHeader =
        (workbook.getWorksheet("退费异常")?.getRow(1).values as Array<string | undefined>) ?? [];
      expect(refundHeader.slice(1)).toEqual(REFUND_HEADER);
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
