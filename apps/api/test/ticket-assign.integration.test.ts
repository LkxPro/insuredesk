import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Permission, TicketCreateInput } from "@insuredesk/shared";
import type { PrismaClient, Role, User } from "@prisma/client";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Issue #24 acceptance tests against a real Postgres: first assignment vs
 * reassignment field behavior (dueAt/assignedAt invariants, ADR 0002), the
 * assign + status_change ProcessLog pair (order and content, PRD §3.2), batch
 * assignment as one all-or-nothing transaction, and permission/data-scope
 * rejections. Runs through appRouter.createCaller — the same procedure
 * pipeline (permission middleware included) the HTTP adapter uses.
 */
describe("ticket assignment (Testcontainers)", () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let appRouter: typeof import("../src/routers/index").appRouter;
  let seeded: {
    roles: { admin: Role; csManager: Role; frontline: Role; readOnly: Role };
    users: { admin: User; manager: User; cs1: User; observer: User };
  };
  let cs2: User;
  let inactiveUser: User;

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

    seeded = await seedData.seedPresetRolesAndUsers(prisma);
    await seedData.seedSlaPolicies(prisma);

    cs2 = await prisma.user.create({
      data: {
        username: "cs2",
        name: "王二客服",
        roleId: seeded.roles.frontline.id,
        active: true,
      },
    });
    inactiveUser = await prisma.user.create({
      data: {
        username: "gone",
        name: "已停用客服",
        roleId: seeded.roles.frontline.id,
        active: false,
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
      traceId: "assign-test",
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        email: user.email,
        roleId: "role-under-test",
        roleName,
        permissions,
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
    channel: "保司",
    project: "融盛",
    brokerageEntity: "东方大地",
    paymentChannel: "连连支付",
    policyNumber: "P2026070900321",
    userComplaintChannel: "400热线",
    customerName: "赵可分",
    phone: "13800000001",
    customerRequest: "对理赔进度有异议，要求尽快处理",
    nuclearBodyStatus: "待核实",
    hasContacted: false,
    category: "理赔投诉",
    complaintLevel: "一般投诉",
  } satisfies TicketCreateInput;

  /** A fresh unassigned ticket, created through the real create procedure. */
  async function createTicket() {
    const created = await manager().ticket.create(baseInput);
    return created.id;
  }

  describe("first assignment (未分配 → 已分配)", () => {
    it("sets assigneeId/assignedAt/status, keeps dueAt, and writes assign + status_change logs in order", async () => {
      const ticketId = await createTicket();
      const before = await manager().ticket.detail({ id: ticketId });

      const result = await manager().ticket.assign({
        ticketId,
        assigneeId: seeded.users.cs1.id,
      });
      expect(result).toMatchObject({
        id: ticketId,
        status: "assigned",
        assigneeName: seeded.users.cs1.name,
      });

      const detail = await manager().ticket.detail({ id: ticketId });
      expect(detail.assigneeId).toBe(seeded.users.cs1.id);
      expect(detail.assigneeName).toBe(seeded.users.cs1.name);
      expect(detail.status).toBe("assigned");
      expect(detail.assignedAt).not.toBeNull();
      // dueAt anchored to createdAt at creation; assignment never recomputes it (ADR 0002)
      expect(detail.dueAt).toBe(before.dueAt);
      expect(detail.createdAt).toBe(before.createdAt);

      // Two log entries beyond `create`, in order: assign first, then the
      // separate status_change (PRD §3.2 记录生成规则), both at the same instant
      expect(detail.processLogs.map((log) => log.action)).toEqual([
        "create",
        "assign",
        "status_change",
      ]);

      const [, assignLog, statusLog] = detail.processLogs;
      expect(assignLog).toMatchObject({
        operatorId: seeded.users.manager.id,
        operatorName: seeded.users.manager.name,
        from: null, // first assignment: no previous assignee
        to: seeded.users.cs1.name, // name snapshot, not an id
      });
      expect(assignLog?.remark).toBeTruthy();
      expect(statusLog).toMatchObject({
        operatorId: seeded.users.manager.id,
        from: "unassigned",
        to: "assigned",
      });
      expect(statusLog?.at).toBe(assignLog?.at);
      expect(detail.assignedAt).toBe(assignLog?.at);
    });
  });

  describe("reassignment (改派)", () => {
    it("updates assigneeId only — dueAt and assignedAt unchanged (ADR 0002) — and logs one assign entry 从谁到谁", async () => {
      const ticketId = await createTicket();
      await manager().ticket.assign({ ticketId, assigneeId: seeded.users.cs1.id });
      const first = await manager().ticket.detail({ id: ticketId });

      await manager().ticket.assign({ ticketId, assigneeId: cs2.id });

      const detail = await manager().ticket.detail({ id: ticketId });
      expect(detail.assigneeId).toBe(cs2.id);
      expect(detail.status).toBe("assigned");
      expect(detail.assignedAt).toBe(first.assignedAt); // 首次分配时刻不变
      expect(detail.dueAt).toBe(first.dueAt); // 改派永不重算时限

      // Exactly one new log: assign 从谁改派到谁 — status didn't change, so no
      // extra status_change entry
      expect(detail.processLogs.map((log) => log.action)).toEqual([
        "create",
        "assign",
        "status_change",
        "assign",
      ]);
      expect(detail.processLogs.at(-1)).toMatchObject({
        from: seeded.users.cs1.name,
        to: cs2.name,
      });
    });

    it("keeps a processing ticket processing (no status_change on reassign)", async () => {
      const ticketId = await createTicket();
      await manager().ticket.assign({ ticketId, assigneeId: seeded.users.cs1.id });
      // 处理中 arrives with the follow-up action (#26); simulate the state here
      await prisma.ticket.update({ where: { id: ticketId }, data: { status: "processing" } });

      await manager().ticket.assign({ ticketId, assigneeId: cs2.id });

      const detail = await manager().ticket.detail({ id: ticketId });
      expect(detail.status).toBe("processing");
      expect(detail.processLogs.filter((log) => log.action === "status_change")).toHaveLength(1);
    });

    it("snapshots names as of the operation: renames rewrite neither past logs nor the new from", async () => {
      const ticketId = await createTicket();
      await manager().ticket.assign({ ticketId, assigneeId: seeded.users.cs1.id });

      const originalName = seeded.users.cs1.name;
      await prisma.user.update({
        where: { id: seeded.users.cs1.id },
        data: { name: "张客服（改名后）" },
      });
      try {
        await manager().ticket.assign({ ticketId, assigneeId: cs2.id });

        const detail = await manager().ticket.detail({ id: ticketId });
        const [firstAssign, reassign] = detail.processLogs.filter((log) => log.action === "assign");
        expect(firstAssign?.to).toBe(originalName); // old snapshot untouched
        expect(reassign?.from).toBe("张客服（改名后）"); // 当时是谁 = current name at reassign time
      } finally {
        await prisma.user.update({
          where: { id: seeded.users.cs1.id },
          data: { name: originalName },
        });
      }
    });

    it("rejects reassigning to the current assignee, leaving no trace", async () => {
      const ticketId = await createTicket();
      await manager().ticket.assign({ ticketId, assigneeId: seeded.users.cs1.id });
      const before = await manager().ticket.detail({ id: ticketId });

      await expect(
        manager().ticket.assign({ ticketId, assigneeId: seeded.users.cs1.id }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

      const after = await manager().ticket.detail({ id: ticketId });
      expect(after.processLogs).toHaveLength(before.processLogs.length);
    });
  });

  describe("guards", () => {
    it("rejects assigning a completed ticket (终态)", async () => {
      const ticketId = await createTicket();
      await prisma.ticket.update({ where: { id: ticketId }, data: { status: "completed" } });

      await expect(
        manager().ticket.assign({ ticketId, assigneeId: seeded.users.cs1.id }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });

    it("rejects an unknown or inactive assignee", async () => {
      const ticketId = await createTicket();

      await expect(
        manager().ticket.assign({ ticketId, assigneeId: "no-such-user" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(
        manager().ticket.assign({ ticketId, assigneeId: inactiveUser.id }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("rejects unknown and soft-deleted tickets as NOT_FOUND", async () => {
      await expect(
        manager().ticket.assign({ ticketId: "no-such-ticket", assigneeId: cs2.id }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });

      const ticketId = await createTicket();
      await prisma.ticket.update({ where: { id: ticketId }, data: { deletedAt: new Date() } });
      await expect(manager().ticket.assign({ ticketId, assigneeId: cs2.id })).rejects.toMatchObject(
        { code: "NOT_FOUND" },
      );
    });

    it("applies the data scope: ticket.assign without ticket.view_all cannot reach others' tickets", async () => {
      const ticketId = await createTicket(); // unassigned → outside cs1's scope
      const scopedAssigner = callerWith(seeded.users.cs1, "受限分配员", [
        "ticket.view",
        "ticket.assign",
      ]);

      await expect(
        scopedAssigner.ticket.assign({ ticketId, assigneeId: cs2.id }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  describe("batch assignment (批量分配)", () => {
    it("assigns every selected unassigned ticket to the same assignee with full per-ticket logs", async () => {
      const ids = [await createTicket(), await createTicket(), await createTicket()];

      const result = await manager().ticket.batchAssign({
        ticketIds: ids,
        assigneeId: seeded.users.cs1.id,
      });
      expect(result).toMatchObject({
        assignedCount: 3,
        assigneeName: seeded.users.cs1.name,
      });

      for (const id of ids) {
        const detail = await manager().ticket.detail({ id });
        expect(detail.assigneeId).toBe(seeded.users.cs1.id);
        expect(detail.status).toBe("assigned");
        expect(detail.assignedAt).not.toBeNull();
        expect(detail.processLogs.map((log) => log.action)).toEqual([
          "create",
          "assign",
          "status_change",
        ]);
      }
    });

    it("reassigns already-assigned tickets in the same batch without touching assignedAt", async () => {
      const freshId = await createTicket();
      const assignedId = await createTicket();
      await manager().ticket.assign({ ticketId: assignedId, assigneeId: seeded.users.cs1.id });
      const assignedBefore = await manager().ticket.detail({ id: assignedId });

      await manager().ticket.batchAssign({ ticketIds: [freshId, assignedId], assigneeId: cs2.id });

      const fresh = await manager().ticket.detail({ id: freshId });
      expect(fresh.status).toBe("assigned");
      expect(fresh.assignedAt).not.toBeNull();

      const reassigned = await manager().ticket.detail({ id: assignedId });
      expect(reassigned.assigneeId).toBe(cs2.id);
      expect(reassigned.assignedAt).toBe(assignedBefore.assignedAt);
      expect(reassigned.dueAt).toBe(assignedBefore.dueAt);
      expect(reassigned.processLogs.at(-1)).toMatchObject({
        action: "assign",
        from: seeded.users.cs1.name,
        to: cs2.name,
      });
    });

    it("skips tickets already owned by the target as no-ops instead of failing the batch", async () => {
      const freshId = await createTicket();
      const alreadyTheirsId = await createTicket();
      await manager().ticket.assign({ ticketId: alreadyTheirsId, assigneeId: cs2.id });
      const alreadyBefore = await manager().ticket.detail({ id: alreadyTheirsId });

      const result = await manager().ticket.batchAssign({
        ticketIds: [freshId, alreadyTheirsId],
        assigneeId: cs2.id,
      });
      expect(result).toMatchObject({ assignedCount: 1, skippedCount: 1 });

      const fresh = await manager().ticket.detail({ id: freshId });
      expect(fresh.assigneeId).toBe(cs2.id);

      // The skipped ticket is untouched: no new logs, nothing rewritten
      const already = await manager().ticket.detail({ id: alreadyTheirsId });
      expect(already.processLogs).toHaveLength(alreadyBefore.processLogs.length);
      expect(already.updatedAt).toBe(alreadyBefore.updatedAt);
    });

    it("is all-or-nothing: one completed ticket aborts the whole batch", async () => {
      const okId = await createTicket();
      const completedId = await createTicket();
      await prisma.ticket.update({ where: { id: completedId }, data: { status: "completed" } });

      await expect(
        manager().ticket.batchAssign({
          ticketIds: [okId, completedId],
          assigneeId: seeded.users.cs1.id,
        }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

      // The assignable ticket must be untouched — no partial batch
      const detail = await manager().ticket.detail({ id: okId });
      expect(detail.status).toBe("unassigned");
      expect(detail.assigneeId).toBeNull();
      expect(detail.processLogs.map((log) => log.action)).toEqual(["create"]);
    });

    it("deduplicates repeated ids instead of double-assigning", async () => {
      const ticketId = await createTicket();

      const result = await manager().ticket.batchAssign({
        ticketIds: [ticketId, ticketId],
        assigneeId: seeded.users.cs1.id,
      });
      expect(result.assignedCount).toBe(1);

      const detail = await manager().ticket.detail({ id: ticketId });
      expect(detail.processLogs.filter((log) => log.action === "assign")).toHaveLength(1);
    });

    it("fails as NOT_FOUND when any id is unknown, changing nothing", async () => {
      const okId = await createTicket();

      await expect(
        manager().ticket.batchAssign({
          ticketIds: [okId, "no-such-ticket"],
          assigneeId: seeded.users.cs1.id,
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });

      const detail = await manager().ticket.detail({ id: okId });
      expect(detail.status).toBe("unassigned");
    });
  });

  describe("assignee options (人选下拉)", () => {
    it("returns active users only, for holders of an assign permission", async () => {
      const options = await manager().ticket.assigneeOptions();
      const names = options.map((option) => option.name);
      expect(names).toContain(seeded.users.cs1.name);
      expect(names).toContain(cs2.name);
      expect(names).not.toContain(inactiveUser.name);
      for (const option of options) {
        expect(option).toEqual({
          id: expect.any(String),
          name: expect.any(String),
          username: expect.any(String),
        });
      }
    });
  });

  describe("RBAC", () => {
    it("rejects every assignment surface without the matching permission (一线客服, 只读观察)", async () => {
      const ticketId = await createTicket();

      for (const caller of [frontline(), observer()]) {
        await expect(
          caller.ticket.assign({ ticketId, assigneeId: seeded.users.cs1.id }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        await expect(
          caller.ticket.batchAssign({ ticketIds: [ticketId], assigneeId: seeded.users.cs1.id }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        await expect(caller.ticket.assigneeOptions()).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
      }
    });

    it("ticket.batch_assign alone still unlocks the options list (either assign permission works)", async () => {
      const batchOnly = callerWith(seeded.users.manager, "仅批量", [
        "ticket.view",
        "ticket.view_all",
        "ticket.batch_assign",
      ]);
      const options = await batchOnly.ticket.assigneeOptions();
      expect(options.length).toBeGreaterThan(0);

      // …but not the single-assign mutation
      const ticketId = await createTicket();
      await expect(
        batchOnly.ticket.assign({ ticketId, assigneeId: seeded.users.cs1.id }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });
});
