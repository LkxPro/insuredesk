import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Permission } from "@insuredesk/shared";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient, User } from "../src/generated/prisma/client";

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Acceptance tests for 导入历史 + 整批撤销 against a real Postgres, through
 * appRouter.createCaller (permission middleware included):
 *
 * - history scope: own batches by default, every batch with ticket.view_all;
 *   listing gated on ticket.import
 * - clean revoke: all-or-nothing soft delete — tickets leave the list, the
 *   dashboard, and the export; the batch stays in history as 已撤销 with
 *   revoker + instant
 * - locked: any ticket processed (assign/edit/…) or individually deleted →
 *   the whole revoke is rejected with the processed count, nothing deleted,
 *   and the batch lists as locked
 * - guards: no ticket.delete → FORBIDDEN; out-of-scope batch → NOT_FOUND;
 *   a revoked batch can never be revoked again
 */
describe("ticket import history & batch revocation (Testcontainers)", () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let appRouter: typeof import("../src/routers/index").appRouter;
  let importTickets: typeof import("../src/services/ticket-import.service").importTickets;
  let exportTickets: typeof import("../src/services/ticket-export.service").exportTickets;
  let importer: User;
  let supervisor: User;
  let deleterNoViewAll: User;

  const deps = () => ({ prisma, clock: { now: () => new Date() } });

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17-alpine").start();
    const databaseUrl = container.getConnectionUri();

    execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
      cwd: apiDir,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "pipe",
    });
    process.env.DATABASE_URL = databaseUrl;

    const [{ prisma: appPrisma }, seedData, routers, importService, exportService] =
      await Promise.all([
        import("../src/db"),
        import("../prisma/seed-data"),
        import("../src/routers/index"),
        import("../src/services/ticket-import.service"),
        import("../src/services/ticket-export.service"),
      ]);
    prisma = appPrisma;
    appRouter = routers.appRouter;
    importTickets = importService.importTickets;
    exportTickets = exportService.exportTickets;

    const { roles } = await seedData.seedFactoryRolesAndDemoUsers(prisma);
    await seedData.seedSlaPolicies(prisma);

    const user = (username: string, name: string) =>
      prisma.user.create({ data: { username, name, roleId: roles.frontline.id, active: true } });
    importer = await user("importer", "导入员一号");
    supervisor = await user("supervisor", "导入主管");
    deleterNoViewAll = await user("deleter", "带删权导入员");
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  beforeEach(async () => {
    await prisma.ticket.deleteMany();
    await prisma.ticketImportBatch.deleteMany();
  });

  const IMPORTER_PERMISSIONS: Permission[] = ["ticket.view", "ticket.import"];
  const DELETER_PERMISSIONS: Permission[] = ["ticket.view", "ticket.import", "ticket.delete"];
  const SUPERVISOR_PERMISSIONS: Permission[] = [
    "ticket.view",
    "ticket.view_all",
    "ticket.import",
    "ticket.delete",
    "ticket.assign",
    "ticket.edit",
    "ticket.export",
    "dashboard.view",
    "dashboard.view_all",
  ];

  function authUser(user: User, permissions: Permission[]) {
    return {
      id: user.id,
      username: user.username,
      name: user.name,
      email: user.email,
      roleId: "role-under-test",
      roleName: "测试角色",
      permissions,
      requiredTicketFields: [],
    };
  }

  function callerWith(user: User, permissions: Permission[]) {
    return appRouter.createCaller({
      traceId: "import-revoke-test",
      user: authUser(user, permissions),
      sessionToken: null,
    });
  }

  const importerCaller = () => callerWith(importer, IMPORTER_PERMISSIONS);
  const supervisorCaller = () => callerWith(supervisor, SUPERVISOR_PERMISSIONS);
  const deleterCaller = () => callerWith(deleterNoViewAll, DELETER_PERMISSIONS);

  const HEADERS = [
    "反馈时间",
    "反馈渠道",
    "项目（保司）",
    "经纪主体",
    "支付渠道",
    "内部订单号",
    "保单号",
    "用户投诉渠道",
    "客户姓名",
    "客户电话（投保人）",
    "联系人电话",
    "保司侧是否核身",
    "客户诉求",
    "客户曾进线",
    "进线ID",
    "客诉类别",
    "投诉等级",
    "优先级",
  ];

  let fileSeq = 0;

  /** Import a batch of named customers through the real import service. */
  async function importBatchOf(
    actor: User,
    permissions: Permission[],
    customerNames: string[],
    filename = `导入-${++fileSeq}.xlsx`,
  ): Promise<string> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("工单");
    sheet.addRow(HEADERS);
    for (const name of customerNames) {
      sheet.addRow(HEADERS.map((header) => (header === "客户姓名" ? name : "")));
    }
    const body = Buffer.from(await workbook.xlsx.writeBuffer());
    await importTickets(deps(), authUser(actor, permissions), { body, filename });
    const batch = await prisma.ticketImportBatch.findFirstOrThrow({ where: { filename } });
    return batch.id;
  }

  describe("导入历史 list", () => {
    it("shows own batches by default, every batch with ticket.view_all", async () => {
      await importBatchOf(importer, IMPORTER_PERMISSIONS, ["张三", "李四"], "importer.xlsx");
      await importBatchOf(supervisor, SUPERVISOR_PERMISSIONS, ["王五"], "supervisor.xlsx");

      const own = await importerCaller().ticket.importBatches({});
      expect(own.total).toBe(1);
      expect(own.items[0]).toMatchObject({
        importerName: "导入员一号",
        rowCount: 2,
        filename: "importer.xlsx",
        status: "revocable",
        revokedAt: null,
        revokedByName: null,
      });

      const all = await supervisorCaller().ticket.importBatches({});
      expect(all.total).toBe(2);
      expect(all.items.map((item) => item.filename)).toEqual(["supervisor.xlsx", "importer.xlsx"]);
    });

    it("rejects listing without ticket.import", async () => {
      await expect(
        callerWith(importer, ["ticket.view"]).ticket.importBatches({}),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("整批撤销", () => {
    it("revokes a clean batch whole: tickets leave list, dashboard and export; batch marks 已撤销", async () => {
      const batchId = await importBatchOf(importer, IMPORTER_PERMISSIONS, ["张三", "李四"]);

      const result = await supervisorCaller().ticket.revokeImportBatch({ batchId });
      expect(result).toEqual({ revoked: 2 });

      // 整批打 deletedAt；批次记撤销人/撤销时刻
      const tickets = await prisma.ticket.findMany();
      expect(tickets).toHaveLength(2);
      for (const ticket of tickets) {
        expect(ticket.deletedAt).not.toBeNull();
      }
      const batch = await prisma.ticketImportBatch.findUniqueOrThrow({ where: { id: batchId } });
      expect(batch.revokedAt).not.toBeNull();
      expect(batch.revokedById).toBe(supervisor.id);

      // 与既有删除口径一致：处理记录留在墓碑后，不写额外 ProcessLog
      expect(await prisma.processLog.count({ where: { action: { not: "create" } } })).toBe(0);

      // 列表、看板与导出即刻不可见 — the importer's own scope included
      expect((await supervisorCaller().ticket.list({})).total).toBe(0);
      expect((await importerCaller().ticket.list({})).total).toBe(0);
      const stats = await supervisorCaller().dashboard.stats();
      expect(stats.metrics.total).toBe(0);
      const file = await exportTickets(deps(), authUser(supervisor, SUPERVISOR_PERMISSIONS), {
        format: "csv",
        sortBy: "createdAt",
        sortOrder: "desc",
      });
      expect(file.body.toString("utf-8")).not.toContain("张三");

      // 历史列表标「已撤销」
      const history = await supervisorCaller().ticket.importBatches({});
      expect(history.items[0]).toMatchObject({
        status: "revoked",
        revokedByName: "导入主管",
        revokedAt: batch.revokedAt?.toISOString(),
      });
    });

    it("rejects the whole revoke once any ticket is processed, reporting the count", async () => {
      const batchId = await importBatchOf(importer, IMPORTER_PERMISSIONS, ["张三", "李四"]);
      const tickets = await prisma.ticket.findMany({ orderBy: { customerName: "asc" } });
      const [first, second] = tickets as [(typeof tickets)[0], (typeof tickets)[0]];

      // 分配其中一单 → 整批拒撤，批内 1 单已有处理
      await supervisorCaller().ticket.assign({ ticketId: first.id, assigneeId: importer.id });
      await expect(supervisorCaller().ticket.revokeImportBatch({ batchId })).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: expect.stringContaining("批内 1 单已有处理"),
      });

      // 全或无：没有任何一单被删，批次未标撤销，历史列表显示「已锁定」
      expect(await prisma.ticket.count({ where: { deletedAt: null } })).toBe(2);
      expect(
        (await prisma.ticketImportBatch.findUniqueOrThrow({ where: { id: batchId } })).revokedAt,
      ).toBeNull();
      const history = await supervisorCaller().ticket.importBatches({});
      expect(history.items[0]?.status).toBe("locked");

      // 另一单被单独删除 → 两单都算已有处理
      await supervisorCaller().ticket.delete({ ticketId: second.id });
      await expect(supervisorCaller().ticket.revokeImportBatch({ batchId })).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: expect.stringContaining("批内 2 单已有处理"),
      });
    });

    it("locks a batch on edit too — any non-create log counts as processing", async () => {
      const batchId = await importBatchOf(importer, IMPORTER_PERMISSIONS, ["张三"]);
      const ticket = await prisma.ticket.findFirstOrThrow();

      await supervisorCaller().ticket.edit({ ticketId: ticket.id, customerName: "张三改" });
      await expect(supervisorCaller().ticket.revokeImportBatch({ batchId })).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      expect((await supervisorCaller().ticket.importBatches({})).items[0]?.status).toBe("locked");
    });

    it("rejects revoking without ticket.delete (API-side 403)", async () => {
      const batchId = await importBatchOf(importer, IMPORTER_PERMISSIONS, ["张三"]);
      await expect(importerCaller().ticket.revokeImportBatch({ batchId })).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: expect.stringContaining("ticket.delete"),
      });
      expect(await prisma.ticket.count({ where: { deletedAt: null } })).toBe(1);
    });

    it("scopes revocation like the history: out-of-scope batch is NOT_FOUND, own batch works", async () => {
      const foreignBatch = await importBatchOf(importer, IMPORTER_PERMISSIONS, ["张三"]);
      await expect(
        deleterCaller().ticket.revokeImportBatch({ batchId: foreignBatch }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });

      const ownBatch = await importBatchOf(deleterNoViewAll, DELETER_PERMISSIONS, ["自家客户"]);
      await expect(
        deleterCaller().ticket.revokeImportBatch({ batchId: ownBatch }),
      ).resolves.toEqual({ revoked: 1 });
    });

    it("never revokes twice — a revoked batch is final", async () => {
      const batchId = await importBatchOf(importer, IMPORTER_PERMISSIONS, ["张三"]);
      await supervisorCaller().ticket.revokeImportBatch({ batchId });

      await expect(supervisorCaller().ticket.revokeImportBatch({ batchId })).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: expect.stringContaining("不可再次撤销"),
      });

      await expect(
        supervisorCaller().ticket.revokeImportBatch({ batchId: "no-such-batch" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });
});
