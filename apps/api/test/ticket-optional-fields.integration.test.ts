import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Permission, TicketCreateInput, TicketEditInput } from "@insuredesk/shared";
import type { PrismaClient, Role, User } from "@prisma/client";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const HOUR_MS = 60 * 60 * 1000;

/**
 * Acceptance tests against a real Postgres: 新建工单 with no required
 * business fields. A fully blank submission succeeds; unfilled
 * fields persist as NULL (never ""); hasContacted unfilled means 未知, not
 * false; system fields (workOrderNumber/source/createdAt/creatorId/status)
 * still generate. 未定级 tickets carry no dueAt / SLA requirement strings and
 * raise no SLA time alerts; a later complaintLevel edit computes SLA off the
 * ORIGINAL createdAt. 未填渠道 tickets stay manually assignable but 按排班
 * 自动分配 skips them with an explicit reason. List / detail / todo / export
 * all read null-heavy rows without failing.
 */
describe("optional business fields (Testcontainers)", () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let appRouter: typeof import("../src/routers/index").appRouter;
  let seeded: {
    roles: { admin: Role; csManager: Role; frontline: Role; readOnly: Role };
    users: { admin: User; manager: User; cs1: User; observer: User };
  };

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17-alpine").start();
    const databaseUrl = container.getConnectionUri();

    execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
      cwd: apiDir,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "pipe",
    });
    process.env.DATABASE_URL = databaseUrl;

    const [{ prisma: appPrisma }, seedData, routers] = await Promise.all([
      import("../src/db"),
      import("../prisma/seed-data"),
      import("../src/routers/index"),
    ]);
    prisma = appPrisma;
    appRouter = routers.appRouter;

    seeded = await seedData.seedFactoryRolesAndDemoUsers(prisma);
    await seedData.seedSlaPolicies(prisma);
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  /** Caller with the given seeded user's identity, permissions from their role. */
  function callerFor(user: User, role: Role) {
    return appRouter.createCaller({
      traceId: "optional-fields-test",
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        email: user.email,
        roleId: role.id,
        roleName: role.name,
        permissions: role.permissions as Permission[],
      requiredTicketFields: [],
      },
      sessionToken: null,
    });
  }

  const manager = () => callerFor(seeded.users.manager, seeded.roles.csManager);

  /** The nullable business columns a blank submission must persist as NULL. */
  const NULLABLE_COLUMNS = [
    "feedbackTime",
    "channel",
    "project",
    "brokerageEntity",
    "paymentChannel",
    "internalOrderNumber",
    "policyNumber",
    "userComplaintChannel",
    "customerName",
    "phone",
    "contactPhone",
    "customerRequest",
    "nuclearBodyStatus",
    "hasContacted",
    "contactId",
    "category",
    "complaintLevel",
    "priority",
  ] as const;

  /** A full edit payload that changes nothing: every field blank. */
  function blankEditInput(ticketId: string, overrides: Partial<TicketEditInput> = {}) {
    const blank = Object.fromEntries(NULLABLE_COLUMNS.map((column) => [column, null]));
    return { ...blank, ticketId, ...overrides } as TicketEditInput;
  }

  describe("完全空白提交", () => {
    it("creates from an empty payload: nulls persisted, system fields generated, no SLA stamps", async () => {
      const created = await manager().ticket.create({} as TicketCreateInput);
      expect(created.workOrderNumber).toMatch(/^WO\d{6,}$/);

      const row = await prisma.ticket.findUniqueOrThrow({ where: { id: created.id } });
      for (const column of NULLABLE_COLUMNS) {
        expect(row[column], column).toBeNull();
      }
      // System-derived fields are unaffected by the blankness
      expect(row.source).toBe("manual");
      expect(row.creatorId).toBe(seeded.users.manager.id);
      expect(row.status).toBe("unassigned");
      expect(row.createdAt).toBeInstanceOf(Date);
      // 未定级 → no SLA clock fields at all
      expect(row.dueAt).toBeNull();
      expect(row.followUpFrequency).toBeNull();
      expect(row.firstResponseRequirement).toBeNull();
      // The timeline root still lands in the same transaction
      const logs = await prisma.processLog.findMany({ where: { ticketId: created.id } });
      expect(logs.map((log) => log.action)).toEqual(["create"]);
    });

    it('empty strings and whitespace normalize to NULL, never persist as ""', async () => {
      const created = await manager().ticket.create({
        feedbackTime: "",
        channel: "",
        project: "   ",
        customerName: "",
        priority: "",
      } as TicketCreateInput);

      const row = await prisma.ticket.findUniqueOrThrow({ where: { id: created.id } });
      expect(row.feedbackTime).toBeNull();
      expect(row.channel).toBeNull();
      expect(row.project).toBeNull();
      expect(row.customerName).toBeNull();
      expect(row.priority).toBeNull();
    });

    it("hasContacted unfilled is unknown (null), explicitly false stays false", async () => {
      const unknown = await manager().ticket.create({} as TicketCreateInput);
      const explicit = await manager().ticket.create({ hasContacted: false } as TicketCreateInput);

      const unknownRow = await prisma.ticket.findUniqueOrThrow({ where: { id: unknown.id } });
      const explicitRow = await prisma.ticket.findUniqueOrThrow({ where: { id: explicit.id } });
      expect(unknownRow.hasContacted).toBeNull();
      expect(explicitRow.hasContacted).toBe(false);
    });
  });

  describe("未定级工单的 SLA 与告警", () => {
    it("no complaintLevel → no dueAt, no requirement strings, and no SLA time alerts in 我的待办 beyond 待首响", async () => {
      const created = await manager().ticket.create({} as TicketCreateInput);
      await manager().ticket.assign({ ticketId: created.id, assigneeId: seeded.users.cs1.id });
      // Backdate far past every level's thresholds: were any SLA rule active,
      // it would fire — a 未定级 ticket must raise none of them.
      await prisma.ticket.update({
        where: { id: created.id },
        data: { createdAt: new Date(Date.now() - 100 * HOUR_MS) },
      });

      const { listMyTodos } = await import("../src/services/todo.service");
      const todos = await listMyTodos(
        { prisma, clock: { now: () => new Date() } },
        {
          id: seeded.users.cs1.id,
          username: seeded.users.cs1.username,
          name: seeded.users.cs1.name,
          email: seeded.users.cs1.email,
          roleId: seeded.roles.frontline.id,
          roleName: seeded.roles.frontline.name,
          permissions: seeded.roles.frontline.permissions as Permission[],
      requiredTicketFields: [],
        },
      );
      const entry = todos.items.find((item) => item.ticketId === created.id);
      // 待首响 is policy-free and keeps working; without a level's red line it
      // can never escalate past warning, and no checkpoint/rolling/due alert
      // exists to accompany it.
      expect(entry).toBeDefined();
      expect(entry?.alerts.map((alert) => alert.type)).toEqual(["awaiting_first_response"]);
      expect(entry?.severity).toBe("warning");
    });

    it("a later complaintLevel edit computes SLA off the ORIGINAL createdAt", async () => {
      const created = await manager().ticket.create({} as TicketCreateInput);
      const createdAt = new Date(Date.now() - 70 * HOUR_MS);
      await prisma.ticket.update({ where: { id: created.id }, data: { createdAt } });

      await manager().ticket.edit(blankEditInput(created.id, { complaintLevel: "一般投诉" }));

      const detail = await manager().ticket.detail({ id: created.id });
      // dueAt anchors to 录入时刻, not the edit instant — 70h old
      // against 一般's 48h window means instantly overdue.
      expect(detail.dueAt).toBe(new Date(createdAt.getTime() + 48 * HOUR_MS).toISOString());
      expect(detail.displayStatus).toBe("overdue");
      expect(detail.firstResponseRequirement).toBe("120分钟内完成首次响应");
    });

    it("clearing complaintLevel clears the SLA stamps again", async () => {
      const created = await manager().ticket.create({
        complaintLevel: "一般投诉",
      } as TicketCreateInput);
      expect((await manager().ticket.detail({ id: created.id })).dueAt).not.toBeNull();

      await manager().ticket.edit(blankEditInput(created.id));

      const detail = await manager().ticket.detail({ id: created.id });
      expect(detail.complaintLevel).toBeNull();
      expect(detail.dueAt).toBeNull();
      expect(detail.followUpFrequency).toBeNull();
      expect(detail.firstResponseRequirement).toBeNull();
    });
  });

  describe("逐步补齐", () => {
    it("edits one field at a time without demanding the other blanks", async () => {
      const created = await manager().ticket.create({} as TicketCreateInput);

      const first = await manager().ticket.edit(
        blankEditInput(created.id, { customerName: "陈晓" }),
      );
      expect(first.changedFields).toEqual(["customerName"]);

      const second = await manager().ticket.edit(
        blankEditInput(created.id, { customerName: "陈晓", phone: "13800001234" }),
      );
      expect(second.changedFields).toEqual(["phone"]);

      const detail = await manager().ticket.detail({ id: created.id });
      expect(detail.customerName).toBe("陈晓");
      expect(detail.phone).toBe("13800001234");
      expect(detail.channel).toBeNull();
    });
  });

  describe("分配", () => {
    it("manual assignment works with no channel (手动分配与排班无关)", async () => {
      const created = await manager().ticket.create({} as TicketCreateInput);

      const result = await manager().ticket.assign({
        ticketId: created.id,
        assigneeId: seeded.users.cs1.id,
      });
      expect(result.status).toBe("assigned");
    });

    it("按排班自动分配 skips a channel-less ticket with an explicit missing_channel reason", async () => {
      const created = await manager().ticket.create({} as TicketCreateInput);

      const result = await manager().ticket.autoAssign({ ticketIds: [created.id] });
      expect(result.assigned).toEqual([]);
      expect(result.skipped).toEqual([
        {
          ticketId: created.id,
          workOrderNumber: created.workOrderNumber,
          channel: null,
          reason: "missing_channel",
        },
      ]);

      const row = await prisma.ticket.findUniqueOrThrow({ where: { id: created.id } });
      expect(row.status).toBe("unassigned");
      expect(row.assigneeId).toBeNull();
    });
  });

  describe("列表 / 详情 / 导出安全读取空值", () => {
    it("list and detail serialize a blank ticket with nulls, not crashes", async () => {
      const created = await manager().ticket.create({} as TicketCreateInput);

      const detail = await manager().ticket.detail({ id: created.id });
      expect(detail).toMatchObject({
        channel: null,
        customerName: null,
        complaintLevel: null,
        hasContacted: null,
        feedbackTime: null,
        dueAt: null,
        followUpFrequency: null,
        firstResponseRequirement: null,
      });

      const { items } = await manager().ticket.list({ search: created.workOrderNumber });
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        customerName: null,
        policyNumber: null,
        channel: null,
        complaintLevel: null,
        dueAt: null,
      });
    });

    it("export renders unfilled fields as empty cells", async () => {
      const created = await manager().ticket.create({} as TicketCreateInput);

      // The export is an HTTP route; exercise its service with the same
      // viewer identity the route would resolve.
      const { exportTickets } = await import("../src/services/ticket-export.service");
      const file = await exportTickets(
        { prisma, clock: { now: () => new Date() } },
        {
          id: seeded.users.manager.id,
          username: seeded.users.manager.username,
          name: seeded.users.manager.name,
          email: seeded.users.manager.email,
          roleId: seeded.roles.csManager.id,
          roleName: seeded.roles.csManager.name,
          permissions: seeded.roles.csManager.permissions as Permission[],
      requiredTicketFields: [],
        },
        {
          format: "csv",
          search: created.workOrderNumber,
          sortBy: "createdAt",
          sortOrder: "desc",
        },
      );
      const body = file.body.toString("utf8");
      const lines = body.replace(/^﻿/, "").trimEnd().split("\r\n");
      expect(lines).toHaveLength(2);
      // 工单号 present; unfilled fields are empty cells — never the string "null"
      expect(lines[1]?.startsWith(created.workOrderNumber)).toBe(true);
      expect(body).not.toContain("null");
    });
  });
});
