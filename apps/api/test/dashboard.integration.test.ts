import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Permission, TicketCreateInput } from "@insuredesk/shared";
import { CHANNELS, DASHBOARD_METRIC_KEYS } from "@insuredesk/shared";
import type { Prisma, PrismaClient, Role, User } from "@prisma/client";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const HOUR_MS = 60 * 60 * 1000;

/**
 * Acceptance tests for 数据看板 against a real Postgres: the 9 metric cards
 * (with the time cards reusing the single-truth predicates), the deliberate
 * difference between the two overdue 口径, soft-delete exclusion, the
 * 4-channel table, the Top-10 跟进人考核表, the dashboard.view_all data
 * scope, and the <2s compute target. Runs through appRouter.createCaller;
 * clock-sensitive 口径 cases use the service directly with a fixed clock,
 * like the list tests.
 */
describe("dashboard stats (Testcontainers)", () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let appRouter: typeof import("../src/routers/index").appRouter;
  let getDashboardStats: typeof import("../src/services/dashboard.service").getDashboardStats;
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

    const [{ prisma: appPrisma }, seedData, routers, dashboardService] = await Promise.all([
      import("../src/db"),
      import("../prisma/seed-data"),
      import("../src/routers/index"),
      import("../src/services/dashboard.service"),
    ]);
    prisma = appPrisma;
    appRouter = routers.appRouter;
    getDashboardStats = dashboardService.getDashboardStats;

    seeded = await seedData.seedFactoryRolesAndDemoUsers(prisma);
    await seedData.seedSlaPolicies(prisma);
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  // Every test builds its own fixture set from a clean slate. Extra users some
  // tests create keep zero tickets afterwards, so they can never leak into
  // another test's assignee table (rollups derive from tickets alone).
  beforeEach(async () => {
    await prisma.ticket.deleteMany();
  });

  function authUserFor(user: User, role: Role, permissions?: Permission[]) {
    return {
      id: user.id,
      username: user.username,
      name: user.name,
      email: user.email,
      roleId: role.id,
      roleName: role.name,
      permissions: permissions ?? (role.permissions as Permission[]),
      requiredTicketFields: [],
    };
  }

  /** Caller with the given seeded user's identity, permissions from their role. */
  function callerFor(user: User, role: Role, permissions?: Permission[]) {
    return appRouter.createCaller({
      traceId: "dashboard-test",
      user: authUserFor(user, role, permissions),
      sessionToken: null,
    });
  }

  const manager = () => callerFor(seeded.users.manager, seeded.roles.csManager);
  const frontline = () => callerFor(seeded.users.cs1, seeded.roles.frontline);
  const observer = () => callerFor(seeded.users.observer, seeded.roles.readOnly);

  /** Fixed-clock service read for 口径 cases that must pin "now". */
  function statsAt(now: Date, viewer: User = seeded.users.manager, role?: Role) {
    return getDashboardStats(
      { prisma, clock: { now: () => now } },
      authUserFor(viewer, role ?? seeded.roles.csManager),
    );
  }

  const baseInput = {
    feedbackTime: "2026-07-09T02:00:00.000Z",
    channel: "保司",
    project: "融盛",
    brokerageEntity: "东方大地",
    paymentChannel: "连连支付",
    policyNumber: "P2026070900123",
    userComplaintChannel: "400热线",
    customerName: "王小明",
    phone: "13800000000",
    customerRequest: "对保费收取金额有异议，要求核实并回复",
    nuclearBodyStatus: "待核实",
    hasContacted: false,
    complaintLevel: "一般投诉",
  } satisfies TicketCreateInput;

  /**
   * Create a ticket through the real creation flow, then shape the row
   * directly into the state under test (assignment, completion, soft delete).
   */
  async function makeTicket(
    input: Partial<TicketCreateInput> = {},
    row: Prisma.TicketUncheckedUpdateInput = {},
  ) {
    const created = await manager().ticket.create({ ...baseInput, ...input });
    if (Object.keys(row).length > 0) {
      await prisma.ticket.update({ where: { id: created.id }, data: row });
    }
    return created;
  }

  /** Row shape for bulk createMany (perf / Top-10 fixtures). */
  function bulkRow(
    overrides: Partial<Prisma.TicketCreateManyInput> = {},
  ): Prisma.TicketCreateManyInput {
    return {
      feedbackTime: new Date("2026-07-09T02:00:00.000Z"),
      source: "manual",
      channel: "保司",
      project: "融盛",
      brokerageEntity: "东方大地",
      paymentChannel: "连连支付",
      policyNumber: "BULK",
      userComplaintChannel: "400热线",
      customerName: "批量客户",
      phone: "13800000000",
      customerRequest: "批量数据",
      nuclearBodyStatus: "待核实",
      hasContacted: false,
      complaintLevel: "一般投诉",
      followUpFrequency: "24小时内累计跟进1次；48小时内累计跟进2次",
      firstResponseRequirement: "120分钟内完成首次响应",
      ...overrides,
    };
  }

  describe("9 张指标卡 (PRD §2.2)", () => {
    it("counts stored statuses, time overlays, 特急 and 监管 — one ticket can sit on several cards", async () => {
      const now = new Date();
      const at = (offsetHours: number) => new Date(now.getTime() + offsetHours * HOUR_MS);

      await makeTicket({ customerName: "新单" }); // unassigned, due +48h
      await makeTicket(
        { customerName: "已分配" },
        { status: "assigned", assigneeId: seeded.users.cs1.id, dueAt: at(30) },
      );
      await makeTicket(
        { customerName: "处理中" },
        { status: "processing", assigneeId: seeded.users.cs1.id, dueAt: at(30) },
      );
      await makeTicket(
        { customerName: "按时完结" },
        {
          status: "completed",
          assigneeId: seeded.users.cs1.id,
          dueAt: at(10),
          completionTime: at(-1),
          completionStatus: "正常完结",
        },
      );
      await makeTicket(
        { customerName: "预警中" },
        { status: "assigned", assigneeId: seeded.users.cs1.id, dueAt: at(1) },
      );
      await makeTicket(
        { customerName: "已超时" },
        { status: "processing", assigneeId: seeded.users.cs1.id, dueAt: at(-1) },
      );
      await makeTicket(
        { customerName: "特急", complaintLevel: "特急投诉" },
        { createdAt: at(-100) }, // dueAt stays null however old it gets
      );
      await makeTicket({ customerName: "监管件", channel: "监管" });

      const { metrics } = await statsAt(now);

      expect(Object.keys(metrics).sort()).toEqual([...DASHBOARD_METRIC_KEYS].sort());
      expect(metrics.total).toBe(8);
      expect(metrics.unassigned).toBe(3); // 新单 + 特急 + 监管件
      expect(metrics.assigned).toBe(2); // 已分配 + 预警中: the card counts STORED status
      expect(metrics.processing).toBe(2); // 处理中 + 已超时: same — overlays don't subtract
      expect(metrics.completed).toBe(1);
      expect(metrics.pendingTimeout).toBe(1); // 预警中 only
      expect(metrics.overdue).toBe(1); // 已超时 only — 特急 (dueAt null) never computes
      expect(metrics.urgent).toBe(1);
      expect(metrics.regulatory).toBe(1);
      // The 4 status cards partition the set; the 5 other cards are overlays.
      expect(metrics.unassigned + metrics.assigned + metrics.processing + metrics.completed).toBe(
        metrics.total,
      );
    });

    it("agrees with the list predicates on the 2h / dueAt boundaries (ADR 0001 single truth)", async () => {
      const now = new Date();
      await makeTicket(
        { customerName: "整两小时" },
        { status: "assigned", dueAt: new Date(now.getTime() + 2 * HOUR_MS) },
      );
      await makeTicket({ customerName: "恰在时限" }, { status: "assigned", dueAt: now });
      await makeTicket(
        { customerName: "刚过时限" },
        { status: "assigned", dueAt: new Date(now.getTime() - 1) },
      );

      const { metrics } = await statsAt(now);

      // 不足 2 小时 is strict (exactly 2h left is safe); 已超过 is strict
      // (the dueAt instant is still pending) — same edges as the list filter.
      expect(metrics.pendingTimeout).toBe(1); // 恰在时限 only
      expect(metrics.overdue).toBe(1); // 刚过时限 only
    });

    it("完结即移出 — 已超时卡是实时运营视角，不含超时完结", async () => {
      const now = new Date();
      await makeTicket(
        { customerName: "超时后完结" },
        {
          status: "completed",
          assigneeId: seeded.users.cs1.id,
          dueAt: new Date(now.getTime() - 10 * HOUR_MS),
          completionTime: new Date(now.getTime() - HOUR_MS),
          completionStatus: "已协商解决",
        },
      );

      const { metrics } = await statsAt(now);
      expect(metrics.overdue).toBe(0);
      expect(metrics.pendingTimeout).toBe(0);
      expect(metrics.completed).toBe(1);
    });
  });

  describe("两种超时口径有意不同 (ADR 0003)", () => {
    it("看板已超时 counts only in-flight; 考核超时单数 adds 超时完结 on top", async () => {
      const now = new Date();
      const at = (offsetHours: number) => new Date(now.getTime() + offsetHours * HOUR_MS);
      const cs1 = seeded.users.cs1.id;

      // A: 超时完结 — completed 1h ago on a deadline that passed 20h ago
      await makeTicket(
        { customerName: "超时完结" },
        {
          status: "completed",
          assigneeId: cs1,
          createdAt: at(-50),
          dueAt: at(-20),
          completionTime: at(-1),
          completionStatus: "已协商解决",
        },
      );
      // B: 在途超时
      await makeTicket(
        { customerName: "在途超时" },
        { status: "processing", assigneeId: cs1, createdAt: at(-60), dueAt: at(-12) },
      );
      // C: 按时完结
      await makeTicket(
        { customerName: "按时完结" },
        {
          status: "completed",
          assigneeId: cs1,
          createdAt: at(-10),
          dueAt: at(38),
          completionTime: at(-2),
          completionStatus: "正常完结",
        },
      );

      const stats = await statsAt(now);

      // 实时运营视角: only B is overdue — A dropped out on completion.
      expect(stats.metrics.overdue).toBe(1);

      // 历史追责视角: A and B both count; C keeps the rate below 1.
      const row = stats.assignees.find((entry) => entry.assigneeId === cs1);
      expect(row).toBeDefined();
      expect(row?.assigneeName).toBe(seeded.users.cs1.name);
      expect(row?.totalCount).toBe(3);
      expect(row?.completedCount).toBe(2); // A + C
      expect(row?.overdueCount).toBe(2); // A (超时完结) + B (在途超时)
      expect(row?.overdueRate).toBeCloseTo(2 / 3, 10);
      // 平均完结时长 = mean of completionTime − createdAt (端到端): A 49h, C 8h.
      expect(row?.avgCompletionMs).toBe(28.5 * HOUR_MS);
    });

    it("特急 (无 dueAt) 永不计入任何超时口径", async () => {
      const now = new Date();
      await makeTicket(
        { customerName: "特急在途", complaintLevel: "特急投诉" },
        {
          status: "processing",
          assigneeId: seeded.users.cs1.id,
          createdAt: new Date(now.getTime() - 500 * HOUR_MS),
        },
      );
      await makeTicket(
        { customerName: "特急完结", complaintLevel: "特急投诉" },
        {
          status: "completed",
          assigneeId: seeded.users.cs1.id,
          createdAt: new Date(now.getTime() - 500 * HOUR_MS),
          completionTime: new Date(now.getTime() - HOUR_MS),
          completionStatus: "已达成一致",
        },
      );

      const stats = await statsAt(now);
      expect(stats.metrics.overdue).toBe(0);
      expect(stats.metrics.pendingTimeout).toBe(0);
      expect(stats.metrics.urgent).toBe(2);

      const row = stats.assignees.find((entry) => entry.assigneeId === seeded.users.cs1.id);
      expect(row?.overdueCount).toBe(0);
      expect(row?.overdueRate).toBe(0);
    });
  });

  describe("软删排除 — 全部指标、渠道表、考核表", () => {
    it("soft-deleted tickets count nowhere, whatever state they died in", async () => {
      const now = new Date();
      const kept = await makeTicket({ customerName: "存活" });
      // One deleted ticket per 口径 it could have influenced:
      await makeTicket(
        { customerName: "删·超时", channel: "监管", complaintLevel: "特急投诉" },
        { deletedAt: now },
      );
      await makeTicket(
        { customerName: "删·完结" },
        {
          status: "completed",
          assigneeId: seeded.users.cs1.id,
          dueAt: new Date(now.getTime() - 10 * HOUR_MS),
          completionTime: new Date(now.getTime() - HOUR_MS),
          completionStatus: "正常完结",
          deletedAt: now,
        },
      );
      await makeTicket(
        { customerName: "删·在途超时", channel: "支付" },
        {
          status: "processing",
          assigneeId: seeded.users.cs1.id,
          dueAt: new Date(now.getTime() - HOUR_MS),
          deletedAt: now,
        },
      );

      const stats = await statsAt(now);

      expect(stats.metrics.total).toBe(1);
      expect(stats.metrics.unassigned).toBe(1);
      expect(stats.metrics.completed).toBe(0);
      expect(stats.metrics.overdue).toBe(0);
      expect(stats.metrics.urgent).toBe(0);
      expect(stats.metrics.regulatory).toBe(0);

      expect(stats.channels).toEqual([
        { channel: "保司", count: 1 },
        { channel: "经纪", count: 0 },
        { channel: "支付", count: 0 },
        { channel: "监管", count: 0 },
      ]);

      // cs1 held only deleted tickets — the 考核表 must not know them.
      expect(stats.assignees).toHaveLength(0);

      const list = await manager().ticket.list({});
      expect(list.items.map((ticket) => ticket.id)).toEqual([kept.id]);
    });
  });

  describe("渠道统计表", () => {
    it("returns all 4 channels zero-filled, in the fixed CHANNELS order", async () => {
      await makeTicket({ channel: "保司" });
      await makeTicket({ channel: "保司" });
      await makeTicket({ channel: "支付" });
      await makeTicket({ channel: "监管" });

      const stats = await manager().dashboard.stats();

      expect(stats.channels.map((row) => row.channel)).toEqual([...CHANNELS]);
      expect(stats.channels).toEqual([
        { channel: "保司", count: 2 },
        { channel: "经纪", count: 0 },
        { channel: "支付", count: 1 },
        { channel: "监管", count: 1 },
      ]);
    });
  });

  describe("跟进人考核 Top 10", () => {
    it("caps at 10 assignees ranked by 完单数, dropping the smallest producers", async () => {
      // 12 assignees, i completions each (i = 1..12): ranks 12..3 stay, 2 and 1 drop.
      const extras = Array.from({ length: 12 }, (_, index) => ({
        username: `perf-cs-${index + 1}`,
        name: `考核客服${index + 1}`,
        roleId: seeded.roles.frontline.id,
        active: true,
      }));
      await prisma.user.createMany({ data: extras, skipDuplicates: true });
      const users = await prisma.user.findMany({
        where: { username: { startsWith: "perf-cs-" } },
        orderBy: { username: "asc" },
      });

      const now = Date.now();
      const rows: Prisma.TicketCreateManyInput[] = [];
      for (const user of users) {
        const completions = Number(user.username.replace("perf-cs-", ""));
        for (let i = 0; i < completions; i++) {
          rows.push(
            bulkRow({
              assigneeId: user.id,
              status: "completed",
              dueAt: new Date(now + 40 * HOUR_MS),
              completionTime: new Date(now - i * HOUR_MS),
              completionStatus: "正常完结",
            }),
          );
        }
      }
      await prisma.ticket.createMany({ data: rows });

      const stats = await manager().dashboard.stats();

      expect(stats.assignees).toHaveLength(10);
      expect(stats.assignees.map((row) => row.completedCount)).toEqual([
        12, 11, 10, 9, 8, 7, 6, 5, 4, 3,
      ]);
      expect(stats.assignees[0]?.assigneeName).toBe("考核客服12");
      const shownNames = stats.assignees.map((row) => row.assigneeName);
      expect(shownNames).not.toContain("考核客服1");
      expect(shownNames).not.toContain("考核客服2");
    });

    it("includes assignees with zero completions while room remains — avg 完结时长 is null", async () => {
      await makeTicket(
        { customerName: "只在途" },
        { status: "processing", assigneeId: seeded.users.cs1.id },
      );

      const stats = await manager().dashboard.stats();

      expect(stats.assignees).toEqual([
        {
          assigneeId: seeded.users.cs1.id,
          assigneeName: seeded.users.cs1.name,
          totalCount: 1,
          completedCount: 0,
          avgCompletionMs: null,
          overdueCount: 0,
          overdueRate: 0,
        },
      ]);
    });
  });

  describe("数据范围: 无 dashboard.view_all 收窄为本人名下 (PRD §5.2)", () => {
    it("frontline sees own-only numbers and scope=own; view_all roles see everything", async () => {
      const now = new Date();
      await makeTicket({ customerName: "无主单", channel: "监管" }); // unassigned pool
      await makeTicket(
        { customerName: "主管的超时单" },
        {
          status: "processing",
          assigneeId: seeded.users.manager.id,
          dueAt: new Date(now.getTime() - HOUR_MS),
        },
      );
      await makeTicket(
        { customerName: "小张的完结单" },
        {
          status: "completed",
          assigneeId: seeded.users.cs1.id,
          completionTime: new Date(now.getTime() - HOUR_MS),
          completionStatus: "正常完结",
        },
      );
      await makeTicket(
        { customerName: "小张的在途单", channel: "支付" },
        {
          status: "assigned",
          assigneeId: seeded.users.cs1.id,
          dueAt: new Date(now.getTime() + 30 * HOUR_MS),
        },
      );

      const own = await frontline().dashboard.stats();
      expect(own.scope).toBe("own");
      expect(own.metrics.total).toBe(2); // the unassigned pool and 主管's ticket are invisible
      expect(own.metrics.unassigned).toBe(0);
      expect(own.metrics.completed).toBe(1);
      expect(own.metrics.assigned).toBe(1);
      expect(own.metrics.overdue).toBe(0); // 主管's overdue ticket is out of scope
      expect(own.metrics.regulatory).toBe(0);
      expect(own.channels.find((row) => row.channel === "支付")?.count).toBe(1);
      expect(own.assignees.map((row) => row.assigneeId)).toEqual([seeded.users.cs1.id]);

      for (const caller of [manager(), observer()]) {
        const all = await caller.dashboard.stats();
        expect(all.scope).toBe("all");
        expect(all.metrics.total).toBe(4);
        expect(all.metrics.unassigned).toBe(1);
        expect(all.metrics.overdue).toBe(1);
        expect(all.metrics.regulatory).toBe(1);
        expect(all.assignees.map((row) => row.assigneeId).sort()).toEqual(
          [seeded.users.manager.id, seeded.users.cs1.id].sort(),
        );
      }
    });

    it("我创建但他人处理/未指派的单不计入我的看板 — 看板口径按我名下，与列表有意不同", async () => {
      await makeTicket({ customerName: "小张创建未指派" }, { creatorId: seeded.users.cs1.id });
      await makeTicket(
        { customerName: "小张创建主管处理" },
        {
          creatorId: seeded.users.cs1.id,
          status: "assigned",
          assigneeId: seeded.users.manager.id,
          assignedAt: new Date(),
        },
      );

      const own = await frontline().dashboard.stats();
      expect(own.scope).toBe("own");
      expect(own.metrics.total).toBe(0);
      expect(own.assignees).toEqual([]);
    });
  });

  describe("权限", () => {
    it("rejects callers without dashboard.view", async () => {
      const caller = callerFor(seeded.users.cs1, seeded.roles.frontline, ["ticket.view"]);
      await expect(caller.dashboard.stats()).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("性能 (PRD §6.1)", () => {
    it("computes the full dashboard over 3000 tickets in under 2 seconds", async () => {
      const now = Date.now();
      const assignees = [
        seeded.users.cs1.id,
        seeded.users.manager.id,
        seeded.users.observer.id,
        seeded.users.admin.id,
        null,
      ];
      const statuses = ["unassigned", "assigned", "processing", "completed"] as const;
      await prisma.ticket.createMany({
        data: Array.from({ length: 3000 }, (_, i) => {
          const status = statuses[i % statuses.length] ?? "unassigned";
          const assigneeId = status === "unassigned" ? null : (assignees[i % 4] ?? null);
          const completed = status === "completed";
          return bulkRow({
            channel: CHANNELS[i % CHANNELS.length],
            complaintLevel: i % 11 === 0 ? "特急投诉" : "一般投诉",
            status,
            assigneeId,
            createdAt: new Date(now - (i % 96) * HOUR_MS),
            dueAt: i % 11 === 0 ? null : new Date(now + ((i % 96) - 48) * HOUR_MS),
            completionTime: completed ? new Date(now - (i % 24) * HOUR_MS) : null,
            completionStatus: completed ? "正常完结" : null,
          });
        }),
      });

      const startedAt = performance.now();
      const stats = await manager().dashboard.stats();
      const elapsedMs = performance.now() - startedAt;

      expect(stats.metrics.total).toBe(3000);
      expect(elapsedMs).toBeLessThan(2000);
    });
  });
});
