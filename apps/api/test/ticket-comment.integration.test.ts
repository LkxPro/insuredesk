import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Permission, TicketCreateInput } from "@insuredesk/shared";
import type { PrismaClient, Role, User } from "@prisma/client";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Acceptance tests against a real Postgres: adding a follow-up (跟进备注)
 * maintains contactCount / processingResult / nextContactTime in one action
 * (单点维护), the FIRST follow-up moves assigned → processing with the
 * comment + status_change ProcessLog pair, and later follow-ups append a
 * single comment entry with no transition. Runs
 * through appRouter.createCaller — the same procedure pipeline (permission
 * middleware included) the HTTP adapter uses.
 */
describe("ticket follow-up comments (Testcontainers)", () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let appRouter: typeof import("../src/routers/index").appRouter;
  let seeded: {
    roles: { admin: Role; csManager: Role; frontline: Role; readOnly: Role };
    users: { admin: User; manager: User; cs1: User; observer: User };
  };
  let cs2: User;

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

    cs2 = await prisma.user.create({
      data: {
        username: "cs2",
        name: "王二客服",
        roleId: seeded.roles.frontline.id,
        active: true,
      },
    });
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  /** Caller with the given user identity and an explicit permission set. */
  function callerWith(user: User, roleName: string, permissions: Permission[]) {
    return appRouter.createCaller({
      traceId: "comment-test",
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        email: user.email,
        roleId: "role-under-test",
        roleName,
        permissions,
        requiredTicketFields: [],
      },
      sessionToken: null,
    });
  }

  /** Caller with the given seeded user's identity, permissions from their role. */
  function callerFor(user: User, role: Role) {
    return callerWith(user, role.name, role.permissions as Permission[]);
  }

  const manager = () => callerFor(seeded.users.manager, seeded.roles.csManager);
  const frontline = () => callerFor(seeded.users.cs1, seeded.roles.frontline);
  const observer = () => callerFor(seeded.users.observer, seeded.roles.readOnly);

  const baseInput = {
    feedbackTime: "2026-07-09T02:00:00.000Z",
    project: "融盛",
    brokerageEntity: "东方大地",
    paymentChannel: "连连支付",
    policyNumber: "P2026070900654",
    userComplaintChannel: "400热线",
    customerName: "钱跟进",
    phone: "13800000002",
    customerRequest: "对退保金额有异议，要求重新核算",
    nuclearBodyStatus: "待核实",
    hasContacted: false,
    complaintLevel: "一般投诉",
  } satisfies TicketCreateInput;

  /** A fresh unassigned ticket, created through the real create procedure. */
  async function createTicket() {
    const created = await manager().ticket.create(baseInput);
    return created.id;
  }

  /** A fresh ticket already assigned to the given user (default cs1). */
  async function createAssignedTicket(assigneeId?: string) {
    const ticketId = await createTicket();
    await manager().ticket.assign({
      ticketId,
      assigneeId: assigneeId ?? seeded.users.cs1.id,
    });
    return ticketId;
  }

  describe("first follow-up (首次跟进: assigned → processing)", () => {
    it("maintains contactCount/processingResult/nextContactTime in one action and writes comment + status_change logs in order", async () => {
      const ticketId = await createAssignedTicket();

      const result = await frontline().ticket.addComment({
        ticketId,
        remark: "已电话联系客户，解释核算口径",
        nextContactTime: "2026-07-12T02:00:00.000Z",
      });
      expect(result).toMatchObject({
        id: ticketId,
        status: "processing",
        contactCount: 1,
      });

      const detail = await manager().ticket.detail({ id: ticketId });
      expect(detail.status).toBe("processing");
      expect(detail.contactCount).toBe(1);
      expect(detail.processingResult).toBe("已电话联系客户，解释核算口径");
      expect(detail.nextContactTime).toBe("2026-07-12T02:00:00.000Z");

      // Two log entries beyond create/assign/status_change, in order: the
      // comment first, then the separate transition entry
      expect(detail.processLogs.map((log) => log.action)).toEqual([
        "create",
        "assign",
        "status_change",
        "comment",
        "status_change",
      ]);

      const [commentLog, transitionLog] = detail.processLogs.slice(-2);
      expect(commentLog).toMatchObject({
        operatorId: seeded.users.cs1.id,
        operatorName: seeded.users.cs1.name,
        from: null,
        to: null,
        remark: "已电话联系客户，解释核算口径",
      });
      expect(transitionLog).toMatchObject({
        operatorId: seeded.users.cs1.id,
        from: "assigned",
        to: "processing",
      });
      // One action, one instant: both entries carry the same timestamp
      expect(transitionLog?.at).toBe(commentLog?.at);
    });

    it("leaves nextContactTime null when the follow-up does not set one", async () => {
      const ticketId = await createAssignedTicket();

      await frontline().ticket.addComment({ ticketId, remark: "客户未接听，短信告知" });

      const detail = await manager().ticket.detail({ id: ticketId });
      expect(detail.status).toBe("processing");
      expect(detail.nextContactTime).toBeNull();
    });

    it("does not move dueAt or assignedAt (ADR 0002: SLA anchored at creation)", async () => {
      const ticketId = await createAssignedTicket();
      const before = await manager().ticket.detail({ id: ticketId });

      await frontline().ticket.addComment({ ticketId, remark: "首次联系完成" });

      const after = await manager().ticket.detail({ id: ticketId });
      expect(after.dueAt).toBe(before.dueAt);
      expect(after.assignedAt).toBe(before.assignedAt);
    });
  });

  describe("subsequent follow-ups (持续跟进: status unchanged)", () => {
    it("appends one comment log only, keeps counting, and tracks the latest remark", async () => {
      const ticketId = await createAssignedTicket();
      await frontline().ticket.addComment({ ticketId, remark: "第一次联系" });

      const result = await frontline().ticket.addComment({
        ticketId,
        remark: "第二次联系，客户接受方案",
      });
      expect(result).toMatchObject({ status: "processing", contactCount: 2 });

      const detail = await manager().ticket.detail({ id: ticketId });
      expect(detail.status).toBe("processing");
      expect(detail.contactCount).toBe(2);
      expect(detail.processingResult).toBe("第二次联系，客户接受方案");

      // Exactly one new entry — no second assigned → processing transition
      expect(detail.processLogs.map((log) => log.action)).toEqual([
        "create",
        "assign",
        "status_change",
        "comment",
        "status_change",
        "comment",
      ]);
    });

    it("owns nextContactTime per follow-up: a new value replaces the old, omitting it clears the stale plan", async () => {
      const ticketId = await createAssignedTicket();
      await frontline().ticket.addComment({
        ticketId,
        remark: "已联系，约定明天再沟通",
        nextContactTime: "2026-07-11T06:00:00.000Z",
      });

      await frontline().ticket.addComment({
        ticketId,
        remark: "再次联系，改约下周",
        nextContactTime: "2026-07-15T06:00:00.000Z",
      });
      let detail = await manager().ticket.detail({ id: ticketId });
      expect(detail.nextContactTime).toBe("2026-07-15T06:00:00.000Z");

      await frontline().ticket.addComment({ ticketId, remark: "客户确认解决，无需再约" });
      detail = await manager().ticket.detail({ id: ticketId });
      expect(detail.nextContactTime).toBeNull();
    });
  });

  describe("改派后首次跟进", () => {
    it("still moves assigned → processing when the ticket was reassigned before any follow-up", async () => {
      const ticketId = await createAssignedTicket(seeded.users.cs1.id);
      await manager().ticket.assign({ ticketId, assigneeId: cs2.id });

      const result = await callerFor(cs2, seeded.roles.frontline).ticket.addComment({
        ticketId,
        remark: "新责任人首次联系客户",
      });
      expect(result).toMatchObject({ status: "processing", contactCount: 1 });

      const detail = await manager().ticket.detail({ id: ticketId });
      expect(detail.status).toBe("processing");
      expect(detail.processLogs.map((log) => log.action)).toEqual([
        "create",
        "assign",
        "status_change",
        "assign",
        "comment",
        "status_change",
      ]);
      expect(detail.processLogs.at(-1)).toMatchObject({
        operatorId: cs2.id,
        from: "assigned",
        to: "processing",
      });
    });
  });

  describe("guards", () => {
    it("rejects a follow-up on an unassigned ticket, leaving no trace", async () => {
      const ticketId = await createTicket();

      await expect(
        manager().ticket.addComment({ ticketId, remark: "还没分配就想跟进" }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

      const detail = await manager().ticket.detail({ id: ticketId });
      expect(detail.status).toBe("unassigned");
      expect(detail.contactCount).toBe(0);
      expect(detail.processLogs.map((log) => log.action)).toEqual(["create"]);
    });

    it("rejects a follow-up on a completed ticket (终态)", async () => {
      const ticketId = await createAssignedTicket();
      await prisma.ticket.update({ where: { id: ticketId }, data: { status: "completed" } });

      await expect(
        manager().ticket.addComment({ ticketId, remark: "已完结还想跟进" }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });

    it("rejects unknown and soft-deleted tickets as NOT_FOUND", async () => {
      await expect(
        manager().ticket.addComment({ ticketId: "no-such-ticket", remark: "无中生有" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });

      const ticketId = await createAssignedTicket();
      await prisma.ticket.update({ where: { id: ticketId }, data: { deletedAt: new Date() } });
      await expect(
        manager().ticket.addComment({ ticketId, remark: "已删除还想跟进" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("rejects a blank remark", async () => {
      const ticketId = await createAssignedTicket();

      await expect(manager().ticket.addComment({ ticketId, remark: "   " })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    });
  });

  describe("RBAC and data scope", () => {
    it("applies the data scope: a frontline CS cannot follow up on someone else's ticket", async () => {
      const ticketId = await createAssignedTicket(cs2.id);

      await expect(
        frontline().ticket.addComment({ ticketId, remark: "不是我的工单" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("lets the creator follow up on their own ticket after it was assigned to someone else", async () => {
      const creator = () =>
        callerWith(seeded.users.cs1, "受限创建人", [
          "ticket.view",
          "ticket.create",
          "ticket.process",
        ]);
      const created = await creator().ticket.create(baseInput);
      await manager().ticket.assign({ ticketId: created.id, assigneeId: cs2.id });

      const result = await creator().ticket.addComment({
        ticketId: created.id,
        remark: "创建人补充客户来电信息",
      });
      expect(result).toMatchObject({ status: "processing", contactCount: 1 });

      const detail = await manager().ticket.detail({ id: created.id });
      expect(detail.processLogs.at(-2)).toMatchObject({
        action: "comment",
        operatorId: seeded.users.cs1.id,
      });
    });

    it("lets ticket.process + ticket.view_all follow up on others' tickets (主管顶班)", async () => {
      const ticketId = await createAssignedTicket(seeded.users.cs1.id);

      const result = await manager().ticket.addComment({
        ticketId,
        remark: "主管代为联系客户",
      });
      expect(result).toMatchObject({ status: "processing", contactCount: 1 });

      const detail = await manager().ticket.detail({ id: ticketId });
      expect(detail.processLogs.at(-2)).toMatchObject({
        action: "comment",
        operatorId: seeded.users.manager.id,
        operatorName: seeded.users.manager.name,
      });
    });

    it("rejects callers without ticket.process (只读观察)", async () => {
      const ticketId = await createAssignedTicket();

      await expect(
        observer().ticket.addComment({ ticketId, remark: "只读也想跟进" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });
});
