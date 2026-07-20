import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TICKET_IMPORT_HEADERS as HEADERS, type Permission } from "@insuredesk/shared";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import ExcelJS from "exceljs";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient, Role, User } from "../src/generated/prisma/client";

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const HOUR_MS = 60 * 60 * 1000;

/**
 * Acceptance tests for 批量导入 upload over the real HTTP surface:
 *
 * - guard order mirrors 模板下载: 401 unauthenticated, 403 without ticket.import
 * - a valid file creates the whole batch with manual-creation semantics
 *   (source=file_import, creatorId=导入者, unassigned, SLA snapshot from the
 *   import instant, per-ticket create ProcessLog, batch bookkeeping row)
 * - the importer's requiredTicketFields do NOT gate the file契约
 * - any row error → 整批零入库 with the 行号/列名/原因 list
 * - file-level gates: header mismatch, zero rows, row limit, size limit
 * - the imported tickets surface through the importer's own data scope, the
 *   source filter, and the export's 来源 column
 * - rows with the 完结状态/完结备注 pair land directly completed (历史工单
 *   迁移): completionTime = the import instant, no assignee, SLA stamped as
 *   usual, create + resolve logs and no status_change — still only
 *   ticket.import, never ticket.process
 */
describe("ticket import upload (Testcontainers)", () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let app: FastifyInstance;
  let appRouter: typeof import("../src/routers/index").appRouter;
  let demoPassword: string;
  let importerUser: User;
  let importerRole: Role;
  let channelName: string;
  let categoryName: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17-alpine").start();
    const databaseUrl = container.getConnectionUri();

    execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
      cwd: apiDir,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "pipe",
    });
    process.env.DATABASE_URL = databaseUrl;

    const [{ prisma: appPrisma }, seedData, { parseEnv }, { buildServer }, routers, auth] =
      await Promise.all([
        import("../src/db"),
        import("../prisma/seed-data"),
        import("../src/env"),
        import("../src/server"),
        import("../src/routers/index"),
        import("../src/services/auth.service"),
      ]);
    prisma = appPrisma;
    appRouter = routers.appRouter;
    demoPassword = seedData.DEMO_PASSWORD;

    await seedData.seedFactoryRolesAndDemoUsers(prisma);
    await seedData.seedSlaPolicies(prisma);
    const channels = await seedData.seedChannels(prisma);
    const categories = await seedData.seedTicketCategories(prisma);
    channelName = channels.find((channel) => channel.active)?.name as string;
    categoryName = categories.find((category) => category.active)?.name as string;

    // requiredTicketFields deliberately non-empty: the import contract is
    // 全字段可空 regardless of who uploads.
    importerRole = await prisma.role.create({
      data: {
        name: "导入员",
        permissions: ["ticket.view", "ticket.import"],
        requiredTicketFields: ["customerName", "complaintLevel"],
      },
    });
    importerUser = await prisma.user.create({
      data: {
        username: "importer",
        name: "导入员一号",
        email: "importer@example.com",
        roleId: importerRole.id,
        passwordHash: await auth.hashPassword(seedData.DEMO_PASSWORD),
        active: true,
      },
    });

    const env = parseEnv({
      DATABASE_URL: databaseUrl,
      SESSION_SECRET: "insuredesk-ticket-import-test-secret-1",
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
    });
    app = buildServer(env);
    await app.ready();
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
    await container?.stop();
  });

  beforeEach(async () => {
    await prisma.ticket.deleteMany();
    await prisma.ticketImportBatch.deleteMany();
  });

  type RowInput = Partial<Record<string, string | Date>>;

  async function buildFile(
    rows: RowInput[],
    headers: readonly string[] = HEADERS,
  ): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("工单");
    sheet.addRow(headers);
    for (const row of rows) {
      sheet.addRow(HEADERS.map((header) => row[header] ?? ""));
    }
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  async function sessionFor(username: string): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username, password: demoPassword },
    });
    const cookie = res.cookies.find((c) => c.name === "session");
    expect(cookie, `login as ${username}`).toBeDefined();
    return String(cookie?.value);
  }

  function uploadRequest(
    session: string | null,
    file: Buffer,
    {
      filename = "工单导入.xlsx",
      timeZone = "Asia/Shanghai",
    }: { filename?: string; timeZone?: string } = {},
  ) {
    const boundary = "insuredesk-import-test-boundary";
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\ncontent-disposition: form-data; name="timeZone"\r\n\r\n${timeZone}\r\n`,
      ),
      Buffer.from(
        `--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="${filename}"\r\n` +
          `content-type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`,
      ),
      file,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return app.inject({
      method: "POST",
      url: "/api/tickets/import",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      payload,
      ...(session ? { cookies: { session } } : {}),
    });
  }

  function importerCaller() {
    return appRouter.createCaller({
      traceId: "ticket-import-test",
      user: {
        id: importerUser.id,
        username: importerUser.username,
        name: importerUser.name,
        email: importerUser.email,
        roleId: importerRole.id,
        roleName: importerRole.name,
        permissions: importerRole.permissions as Permission[],
        requiredTicketFields: importerRole.requiredTicketFields,
      },
      sessionToken: null,
    });
  }

  it("401 without a session, 403 without ticket.import", async () => {
    const file = await buildFile([{ 客户姓名: "张三" }]);
    expect((await uploadRequest(null, file)).statusCode).toBe(401);

    const manager = await sessionFor("manager");
    const forbidden = await uploadRequest(manager, file);
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json().error).toContain("ticket.import");
    expect(await prisma.ticket.count()).toBe(0);
  });

  it("imports a valid file with manual-creation semantics, all in one batch", async () => {
    const session = await sessionFor("importer");
    const res = await uploadRequest(
      session,
      await buildFile([
        {
          反馈时间: "2026-07-01 10:00",
          反馈渠道: channelName,
          "项目（保司）": "融盛",
          保单号: "P202607010001",
          投诉信息接收渠道: "监管转办",
          客户姓名: "张三",
          保司侧是否核身: "待核实",
          客户曾进线: "是",
          进线时间: "2026-06-30 21:15",
          客诉类别: categoryName,
          投诉等级: "高级投诉",
          优先级: "紧急",
        },
        // 未定级、无客户姓名 — the importer role's requiredTicketFields
        // (customerName/complaintLevel) must NOT apply to file rows
        { 保单号: "P202607010002" },
      ]),
    );
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ imported: 2 });

    const tickets = await prisma.ticket.findMany({ orderBy: { policyNumber: "asc" } });
    expect(tickets).toHaveLength(2);
    const [leveled, unleveled] = tickets as [(typeof tickets)[0], (typeof tickets)[0]];

    for (const ticket of tickets) {
      expect(ticket.source).toBe("file_import");
      expect(ticket.creatorId).toBe(importerUser.id);
      expect(ticket.status).toBe("unassigned");
      expect(ticket.importBatchId).not.toBeNull();
      expect(ticket.workOrderNumber).toMatch(/^WO\d{6,}$/);
    }
    // 同一事务、同一导入时刻
    expect(leveled.createdAt.getTime()).toBe(unleveled.createdAt.getTime());

    // 反馈时间 wall clock interpreted in Asia/Shanghai
    expect(leveled.feedbackTime?.toISOString()).toBe("2026-07-01T02:00:00.000Z");
    expect(leveled.contactTime?.toISOString()).toBe("2026-06-30T13:15:00.000Z");
    expect(leveled.complaintReceiveChannel).toBe("监管转办");
    expect(leveled.nuclearBodyStatus).toBe("待核实");
    expect(leveled.hasContacted).toBe(true);
    expect(leveled.priority).toBe("urgent");
    expect(leveled.channelId).not.toBeNull();
    expect(leveled.categoryId).not.toBeNull();

    // SLA 快照自导入时刻起算；未定级行全空
    const policy = await prisma.slaPolicy.findUniqueOrThrow({
      where: { complaintLevel: "高级投诉" },
    });
    expect(leveled.dueAt?.getTime()).toBe(
      leveled.createdAt.getTime() + (policy.overdueHours as number) * HOUR_MS,
    );
    expect(leveled.followUpFrequency).not.toBeNull();
    expect(leveled.firstResponseRequirement).not.toBeNull();
    expect(unleveled.dueAt).toBeNull();
    expect(unleveled.followUpFrequency).toBeNull();
    expect(unleveled.firstResponseRequirement).toBeNull();

    // 批次留底：导入人/时刻/行数/文件名
    const batch = await prisma.ticketImportBatch.findFirstOrThrow();
    expect(batch.importerId).toBe(importerUser.id);
    expect(batch.rowCount).toBe(2);
    expect(batch.filename).toBe("工单导入.xlsx");
    expect(batch.importedAt.getTime()).toBe(leveled.createdAt.getTime());
    expect(leveled.importBatchId).toBe(batch.id);
    expect(unleveled.importBatchId).toBe(batch.id);

    // 每单一条 create ProcessLog，remark 导入创建
    const logs = await prisma.processLog.findMany({
      where: { ticketId: { in: tickets.map((ticket) => ticket.id) } },
    });
    expect(logs).toHaveLength(2);
    for (const log of logs) {
      expect(log.action).toBe("create");
      expect(log.remark).toBe("导入创建");
      expect(log.operatorId).toBe(importerUser.id);
      expect(log.operatorName).toBe("导入员一号");
    }
  });

  it("lands both-filled 完结 rows as completed, both-empty rows as unassigned, in one batch", async () => {
    const completionStatus = await prisma.completionStatus.findFirstOrThrow({
      where: { name: "已达成一致", active: true },
    });
    const otherStatus = await prisma.completionStatus.findFirstOrThrow({
      where: { name: "已赔付", active: true },
    });
    const session = await sessionFor("importer");
    const res = await uploadRequest(
      session,
      await buildFile([
        {
          客户姓名: "迁移客户",
          投诉等级: "高级投诉",
          完结状态: "已达成一致",
          完结备注: "历史工单迁移，电话回访已确认",
        },
        // 第二条完结行：状态与备注都不同，钉死逐行配对（错位会窜备注/窜目录）
        { 客户姓名: "迁移客户乙", 完结状态: "已赔付", 完结备注: "迁移备注乙" },
        { 客户姓名: "新客户" },
      ]),
    );
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ imported: 3 });

    const batch = await prisma.ticketImportBatch.findFirstOrThrow();
    const completed = await prisma.ticket.findFirstOrThrow({
      where: { customerName: "迁移客户" },
    });
    const unassigned = await prisma.ticket.findFirstOrThrow({
      where: { customerName: "新客户" },
    });

    // 完结行落地即终态：完结时间=导入时刻、目录引用正确、无责任人
    expect(completed.status).toBe("completed");
    expect(completed.completionTime?.getTime()).toBe(batch.importedAt.getTime());
    expect(completed.completionStatusId).toBe(completionStatus.id);
    expect(completed.assigneeId).toBeNull();
    expect(completed.assignedAt).toBeNull();

    // SLA 照常按投诉等级盖章
    const policy = await prisma.slaPolicy.findUniqueOrThrow({
      where: { complaintLevel: "高级投诉" },
    });
    expect(completed.dueAt?.getTime()).toBe(
      batch.importedAt.getTime() + (policy.overdueHours as number) * HOUR_MS,
    );
    expect(completed.followUpFrequency).not.toBeNull();

    // 两列都空的行照旧落未分配
    expect(unassigned.status).toBe("unassigned");
    expect(unassigned.completionTime).toBeNull();
    expect(unassigned.completionStatusId).toBeNull();

    // 第二条完结行拿到自己的目录引用与备注，不与第一条窜行
    const otherCompleted = await prisma.ticket.findFirstOrThrow({
      where: { customerName: "迁移客户乙" },
    });
    expect(otherCompleted.status).toBe("completed");
    expect(otherCompleted.completionStatusId).toBe(otherStatus.id);
    const otherResolve = await prisma.processLog.findFirstOrThrow({
      where: { ticketId: otherCompleted.id, action: "resolve" },
    });
    expect(otherResolve.remark).toBe("迁移备注乙");

    // 完结行时间线 = create + resolve（同导入瞬间、完结备注可见），无 status_change
    const timeline = await prisma.processLog.findMany({
      where: { ticketId: completed.id },
      orderBy: [{ at: "asc" }, { id: "asc" }],
    });
    expect(timeline.map((log) => log.action)).toEqual(["create", "resolve"]);
    const [create, resolve] = timeline as [(typeof timeline)[0], (typeof timeline)[0]];
    expect(create.remark).toBe("导入创建");
    expect(resolve.remark).toBe("历史工单迁移，电话回访已确认");
    expect(resolve.operatorId).toBe(importerUser.id);
    expect(resolve.operatorName).toBe("导入员一号");
    expect(resolve.at.getTime()).toBe(batch.importedAt.getTime());

    // 未完结行只有 create
    const unassignedLogs = await prisma.processLog.findMany({
      where: { ticketId: unassigned.id },
    });
    expect(unassignedLogs.map((log) => log.action)).toEqual(["create"]);
  });

  it("rejects 半填/不存在/已停用/超长 完结 cells row by row, importing nothing", async () => {
    await prisma.completionStatus.create({
      data: { name: "停用完结X", active: false, displayOrder: 90 },
    });
    const session = await sessionFor("importer");
    const res = await uploadRequest(
      session,
      await buildFile([
        { 客户姓名: "只填状态", 完结状态: "已达成一致" }, // row 2: half-filled
        { 客户姓名: "只填备注", 完结备注: "备注" }, // row 3: half-filled
        { 完结状态: "没有这个状态", 完结备注: "x" }, // row 4
        { 完结状态: "停用完结X", 完结备注: "x" }, // row 5
        { 完结状态: "已达成一致", 完结备注: "字".repeat(2001) }, // row 6
      ]),
    );
    expect(res.statusCode).toBe(400);
    const body = res.json() as {
      rowErrors: Array<{ row: number | null; column: string | null; message: string }>;
    };
    expect(body.rowErrors).toHaveLength(5);
    expect(body.rowErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          row: 2,
          column: null,
          message: expect.stringContaining("同时填写或同时留空"),
        }),
        expect.objectContaining({ row: 3, column: null }),
        expect.objectContaining({
          row: 4,
          column: "完结状态",
          message: expect.stringContaining("不存在"),
        }),
        expect.objectContaining({
          row: 5,
          column: "完结状态",
          message: expect.stringContaining("已停用"),
        }),
        expect.objectContaining({
          row: 6,
          column: "完结备注",
          message: expect.stringContaining("2000"),
        }),
      ]),
    );

    // 整批零入库
    expect(await prisma.ticket.count()).toBe(0);
    expect(await prisma.ticketImportBatch.count()).toBe(0);
  });

  it("imported tickets reach the importer's own data scope, source filter, and detail 由谁创建", async () => {
    const session = await sessionFor("importer");
    expect((await uploadRequest(session, await buildFile([{ 客户姓名: "李四" }]))).statusCode).toBe(
      200,
    );

    // ticket.view without view_all — the importer sees the ticket as its creator
    const caller = importerCaller();
    const list = await caller.ticket.list({ source: "file_import" });
    expect(list.total).toBe(1);
    expect(list.items[0]?.source).toBe("file_import");

    const detail = await caller.ticket.detail({ id: list.items[0]?.id as string });
    expect(detail.createdBy).toBe("导入员一号");
    expect(detail.source).toBe("file_import");
  });

  it("exports imported tickets with 来源=文件导入", async () => {
    const session = await sessionFor("importer");
    expect((await uploadRequest(session, await buildFile([{ 客户姓名: "王五" }]))).statusCode).toBe(
      200,
    );

    const admin = await sessionFor("admin");
    const res = await app.inject({
      method: "GET",
      url: "/api/tickets/export?format=csv&source=file_import",
      cookies: { session: admin },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("文件导入");
    expect(res.body).toContain("王五");
  });

  it("rejects the whole batch on any row error, listing 行号/列名/原因", async () => {
    await prisma.ticketCategory.create({
      data: { name: "停用类别X", active: false, displayOrder: 90 },
    });
    const session = await sessionFor("importer");
    const res = await uploadRequest(
      session,
      await buildFile([
        { 客户姓名: "合法行" }, // row 2: valid — must still not be imported
        { 反馈渠道: "没有这个渠道" }, // row 3
        { 客诉类别: "停用类别X" }, // row 4
        { 投诉等级: "特级投诉" }, // row 5
        { 反馈时间: "2026/07/01" }, // row 6
        { 客户姓名: "重".repeat(101) }, // row 7
        { 客户姓名: "重复行", 保单号: "P1" }, // row 8
        { 客户姓名: "重复行", 保单号: "P1" }, // row 9: duplicate of 8
        { 进线时间: "昨天上午" }, // row 10
        { 投诉信息接收渠道: "长".repeat(101) }, // row 11
      ]),
    );
    expect(res.statusCode).toBe(400);
    const body = res.json() as {
      error: string;
      rowErrors: Array<{ row: number | null; column: string | null; message: string }>;
    };
    expect(body.rowErrors).toHaveLength(8);
    expect(body.rowErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ row: 3, column: "反馈渠道" }),
        expect.objectContaining({ row: 4, column: "客诉类别" }),
        expect.objectContaining({ row: 5, column: "投诉等级" }),
        expect.objectContaining({ row: 6, column: "反馈时间" }),
        expect.objectContaining({ row: 7, column: "客户姓名" }),
        expect.objectContaining({ row: 9, column: null }),
        expect.objectContaining({ row: 10, column: "进线时间" }),
        expect.objectContaining({ row: 11, column: "投诉信息接收渠道" }),
      ]),
    );

    // 整批零入库
    expect(await prisma.ticket.count()).toBe(0);
    expect(await prisma.ticketImportBatch.count()).toBe(0);
  });

  it("rejects header mismatch, zero data rows, over-limit rows, and oversized files", async () => {
    const session = await sessionFor("importer");

    const renamed = [...HEADERS];
    renamed[0] = "时间";
    const headerRes = await uploadRequest(session, await buildFile([{ 客户姓名: "x" }], renamed));
    expect(headerRes.statusCode).toBe(400);
    expect(headerRes.json().rowErrors[0].message).toContain("表头与模板不符");

    // 缺列的旧模板文件整批拒收并指认第一处不符列，提示重新下载而非静默兼容
    const legacyHeaders = HEADERS.filter(
      (header) => header !== "投诉信息接收渠道" && header !== "进线时间",
    );
    const legacy = await uploadRequest(
      session,
      await buildFile([{ 客户姓名: "x" }], legacyHeaders),
    );
    expect(legacy.statusCode).toBe(400);
    const mismatchColumn = HEADERS.indexOf("投诉信息接收渠道") + 1;
    expect(legacy.json().rowErrors[0].message).toContain(
      `第 ${mismatchColumn} 列应为「投诉信息接收渠道」`,
    );
    expect(legacy.json().rowErrors[0].message).toContain("请重新下载模板");

    const emptyRes = await uploadRequest(session, await buildFile([]));
    expect(emptyRes.statusCode).toBe(400);
    expect(emptyRes.json().rowErrors[0].message).toContain("没有可导入的数据行");

    const tooMany = Array.from({ length: 2001 }, (_, i) => ({ 客户姓名: `客户${i}` }));
    const overLimitRes = await uploadRequest(session, await buildFile(tooMany));
    expect(overLimitRes.statusCode).toBe(400);
    expect(overLimitRes.json().rowErrors[0].message).toContain("2000");

    const oversized = Buffer.alloc(2 * 1024 * 1024 + 1024, 1);
    const oversizedRes = await uploadRequest(session, oversized);
    expect(oversizedRes.statusCode).toBe(400);
    // File-level gate before parsing: the message rides in `error`, no row list
    expect(oversizedRes.json().error).toContain("2MB");
    expect(oversizedRes.json().rowErrors).toEqual([]);

    expect(await prisma.ticket.count()).toBe(0);
  });

  it("imports the full 2000-row limit in one transaction", async () => {
    const session = await sessionFor("importer");
    const rows = Array.from({ length: 2000 }, (_, i) => ({
      客户姓名: `批量客户${i}`,
      投诉等级: "一般投诉",
    }));
    const res = await uploadRequest(session, await buildFile(rows));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ imported: 2000 });
    expect(await prisma.ticket.count()).toBe(2000);
    expect(await prisma.processLog.count()).toBe(2000);
    const batch = await prisma.ticketImportBatch.findFirstOrThrow();
    expect(batch.rowCount).toBe(2000);
  });
});
