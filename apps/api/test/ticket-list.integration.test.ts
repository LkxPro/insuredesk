import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Permission, TicketCreateInput } from "@insuredesk/shared";
import type { Prisma, PrismaClient, Role, User } from "@prisma/client";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const HOUR_MS = 60 * 60 * 1000;

/**
 * Issue #23 acceptance tests for the ticket list against a real Postgres:
 * soft-delete exclusion, filters (incl. the computed statuses resolved to SQL
 * predicates, ADR 0001), search, sort, pagination, RBAC data scope (PRD §5.2),
 * and the <1s load target for 100 rows (PRD §6.1). Runs through
 * appRouter.createCaller — the same procedure pipeline the HTTP adapter uses.
 * Computed-status *boundary* cases use the service directly with a fixed
 * clock; everything else goes through the caller with the system clock.
 */
describe("ticket list (Testcontainers)", () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let appRouter: typeof import("../src/routers/index").appRouter;
  let listTickets: typeof import("../src/services/ticket.service").listTickets;
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

    const [{ prisma: appPrisma }, seedData, routers, ticketService] = await Promise.all([
      import("../src/db"),
      import("../prisma/seed-data"),
      import("../src/routers/index"),
      import("../src/services/ticket.service"),
    ]);
    prisma = appPrisma;
    appRouter = routers.appRouter;
    listTickets = ticketService.listTickets;

    seeded = await seedData.seedPresetRolesAndUsers(prisma);
    await seedData.seedSlaPolicies(prisma);
    await seedData.seedComplaintLevels(prisma);
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  // Every test builds its own fixture set from a clean slate, so counts and
  // orderings are exact (ProcessLogs cascade with their tickets).
  beforeEach(async () => {
    await prisma.ticket.deleteMany();
  });

  function authUserFor(user: User, role: Role) {
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
      traceId: "ticket-list-test",
      user: authUserFor(user, role),
      sessionToken: null,
    });
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
    policyNumber: "P2026070900123",
    userComplaintChannel: "400热线",
    customerName: "王小明",
    phone: "13800000000",
    customerRequest: "对保费收取金额有异议，要求核实并回复",
    nuclearBodyStatus: "待核实",
    hasContacted: false,
    category: "投诉-保费收取问题",
    complaintLevel: "一般投诉",
  } satisfies TicketCreateInput;

  /**
   * Create a ticket through the real creation flow, then shape the row
   * directly for states the API can't produce yet (assignment, completion,
   * soft delete arrive with later issues).
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

  describe("basic listing", () => {
    it("returns non-deleted tickets, newest created first by default, with a total count", async () => {
      const first = await makeTicket({ customerName: "客户一" });
      const second = await makeTicket({ customerName: "客户二" });
      const third = await makeTicket({ customerName: "客户三" });

      const result = await manager().ticket.list({});

      expect(result.total).toBe(3);
      expect(result.page).toBe(1);
      expect(result.items.map((t) => t.id)).toEqual([third.id, second.id, first.id]);

      const item = result.items[0];
      expect(item?.workOrderNumber).toBe(third.workOrderNumber);
      expect(item?.customerName).toBe("客户三");
      expect(item?.channel).toBe("保司");
      expect(item?.complaintLevel).toBe("一般投诉");
      expect(item?.source).toBe("manual");
      expect(item?.status).toBe("unassigned");
      // Fresh 一般投诉 is 48h from due — no computed override
      expect(item?.displayStatus).toBe("unassigned");
      expect(item?.assigneeName).toBeNull();
      expect(item && "deletedAt" in item).toBe(false); // soft-delete marker never leaves the API
    });

    it("默认排除软删工单 — soft-deleted rows appear in neither items nor total", async () => {
      const kept = await makeTicket();
      await makeTicket({}, { deletedAt: new Date() });

      const result = await manager().ticket.list({});

      expect(result.total).toBe(1);
      expect(result.items.map((t) => t.id)).toEqual([kept.id]);
    });
  });

  describe("status filter with computed statuses (ADR 0001)", () => {
    it("resolves pending_timeout / overdue as read-time predicates without touching stored status", async () => {
      const now = Date.now();
      const overdue = await makeTicket(
        { customerName: "已超时客户" },
        {
          status: "processing",
          dueAt: new Date(now - HOUR_MS),
        },
      );
      const pending = await makeTicket(
        { customerName: "待超时客户" },
        {
          status: "assigned",
          assigneeId: seeded.users.cs1.id,
          dueAt: new Date(now + HOUR_MS),
        },
      );
      const safe = await makeTicket({ customerName: "正常客户" }); // fresh 一般投诉: due in 48h

      const overdueResult = await manager().ticket.list({ status: "overdue" });
      expect(overdueResult.items.map((t) => t.id)).toEqual([overdue.id]);
      expect(overdueResult.items[0]?.displayStatus).toBe("overdue");
      expect(overdueResult.items[0]?.status).toBe("processing"); // stored status untouched

      const pendingResult = await manager().ticket.list({ status: "pending_timeout" });
      expect(pendingResult.items.map((t) => t.id)).toEqual([pending.id]);
      expect(pendingResult.items[0]?.displayStatus).toBe("pending_timeout");

      // The DB rows never changed — only the display did
      const storedStatuses = await prisma.ticket.findMany({
        where: { id: { in: [overdue.id, pending.id, safe.id] } },
        select: { status: true },
      });
      expect(storedStatuses.map((t) => t.status).sort()).toEqual([
        "assigned",
        "processing",
        "unassigned",
      ]);
    });

    it("filtering a base status excludes rows a computed status overrides", async () => {
      const now = Date.now();
      await makeTicket(
        { customerName: "处理中已超时" },
        {
          status: "processing",
          dueAt: new Date(now - HOUR_MS),
        },
      );
      const calm = await makeTicket(
        { customerName: "处理中正常" },
        {
          status: "processing",
          dueAt: new Date(now + 30 * HOUR_MS),
        },
      );

      const result = await manager().ticket.list({ status: "processing" });
      expect(result.items.map((t) => t.id)).toEqual([calm.id]);
    });

    it("完结即移出 — a completed ticket past dueAt is completed, never overdue", async () => {
      const now = Date.now();
      const done = await makeTicket(
        { customerName: "超时后完结" },
        {
          status: "completed",
          dueAt: new Date(now - HOUR_MS),
          completionTime: new Date(now - HOUR_MS / 2),
          completionStatus: "正常完结",
        },
      );

      expect((await manager().ticket.list({ status: "overdue" })).total).toBe(0);

      const completedResult = await manager().ticket.list({ status: "completed" });
      expect(completedResult.items.map((t) => t.id)).toEqual([done.id]);
      expect(completedResult.items[0]?.displayStatus).toBe("completed");
    });

    it("特急永不 overdue — no dueAt means no computed status, however old the ticket", async () => {
      const now = Date.now();
      const urgent = await makeTicket(
        { complaintLevel: "特急投诉" },
        {
          createdAt: new Date(now - 100 * HOUR_MS),
        },
      );

      expect((await manager().ticket.list({ status: "overdue" })).total).toBe(0);
      expect((await manager().ticket.list({ status: "pending_timeout" })).total).toBe(0);

      const result = await manager().ticket.list({ status: "unassigned" });
      expect(result.items.map((t) => t.id)).toEqual([urgent.id]);
      expect(result.items[0]?.displayStatus).toBe("unassigned");
    });
  });

  describe("computed-status boundaries at exactly 2h / dueAt (fixed clock, PRD §3.1.6)", () => {
    it("agrees with deriveDisplayStatus on both edges of the window", async () => {
      const fixedNow = new Date();
      const clock = { now: () => fixedNow };
      const viewer = authUserFor(seeded.users.manager, seeded.roles.csManager);
      const list = (status: "assigned" | "pending_timeout" | "overdue") =>
        listTickets({ prisma, clock }, viewer, {
          status,
          sortBy: "createdAt",
          sortOrder: "desc",
          page: 1,
          pageSize: 20,
        });

      const at = (offsetMs: number) => new Date(fixedNow.getTime() + offsetMs);
      const exactlyTwoHours = await makeTicket(
        { customerName: "整两小时" },
        {
          status: "assigned",
          dueAt: at(2 * HOUR_MS),
        },
      );
      const justInsideWindow = await makeTicket(
        { customerName: "差一毫秒两小时" },
        {
          status: "assigned",
          dueAt: at(2 * HOUR_MS - 1),
        },
      );
      const exactlyDue = await makeTicket(
        { customerName: "恰在时限" },
        {
          status: "assigned",
          dueAt: fixedNow,
        },
      );
      const justPastDue = await makeTicket(
        { customerName: "刚过时限" },
        {
          status: "assigned",
          dueAt: at(-1),
        },
      );

      // 不足 2 小时 is strict: exactly 2h left is still the base status
      expect((await list("assigned")).items.map((t) => t.id)).toEqual([exactlyTwoHours.id]);

      // 已超过 is strict: at the dueAt instant the ticket is pending, not overdue
      const pendingIds = (await list("pending_timeout")).items.map((t) => t.id);
      expect(pendingIds).toHaveLength(2);
      expect(pendingIds).toContain(justInsideWindow.id);
      expect(pendingIds).toContain(exactlyDue.id);

      expect((await list("overdue")).items.map((t) => t.id)).toEqual([justPastDue.id]);
    });
  });

  describe("channel / complaintLevel / source filters", () => {
    it("filters by each dimension and combines them", async () => {
      const payment = await makeTicket({ channel: "支付", complaintLevel: "高级投诉" });
      const regulator = await makeTicket({ channel: "监管", complaintLevel: "高级投诉" });
      await makeTicket({ channel: "保司", complaintLevel: "一般投诉" });

      expect((await manager().ticket.list({ channel: "支付" })).items.map((t) => t.id)).toEqual([
        payment.id,
      ]);

      const highLevel = await manager().ticket.list({ complaintLevel: "高级投诉" });
      expect(highLevel.items.map((t) => t.id).sort()).toEqual([payment.id, regulator.id].sort());

      const combined = await manager().ticket.list({ channel: "监管", complaintLevel: "高级投诉" });
      expect(combined.items.map((t) => t.id)).toEqual([regulator.id]);
    });

    it("filters by source — external rows surface once integrations write them", async () => {
      await makeTicket();
      const feishu = await makeTicket({}, { source: "feishu_form", creatorId: null });

      const result = await manager().ticket.list({ source: "feishu_form" });
      expect(result.items.map((t) => t.id)).toEqual([feishu.id]);
      expect(result.items[0]?.source).toBe("feishu_form");
    });
  });

  describe("数据范围隔离 (PRD §5.2)", () => {
    it("without ticket.view_all the list is pinned to own tickets — the unassigned pool is invisible", async () => {
      await makeTicket({ customerName: "无人认领" }); // unassigned pool
      const own = await makeTicket(
        { customerName: "小李的单" },
        {
          status: "assigned",
          assigneeId: seeded.users.cs1.id,
          assignedAt: new Date(),
        },
      );
      const someoneElses = await makeTicket(
        { customerName: "主管的单" },
        {
          status: "assigned",
          assigneeId: seeded.users.manager.id,
          assignedAt: new Date(),
        },
      );

      const frontlineResult = await frontline().ticket.list({});
      expect(frontlineResult.total).toBe(1);
      expect(frontlineResult.items.map((t) => t.id)).toEqual([own.id]);

      // ticket.view_all (主管 and 只读观察) sees everything, unassigned pool included
      for (const caller of [manager(), observer()]) {
        const all = await caller.ticket.list({});
        expect(all.total).toBe(3);
        expect(all.items.map((t) => t.id)).toContain(someoneElses.id);
      }
    });

    it("filters stay inside the viewer's scope, never widen it", async () => {
      await makeTicket({ channel: "支付", customerName: "别人的支付单" });
      const own = await makeTicket(
        { channel: "支付", customerName: "自己的支付单" },
        {
          status: "assigned",
          assigneeId: seeded.users.cs1.id,
        },
      );

      const result = await frontline().ticket.list({ channel: "支付" });
      expect(result.items.map((t) => t.id)).toEqual([own.id]);
    });
  });

  describe("search: 工单号 / 客户姓名 / 保单号", () => {
    it("matches partial work-order number, customer name, and policy number", async () => {
      const zhang = await makeTicket({ customerName: "张三丰", policyNumber: "PA-88001" });
      const li = await makeTicket({ customerName: "李四", policyNumber: "PB-99002" });

      const byNumber = await manager().ticket.list({ search: zhang.workOrderNumber });
      expect(byNumber.items.map((t) => t.id)).toEqual([zhang.id]);

      const byName = await manager().ticket.list({ search: "三丰" });
      expect(byName.items.map((t) => t.id)).toEqual([zhang.id]);

      // All three search fields match case-insensitively (names can be Latin)
      const alice = await makeTicket({ customerName: "Alice Wang", policyNumber: "PC-77003" });
      const byLatinName = await manager().ticket.list({ search: "alice" });
      expect(byLatinName.items.map((t) => t.id)).toEqual([alice.id]);

      const byPolicy = await manager().ticket.list({ search: "99002" });
      expect(byPolicy.items.map((t) => t.id)).toEqual([li.id]);

      expect((await manager().ticket.list({ search: "毫无匹配" })).total).toBe(0);
    });

    it("treats blank search as no search", async () => {
      await makeTicket();
      expect((await manager().ticket.list({ search: "   " })).total).toBe(1);
    });
  });

  describe("sort: 创建时间 / dueAt", () => {
    it("orders by createdAt in both directions", async () => {
      const now = Date.now();
      const oldest = await makeTicket({}, { createdAt: new Date(now - 3 * HOUR_MS) });
      const middle = await makeTicket({}, { createdAt: new Date(now - 2 * HOUR_MS) });
      const newest = await makeTicket({}, { createdAt: new Date(now - HOUR_MS) });

      const asc = await manager().ticket.list({ sortBy: "createdAt", sortOrder: "asc" });
      expect(asc.items.map((t) => t.id)).toEqual([oldest.id, middle.id, newest.id]);

      const desc = await manager().ticket.list({ sortBy: "createdAt", sortOrder: "desc" });
      expect(desc.items.map((t) => t.id)).toEqual([newest.id, middle.id, oldest.id]);
    });

    it("orders by dueAt with 特急 (no dueAt) always last", async () => {
      const now = Date.now();
      const later = await makeTicket({}, { dueAt: new Date(now + 40 * HOUR_MS) });
      const sooner = await makeTicket({}, { dueAt: new Date(now + 10 * HOUR_MS) });
      const urgent = await makeTicket({ complaintLevel: "特急投诉" }); // dueAt null

      const asc = await manager().ticket.list({ sortBy: "dueAt", sortOrder: "asc" });
      expect(asc.items.map((t) => t.id)).toEqual([sooner.id, later.id, urgent.id]);

      const desc = await manager().ticket.list({ sortBy: "dueAt", sortOrder: "desc" });
      expect(desc.items.map((t) => t.id)).toEqual([later.id, sooner.id, urgent.id]);
    });
  });

  describe("pagination", () => {
    it("slices stable pages and reports the filtered total", async () => {
      for (let i = 0; i < 5; i++) {
        await makeTicket({ customerName: `分页客户${i}` });
      }

      const page1 = await manager().ticket.list({ pageSize: 2, page: 1 });
      const page2 = await manager().ticket.list({ pageSize: 2, page: 2 });
      const page3 = await manager().ticket.list({ pageSize: 2, page: 3 });

      expect(page1.total).toBe(5);
      expect(page1.items).toHaveLength(2);
      expect(page2.items).toHaveLength(2);
      expect(page3.items).toHaveLength(1);

      const seen = [...page1.items, ...page2.items, ...page3.items].map((t) => t.id);
      expect(new Set(seen).size).toBe(5); // no row skipped or repeated across pages
    });
  });

  describe("performance (PRD §6.1)", () => {
    it("loads 100 rows in under 1 second", async () => {
      const now = Date.now();
      await prisma.ticket.createMany({
        data: Array.from({ length: 120 }, (_, i) => ({
          feedbackTime: new Date(now - i * 60_000),
          source: "manual",
          channel: "保司",
          project: "融盛",
          brokerageEntity: "东方大地",
          paymentChannel: "连连支付",
          policyNumber: `P-${i}`,
          userComplaintChannel: "400热线",
          customerName: `压测客户${i}`,
          phone: "13800000000",
          customerRequest: "压测数据",
          nuclearBodyStatus: "待核实",
          hasContacted: false,
          category: "投诉-保费收取问题",
          complaintLevel: "一般投诉",
          dueAt: new Date(now + (i - 60) * HOUR_MS),
          followUpFrequency: "24小时内累计跟进1次；48小时内累计跟进2次",
          firstResponseRequirement: "120分钟内完成首次响应",
        })),
      });

      const startedAt = performance.now();
      const result = await manager().ticket.list({ pageSize: 100 });
      const elapsedMs = performance.now() - startedAt;

      expect(result.items).toHaveLength(100);
      expect(result.total).toBe(120);
      expect(elapsedMs).toBeLessThan(1000);
    });
  });
});
