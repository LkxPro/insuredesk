import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALL_PERMISSIONS,
  COMPLAINT_LEVELS,
  DEFAULT_SLA_POLICIES,
  type Permission,
  type TicketCreateInput,
} from "@insuredesk/shared";
import type { PrismaClient, Role, User } from "@prisma/client";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "../src/services/auth.service";

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const HOUR_MS = 60 * 60 * 1000;

/**
 * Acceptance tests against a real Postgres: the SLA 策略 editor is
 * admin-only (sla.view / sla.edit), a saved policy takes effect immediately —
 * the next created ticket stamps dueAt from the new overdueHours and the next
 * 待办 evaluation judges by the new rules — while existing tickets keep their
 * dueAt (re-stamped only on a complaintLevel edit), and the shared
 * Zod contract rejects malformed rules at the API boundary.
 */
describe("SLA 策略配置 (Testcontainers)", () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let appRouter: typeof import("../src/routers/index").appRouter;
  let listMyTodos: typeof import("../src/services/todo.service").listMyTodos;
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

    const [{ prisma: appPrisma }, seedData, routers, todoService] = await Promise.all([
      import("../src/db"),
      import("../prisma/seed-data"),
      import("../src/routers/index"),
      import("../src/services/todo.service"),
    ]);
    prisma = appPrisma;
    appRouter = routers.appRouter;
    listMyTodos = todoService.listMyTodos;

    seeded = await seedData.seedPresetRolesAndUsers(prisma);
    await seedData.seedSlaPolicies(prisma);
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  function identityOf(user: User, role: Role): AuthenticatedUser {
    return {
      id: user.id,
      username: user.username,
      name: user.name,
      email: user.email,
      roleId: role.id,
      roleName: role.name,
      permissions: role.permissions as Permission[],
    };
  }

  /** Caller with the given seeded user's identity, permissions from their role. */
  function callerFor(user: User, role: Role) {
    return appRouter.createCaller({
      traceId: "sla-test",
      user: identityOf(user, role),
      sessionToken: null,
    });
  }

  const admin = () => callerFor(seeded.users.admin, seeded.roles.admin);
  const manager = () => callerFor(seeded.users.manager, seeded.roles.csManager);
  const frontline = () => callerFor(seeded.users.cs1, seeded.roles.frontline);
  const observer = () => callerFor(seeded.users.observer, seeded.roles.readOnly);

  const baseInput = {
    feedbackTime: "2026-07-09T02:00:00.000Z",
    channel: "保司",
    project: "融盛",
    brokerageEntity: "东方大地",
    paymentChannel: "连连支付",
    policyNumber: "SLA2026071000001",
    userComplaintChannel: "400热线",
    customerName: "王小明",
    phone: "13800000000",
    customerRequest: "对保费收取金额有异议，要求核实并回复",
    nuclearBodyStatus: "待核实",
    hasContacted: false,
    category: "投诉-保费收取问题",
    complaintLevel: "一般投诉",
  } satisfies TicketCreateInput;

  /** dueAt − createdAt of a detail read, in whole hours. */
  function dueOffsetHours(detail: { createdAt: string; dueAt: string | null }): number {
    expect(detail.dueAt).not.toBeNull();
    return (
      (new Date(detail.dueAt as string).getTime() - new Date(detail.createdAt).getTime()) / HOUR_MS
    );
  }

  it("registers sla.view / sla.edit and seeds them to the 管理员 preset only", () => {
    expect(ALL_PERMISSIONS).toContain("sla.view");
    expect(ALL_PERMISSIONS).toContain("sla.edit");
    expect(seeded.roles.admin.permissions).toEqual(
      expect.arrayContaining(["sla.view", "sla.edit"]),
    );
    // 访问与编辑限管理员: no other preset holds either
    for (const role of [seeded.roles.csManager, seeded.roles.frontline, seeded.roles.readOnly]) {
      expect(role.permissions).not.toContain("sla.view");
      expect(role.permissions).not.toContain("sla.edit");
    }
  });

  it("sla.list returns all four levels in fixed order with the PRD §3.8 defaults", async () => {
    const policies = await admin().sla.list();
    expect(policies.map((policy) => policy.complaintLevel)).toEqual([...COMPLAINT_LEVELS]);
    for (const policy of policies) {
      const expected = DEFAULT_SLA_POLICIES[policy.complaintLevel];
      expect(policy.firstResponseMinutes).toBe(expected.firstResponseMinutes);
      expect(policy.overdueHours).toBe(expected.overdueHours);
      expect(policy.reminderRules).toEqual(expected.reminderRules);
    }
  });

  describe("RBAC", () => {
    const validPayload = {
      complaintLevel: "特急投诉" as const,
      firstResponseMinutes: 30,
      overdueHours: null,
      reminderRules: DEFAULT_SLA_POLICIES.特急投诉.reminderRules,
    };

    it("sla.list requires sla.view — even 客服主管 is refused", async () => {
      await expect(manager().sla.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(frontline().sla.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(observer().sla.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("sla.update requires sla.edit — sla.view alone can read but never write", async () => {
      const viewerOnly = appRouter.createCaller({
        traceId: "sla-test",
        user: {
          ...identityOf(seeded.users.observer, seeded.roles.readOnly),
          permissions: ["sla.view"],
        },
        sessionToken: null,
      });
      await expect(viewerOnly.sla.list()).resolves.toHaveLength(COMPLAINT_LEVELS.length);
      await expect(viewerOnly.sla.update(validPayload)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(manager().sla.update(validPayload)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });
  });

  describe("改 overdueHours 即时生效 (acceptance: 新建单受影响, 存量工单不变)", () => {
    it("tickets created after the save stamp the new dueAt; existing tickets keep theirs", async () => {
      const existing = await manager().ticket.create(baseInput);
      const existingBefore = await manager().ticket.detail({ id: existing.id });
      expect(dueOffsetHours(existingBefore)).toBe(48);

      await admin().sla.update({
        complaintLevel: "一般投诉",
        firstResponseMinutes: 90,
        overdueHours: 24,
        reminderRules: DEFAULT_SLA_POLICIES.一般投诉.reminderRules,
      });

      // 存量工单 dueAt 不变 — dueAt 建单一次算定
      const existingAfter = await manager().ticket.detail({ id: existing.id });
      expect(existingAfter.dueAt).toBe(existingBefore.dueAt);

      // 此后新建单按新 overdueHours 计算, and stamps the new 首响要求 text
      const created = await manager().ticket.create(baseInput);
      const detail = await manager().ticket.detail({ id: created.id });
      expect(dueOffsetHours(detail)).toBe(24);
      expect(detail.firstResponseRequirement).toBe("90分钟内完成首次响应");
    });

    it("不设超时: saving overdueHours = null makes new tickets never overdue", async () => {
      await admin().sla.update({
        complaintLevel: "高级投诉",
        firstResponseMinutes: 120,
        overdueHours: null,
        reminderRules: DEFAULT_SLA_POLICIES.高级投诉.reminderRules,
      });

      const created = await manager().ticket.create({ ...baseInput, complaintLevel: "高级投诉" });
      const detail = await manager().ticket.detail({ id: created.id });
      expect(detail.dueAt).toBeNull();
    });

    it("改投诉等级重算 dueAt 时用的是当前策略，不是建单时的", async () => {
      await admin().sla.update({
        complaintLevel: "加急投诉",
        firstResponseMinutes: 60,
        overdueHours: 100,
        reminderRules: DEFAULT_SLA_POLICIES.加急投诉.reminderRules,
      });

      const created = await manager().ticket.create(baseInput);
      await manager().ticket.edit({
        ...baseInput,
        ticketId: created.id,
        complaintLevel: "加急投诉",
      });

      const detail = await manager().ticket.detail({ id: created.id });
      expect(dueOffsetHours(detail)).toBe(100);
    });
  });

  describe("读时告警按新规则判定 (存量工单在下一次轮询就换口径)", () => {
    it("shrinking 特急 rolling intervalHours flips an existing ticket's todo immediately", async () => {
      const created = await manager().ticket.create({ ...baseInput, complaintLevel: "特急投诉" });
      await manager().ticket.assign({ ticketId: created.id, assigneeId: seeded.users.cs1.id });
      await frontline().ticket.addComment({ ticketId: created.id, remark: "已电话联系客户" });

      const comment = await prisma.processLog.findFirstOrThrow({
        where: { ticketId: created.id, action: "comment" },
        orderBy: { at: "desc" },
      });
      // One frozen instant 3h after the comment, evaluated before and after
      // the policy change — only the rule differs between the two reads.
      const clock = { now: () => new Date(comment.at.getTime() + 3 * HOUR_MS) };
      const viewer = identityOf(seeded.users.cs1, seeded.roles.frontline);

      const before = await listMyTodos({ prisma, clock }, viewer);
      const beforeAlerts = before.items.find((item) => item.ticketId === created.id)?.alerts ?? [];
      // Default rule is every 12h — a 3h gap alerts nobody
      expect(beforeAlerts.some((alert) => alert.type === "rolling_follow_up")).toBe(false);

      await admin().sla.update({
        complaintLevel: "特急投诉",
        firstResponseMinutes: 30,
        overdueHours: null,
        reminderRules: [{ type: "rolling_follow_up", intervalHours: 2 }],
      });

      const after = await listMyTodos({ prisma, clock }, viewer);
      const afterAlerts = after.items.find((item) => item.ticketId === created.id)?.alerts ?? [];
      // Same ticket, same instant: the 2h rule now judges the 3h gap overdue
      expect(afterAlerts.some((alert) => alert.type === "rolling_follow_up")).toBe(true);
    });
  });

  describe("表单校验 (shared Zod contract at the API boundary)", () => {
    const base = {
      complaintLevel: "一般投诉" as const,
      firstResponseMinutes: 120,
      overdueHours: 48,
    };
    const checkpoint = (
      patch: Partial<{ checkpointHours: number; requiredCount: number; advanceMinutes: number }>,
    ) => [
      {
        type: "follow_up_checkpoint" as const,
        checkpointHours: 24,
        requiredCount: 1,
        advanceMinutes: 60,
        ...patch,
      },
    ];

    it("rejects advanceMinutes at or above its own checkpoint", async () => {
      await expect(
        admin().sla.update({
          ...base,
          reminderRules: checkpoint({ checkpointHours: 1, advanceMinutes: 60 }),
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("accepts advanceMinutes one minute below the checkpoint", async () => {
      await expect(
        admin().sla.update({
          ...base,
          reminderRules: checkpoint({ checkpointHours: 1, advanceMinutes: 59 }),
        }),
      ).resolves.toMatchObject({ complaintLevel: "一般投诉" });
    });

    it("rejects non-positive numbers everywhere", async () => {
      await expect(
        admin().sla.update({ ...base, firstResponseMinutes: 0, reminderRules: [] }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(
        admin().sla.update({ ...base, overdueHours: 0, reminderRules: [] }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(
        admin().sla.update({
          ...base,
          reminderRules: [{ type: "rolling_follow_up", intervalHours: 0 }],
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      // advanceMinutes = 0 parses at the read boundary but is a dead rule the
      // editor contract refuses (empty alert window)
      await expect(
        admin().sla.update({ ...base, reminderRules: checkpoint({ advanceMinutes: 0 }) }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });
});
