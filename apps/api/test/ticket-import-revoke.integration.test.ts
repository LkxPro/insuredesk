import {
  TICKET_IMPORT_HEADERS as HEADERS,
  type Permission,
  TICKET_SOURCES,
} from "@insuredesk/shared";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient, User } from "../src/generated/prisma/client";
import { appRouter } from "../src/routers/index";
import { exportTickets } from "../src/services/ticket-export.service";
import { importTickets } from "../src/services/ticket-import.service";
import { type IntegrationHarness, startIntegrationHarness } from "./integration-harness";

/**
 * Acceptance tests for 导入历史 + 整批撤销 against a real Postgres, through
 * appRouter.createCaller (permission middleware included):
 *
 * - history scope: own batches by default, every batch with ticket.view_all;
 *   listing gated on ticket.import
 * - clean revoke: all-or-nothing soft delete — tickets leave the list, the
 *   dashboard, and the export; the batch stays in history as 已撤销 with
 *   revoker + instant
 * - locked: any log later than the batch's import instant (assign/edit/…)
 *   or any ticket individually deleted → the whole revoke is rejected with
 *   the processed count, nothing deleted, and the batch lists as locked;
 *   same-instant logs are the import's own and never lock
 * - guards: no ticket.delete → FORBIDDEN; out-of-scope batch → NOT_FOUND;
 *   a revoked batch can never be revoked again
 */
describe("ticket import history & batch revocation (Testcontainers)", () => {
  let harness: IntegrationHarness;
  let prisma: PrismaClient;
  let importer: User;
  let supervisor: User;
  let deleterNoViewAll: User;

  const deps = () => ({ prisma, clock: { now: () => new Date() } });

  beforeAll(async () => {
    harness = await startIntegrationHarness({ seed: ["rolesAndUsers", "slaPolicies"] });
    prisma = harness.prisma;
    const { roles } = harness.seeded;

    const user = (username: string, name: string) =>
      prisma.user.create({ data: { username, name, roleId: roles.frontline.id, active: true } });
    importer = await user("importer", "导入员一号");
    supervisor = await user("supervisor", "导入主管");
    deleterNoViewAll = await user("deleter", "带删权导入员");
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
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
      team: user.team,
      roleId: "role-under-test",
      roleName: "测试角色",
      permissions,
      requiredTicketFields: [],
      isExternal: false,
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

  let fileSeq = 0;

  /** Import a batch through the real import service; a string row = 客户姓名 only. */
  async function importBatchOf(
    actor: User,
    permissions: Permission[],
    rows: Array<string | Partial<Record<string, string>>>,
    filename = `导入-${++fileSeq}.xlsx`,
  ): Promise<string> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("工单");
    sheet.addRow(HEADERS);
    for (const row of rows) {
      const cells = typeof row === "string" ? { 客户姓名: row } : row;
      sheet.addRow(HEADERS.map((header) => cells[header] ?? ""));
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
      const stats = await supervisorCaller().dashboard.stats({});
      expect(stats.metrics.total).toBe(0);
      const file = await exportTickets(deps(), authUser(supervisor, SUPERVISOR_PERMISSIONS), {
        format: "csv",
        source: [...TICKET_SOURCES],
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

    // 导入即完结的整条链路：完结行的 resolve 日志与导入同瞬间，不锁批。
    it("keeps a batch containing 导入即完结 rows immediately revocable", async () => {
      const batchId = await importBatchOf(importer, IMPORTER_PERMISSIONS, [
        { 客户姓名: "迁移客户", 完结状态: "已达成一致", 完结备注: "历史迁移" },
        "新客户",
      ]);

      expect((await supervisorCaller().ticket.importBatches({})).items[0]?.status).toBe(
        "revocable",
      );
      await expect(supervisorCaller().ticket.revokeImportBatch({ batchId })).resolves.toEqual({
        revoked: 2,
      });
      expect(await prisma.ticket.count({ where: { deletedAt: null } })).toBe(0);
    });

    it("still locks a 完结-containing batch on any manual action after the import", async () => {
      const batchId = await importBatchOf(importer, IMPORTER_PERMISSIONS, [
        { 客户姓名: "迁移客户", 完结状态: "已达成一致", 完结备注: "历史迁移" },
        "新客户",
      ]);
      const unassigned = await prisma.ticket.findFirstOrThrow({
        where: { customerName: "新客户" },
      });

      await supervisorCaller().ticket.assign({ ticketId: unassigned.id, assigneeId: importer.id });
      expect((await supervisorCaller().ticket.importBatches({})).items[0]?.status).toBe("locked");
      await expect(supervisorCaller().ticket.revokeImportBatch({ batchId })).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      expect(await prisma.ticket.count({ where: { deletedAt: null } })).toBe(2);
    });

    // 「已有处理」以批次导入瞬间为界：同瞬间的日志属于导入本身（导入即完结
    // 会在同瞬间写 resolve），任何晚于该瞬间的日志才锁批。
    it("keeps a batch revocable when a log shares the import instant", async () => {
      const batchId = await importBatchOf(importer, IMPORTER_PERMISSIONS, ["张三"]);
      const batch = await prisma.ticketImportBatch.findUniqueOrThrow({ where: { id: batchId } });
      const ticket = await prisma.ticket.findFirstOrThrow();

      await prisma.processLog.create({
        data: {
          ticketId: ticket.id,
          operatorId: importer.id,
          operatorName: importer.name,
          action: "resolve",
          remark: "导入即完结",
          at: batch.importedAt,
        },
      });

      expect((await supervisorCaller().ticket.importBatches({})).items[0]?.status).toBe(
        "revocable",
      );
      await expect(supervisorCaller().ticket.revokeImportBatch({ batchId })).resolves.toEqual({
        revoked: 1,
      });
    });

    it("locks a batch on any log later than the import instant, whatever its action", async () => {
      const batchId = await importBatchOf(importer, IMPORTER_PERMISSIONS, ["张三"]);
      const batch = await prisma.ticketImportBatch.findUniqueOrThrow({ where: { id: batchId } });
      const ticket = await prisma.ticket.findFirstOrThrow();

      await prisma.processLog.create({
        data: {
          ticketId: ticket.id,
          operatorId: importer.id,
          operatorName: importer.name,
          action: "create",
          remark: "晚于导入瞬间的日志",
          at: new Date(batch.importedAt.getTime() + 1),
        },
      });

      expect((await supervisorCaller().ticket.importBatches({})).items[0]?.status).toBe("locked");
      await expect(supervisorCaller().ticket.revokeImportBatch({ batchId })).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: expect.stringContaining("批内 1 单已有处理"),
      });
      expect(await prisma.ticket.count({ where: { deletedAt: null } })).toBe(1);
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
