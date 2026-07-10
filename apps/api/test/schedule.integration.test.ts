import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Channel, Permission, TicketCreateInput } from "@insuredesk/shared";
import type { PrismaClient, Role, User } from "@prisma/client";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fixedClock } from "../src/clock";
import type { AuthenticatedUser } from "../src/services/auth.service";
// Type-only, so it is erased and never loads src/db before DATABASE_URL is set
import type * as AssignService from "../src/services/ticket-assign.service";

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Issue #31 acceptance tests against a real Postgres: the 排班日历 CRUD
 * (stamped shift windows, the unique roster cell, schedule.view/edit RBAC)
 * and 按排班自动分配 (PRD §4.3.4) — channel + on-shift candidate matching,
 * least-在手 selection, the random tie-break, the no-on-duty boundary, and
 * that an auto pick rides the exact same write path as manual assignment
 * (assign + status_change logs, inbox notification, assignedAt, dueAt
 * untouched).
 *
 * The on-shift predicate depends on "now", so algorithm cases call the
 * service with a fixed clock (the router runs the system clock), mirroring
 * the todo-test setup. Rosters are set up through the real schedule.create
 * procedure; each case uses its own duty date so cases never see each
 * other's rosters, and fresh duty users so 在手 baselines start at zero.
 */
describe("schedule + auto-assign (Testcontainers)", () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let appRouter: typeof import("../src/routers/index").appRouter;
  let autoAssignTicketsBySchedule: typeof AssignService.autoAssignTicketsBySchedule;
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

    const [{ prisma: appPrisma }, seedData, routers, assignService] = await Promise.all([
      import("../src/db"),
      import("../prisma/seed-data"),
      import("../src/routers/index"),
      import("../src/services/ticket-assign.service"),
    ]);
    prisma = appPrisma;
    appRouter = routers.appRouter;
    autoAssignTicketsBySchedule = assignService.autoAssignTicketsBySchedule;

    seeded = await seedData.seedPresetRolesAndUsers(prisma);
    await seedData.seedSlaPolicies(prisma);
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  function identityOf(user: User, roleName: string, permissions: Permission[]): AuthenticatedUser {
    return {
      id: user.id,
      username: user.username,
      name: user.name,
      email: user.email,
      roleId: "role-under-test",
      roleName,
      permissions,
    };
  }

  /** Caller with the given user identity and an explicit permission set. */
  function callerWith(user: User, roleName: string, permissions: Permission[]) {
    return appRouter.createCaller({
      traceId: "schedule-test",
      user: identityOf(user, roleName, permissions),
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

  /** The manager acting through the SERVICE (for fixed-clock algorithm cases). */
  const managerActor = () =>
    identityOf(
      seeded.users.manager,
      seeded.roles.csManager.name,
      seeded.roles.csManager.permissions as Permission[],
    );

  const baseInput = {
    feedbackTime: "2026-07-09T02:00:00.000Z",
    channel: "保司",
    project: "融盛",
    brokerageEntity: "东方大地",
    paymentChannel: "连连支付",
    policyNumber: "P2026070900321",
    userComplaintChannel: "400热线",
    customerName: "赵排班",
    phone: "13800000001",
    customerRequest: "对理赔进度有异议，要求尽快处理",
    nuclearBodyStatus: "待核实",
    hasContacted: false,
    category: "理赔投诉",
    complaintLevel: "一般投诉",
  } satisfies TicketCreateInput;

  /** A fresh unassigned ticket, created through the real create procedure. */
  async function createTicket(channel: Channel = "保司") {
    const created = await manager().ticket.create({ ...baseInput, channel });
    return created.id;
  }

  let userSeq = 0;
  /** A fresh active user — never assigned anything, so 在手 starts at zero. */
  async function makeDutyUser(name: string) {
    userSeq += 1;
    return prisma.user.create({
      data: {
        username: `duty${userSeq}`,
        name,
        roleId: seeded.roles.frontline.id,
        active: true,
      },
    });
  }

  /**
   * Run 按排班自动分配 through the service with time pinned to `at` — the
   * roster window predicate depends on "now", which the router's system
   * clock can't hold still.
   */
  function autoAssignAt(at: Date, ticketIds: string[]) {
    return autoAssignTicketsBySchedule({ prisma, clock: fixedClock(at) }, managerActor(), {
      ticketIds,
    });
  }

  /** Local wall-clock instant of `date` at hour:minute (matches roster strings). */
  function localInstant(date: string, hour: number, minute = 0) {
    const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
    return new Date(year, month - 1, day, hour, minute);
  }

  describe("排班日历 CRUD", () => {
    it("stamps the shift window from the shift type and lists the entry", async () => {
      const dayEntry = await manager().schedule.create({
        date: "2026-08-01",
        shift: "day",
        channel: "保司",
        userId: seeded.users.cs1.id,
        remark: "带教新人",
      });
      expect(dayEntry.userName).toBe(seeded.users.cs1.name);

      await manager().schedule.create({
        date: "2026-08-01",
        shift: "night",
        channel: "经纪",
        userId: seeded.users.cs1.id,
      });

      const entries = await manager().schedule.list({ date: "2026-08-01" });
      expect(entries).toHaveLength(2);
      expect(entries[0]).toMatchObject({
        shift: "day",
        startTime: "09:00",
        endTime: "18:00",
        channel: "保司",
        userId: seeded.users.cs1.id,
        userName: seeded.users.cs1.name,
        remark: "带教新人",
      });
      expect(entries[1]).toMatchObject({
        shift: "night",
        startTime: "12:00",
        endTime: "21:00",
        channel: "经纪",
      });

      // Other days are untouched
      expect(await manager().schedule.list({ date: "2026-08-02" })).toEqual([]);
    });

    it("rejects the same person twice on one date × shift × channel cell", async () => {
      await manager().schedule.create({
        date: "2026-08-03",
        shift: "day",
        channel: "支付",
        userId: seeded.users.cs1.id,
      });

      await expect(
        manager().schedule.create({
          date: "2026-08-03",
          shift: "day",
          channel: "支付",
          userId: seeded.users.cs1.id,
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });

      // …but the same person on another shift/channel of the day is fine
      await manager().schedule.create({
        date: "2026-08-03",
        shift: "night",
        channel: "支付",
        userId: seeded.users.cs1.id,
      });
    });

    it("rejects unknown/inactive duty users and malformed dates", async () => {
      await expect(
        manager().schedule.create({
          date: "2026-08-04",
          shift: "day",
          channel: "保司",
          userId: "no-such-user",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });

      const inactive = await prisma.user.create({
        data: {
          username: "duty-gone",
          name: "已停用值班人",
          roleId: seeded.roles.frontline.id,
          active: false,
        },
      });
      await expect(
        manager().schedule.create({
          date: "2026-08-04",
          shift: "day",
          channel: "保司",
          userId: inactive.id,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });

      // Well-formed but impossible calendar date
      await expect(manager().schedule.list({ date: "2026-02-31" })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    });

    it("deletes an entry; deleting it again is NOT_FOUND", async () => {
      const created = await manager().schedule.create({
        date: "2026-08-05",
        shift: "day",
        channel: "监管",
        userId: seeded.users.cs1.id,
      });

      await manager().schedule.delete({ id: created.id });
      expect(await manager().schedule.list({ date: "2026-08-05" })).toEqual([]);

      await expect(manager().schedule.delete({ id: created.id })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("RBAC: schedule.view gates the read, schedule.edit gates every write", async () => {
      for (const caller of [frontline(), observer()]) {
        await expect(caller.schedule.list({ date: "2026-08-01" })).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
        await expect(
          caller.schedule.create({
            date: "2026-08-01",
            shift: "day",
            channel: "保司",
            userId: seeded.users.cs1.id,
          }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
        await expect(caller.schedule.delete({ id: "whatever" })).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
        await expect(caller.schedule.dutyUserOptions()).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
      }

      // view without edit: may read, may not write
      const viewer = callerWith(seeded.users.observer, "仅看排班", ["schedule.view"]);
      expect(await viewer.schedule.list({ date: "2026-08-01" })).toBeInstanceOf(Array);
      await expect(
        viewer.schedule.create({
          date: "2026-08-01",
          shift: "day",
          channel: "保司",
          userId: seeded.users.cs1.id,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("按排班自动分配: candidate matching (channel + 在班)", () => {
    it("only the ticket channel's currently-on-shift duty users are candidates", async () => {
      const date = "2026-07-15";
      const rightChannel = await makeDutyUser("保司早班");
      const wrongChannel = await makeDutyUser("经纪早班");
      const offShift = await makeDutyUser("保司晚班");

      await manager().schedule.create({
        date,
        shift: "day",
        channel: "保司",
        userId: rightChannel.id,
      });
      await manager().schedule.create({
        date,
        shift: "day",
        channel: "经纪",
        userId: wrongChannel.id,
      });
      await manager().schedule.create({
        date,
        shift: "night",
        channel: "保司",
        userId: offShift.id,
      });

      // 10:00 — day shift on duty, night shift (12:00–21:00) not yet
      const ticketId = await createTicket("保司");
      const result = await autoAssignAt(localInstant(date, 10), [ticketId]);

      expect(result.skipped).toEqual([]);
      expect(result.assigned).toEqual([
        expect.objectContaining({ ticketId, assigneeName: rightChannel.name }),
      ]);

      const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } });
      expect(ticket.assigneeId).toBe(rightChannel.id);
      expect(ticket.status).toBe("assigned");
    });

    it("shift windows are start-inclusive, end-exclusive; both shifts overlap midday", async () => {
      const date = "2026-07-16";
      const dayDuty = await makeDutyUser("边界早班");
      await manager().schedule.create({ date, shift: "day", channel: "支付", userId: dayDuty.id });

      // 09:00 sharp — the day shift has just arrived
      const atOpen = await createTicket("支付");
      const openResult = await autoAssignAt(localInstant(date, 9, 0), [atOpen]);
      expect(openResult.assigned).toHaveLength(1);

      // 18:00 sharp — the day shift has left, nobody is on duty
      const atClose = await createTicket("支付");
      const closeResult = await autoAssignAt(localInstant(date, 18, 0), [atClose]);
      expect(closeResult.assigned).toEqual([]);
      expect(closeResult.skipped).toEqual([
        expect.objectContaining({ ticketId: atClose, channel: "支付" }),
      ]);

      // 13:00 — day and night overlap: a night-shift colleague is also a candidate
      const nightDuty = await makeDutyUser("边界晚班");
      await manager().schedule.create({
        date,
        shift: "night",
        channel: "支付",
        userId: nightDuty.id,
      });
      // day duty already carries the 09:00 ticket → the idle night duty wins
      const midday = await createTicket("支付");
      const middayResult = await autoAssignAt(localInstant(date, 13), [midday]);
      expect(middayResult.assigned).toEqual([
        expect.objectContaining({ assigneeName: nightDuty.name }),
      ]);
    });

    it("deactivated duty users are never candidates even if still rostered", async () => {
      const date = "2026-07-17";
      const retiring = await makeDutyUser("停用前排班");
      await manager().schedule.create({ date, shift: "day", channel: "监管", userId: retiring.id });
      await prisma.user.update({ where: { id: retiring.id }, data: { active: false } });

      const ticketId = await createTicket("监管");
      const result = await autoAssignAt(localInstant(date, 10), [ticketId]);
      expect(result.assigned).toEqual([]);
      expect(result.skipped).toEqual([expect.objectContaining({ ticketId, channel: "监管" })]);
    });
  });

  describe("按排班自动分配: least 在手 selection", () => {
    it("picks the candidate with the fewest assigned+processing tickets", async () => {
      const date = "2026-07-18";
      const busy = await makeDutyUser("在手很多");
      const idle = await makeDutyUser("在手为零");
      await manager().schedule.create({ date, shift: "day", channel: "保司", userId: busy.id });
      await manager().schedule.create({ date, shift: "day", channel: "保司", userId: idle.id });

      // busy holds one assigned and one processing ticket
      for (const status of ["assigned", "processing"] as const) {
        const id = await createTicket("保司");
        await prisma.ticket.update({
          where: { id },
          data: { assigneeId: busy.id, status, assignedAt: new Date() },
        });
      }

      const ticketId = await createTicket("保司");
      const result = await autoAssignAt(localInstant(date, 10), [ticketId]);
      expect(result.assigned).toEqual([expect.objectContaining({ assigneeName: idle.name })]);
    });

    it("completed and soft-deleted tickets do not count as 在手", async () => {
      const date = "2026-07-19";
      const looksBusy = await makeDutyUser("只剩历史单");
      const trulyBusy = await makeDutyUser("真有在手单");
      await manager().schedule.create({
        date,
        shift: "day",
        channel: "保司",
        userId: looksBusy.id,
      });
      await manager().schedule.create({
        date,
        shift: "day",
        channel: "保司",
        userId: trulyBusy.id,
      });

      // looksBusy: one completed + one soft-deleted → 在手 = 0
      const completedId = await createTicket("保司");
      await prisma.ticket.update({
        where: { id: completedId },
        data: { assigneeId: looksBusy.id, status: "completed", completionTime: new Date() },
      });
      const deletedId = await createTicket("保司");
      await prisma.ticket.update({
        where: { id: deletedId },
        data: { assigneeId: looksBusy.id, status: "assigned", deletedAt: new Date() },
      });
      // trulyBusy: one live assigned ticket → 在手 = 1
      const liveId = await createTicket("保司");
      await prisma.ticket.update({
        where: { id: liveId },
        data: { assigneeId: trulyBusy.id, status: "assigned", assignedAt: new Date() },
      });

      const ticketId = await createTicket("保司");
      const result = await autoAssignAt(localInstant(date, 10), [ticketId]);
      expect(result.assigned).toEqual([expect.objectContaining({ assigneeName: looksBusy.name })]);
    });

    it("平手随机取一: a tie lands on one of the tied candidates", async () => {
      const date = "2026-07-20";
      const tiedA = await makeDutyUser("平手甲");
      const tiedB = await makeDutyUser("平手乙");
      await manager().schedule.create({ date, shift: "day", channel: "经纪", userId: tiedA.id });
      await manager().schedule.create({ date, shift: "day", channel: "经纪", userId: tiedB.id });

      const ticketId = await createTicket("经纪");
      const result = await autoAssignAt(localInstant(date, 10), [ticketId]);
      expect(result.assigned).toHaveLength(1);
      expect([tiedA.name, tiedB.name]).toContain(result.assigned[0]?.assigneeName);
    });

    it("one multi-ticket action counts its own picks: two tickets spread over two idle candidates", async () => {
      const date = "2026-07-21";
      const first = await makeDutyUser("分摊甲");
      const second = await makeDutyUser("分摊乙");
      await manager().schedule.create({ date, shift: "day", channel: "监管", userId: first.id });
      await manager().schedule.create({ date, shift: "day", channel: "监管", userId: second.id });

      const ticketA = await createTicket("监管");
      const ticketB = await createTicket("监管");
      const result = await autoAssignAt(localInstant(date, 10), [ticketA, ticketB]);

      // Without counting in-action picks, both would land on the same person
      expect(result.assigned).toHaveLength(2);
      const names = result.assigned.map((entry) => entry.assigneeName).sort();
      expect(names).toEqual([first.name, second.name].sort());
    });
  });

  describe("按排班自动分配: no-on-duty boundary", () => {
    it("a channel with nobody on duty is skipped and reported, the ticket untouched", async () => {
      const date = "2026-07-22"; // no roster at all this day
      const ticketId = await createTicket("支付");
      const result = await autoAssignAt(localInstant(date, 10), [ticketId]);

      expect(result.assigned).toEqual([]);
      expect(result.skipped).toEqual([
        { ticketId, workOrderNumber: expect.any(String), channel: "支付", reason: "no_on_duty" },
      ]);

      const detail = await manager().ticket.detail({ id: ticketId });
      expect(detail.status).toBe("unassigned");
      expect(detail.assigneeId).toBeNull();
      expect(detail.processLogs.map((log) => log.action)).toEqual(["create"]);
    });

    it("a mixed batch assigns covered channels and skips the uncovered ones", async () => {
      const date = "2026-07-23";
      const onDuty = await makeDutyUser("有人渠道");
      await manager().schedule.create({ date, shift: "day", channel: "保司", userId: onDuty.id });

      const covered = await createTicket("保司");
      const uncovered = await createTicket("监管");
      const result = await autoAssignAt(localInstant(date, 10), [covered, uncovered]);

      expect(result.assigned).toEqual([
        expect.objectContaining({ ticketId: covered, assigneeName: onDuty.name }),
      ]);
      expect(result.skipped).toEqual([
        expect.objectContaining({ ticketId: uncovered, channel: "监管" }),
      ]);
    });
  });

  describe("按排班自动分配: same write path as manual assignment (router)", () => {
    /** Roster the user for today with an always-on window (system clock case). */
    async function rosterToday(userId: string, channel: Channel) {
      const { localDateTimeParts } = await import("../src/services/schedule.service");
      return prisma.schedule.create({
        data: {
          date: localDateTimeParts(new Date()).date,
          shift: "day",
          startTime: "00:00",
          endTime: "23:59",
          channel,
          userId,
        },
      });
    }

    it("writes assigneeId/assignedAt/status + the assign & status_change log pair + the inbox notification; dueAt untouched", async () => {
      const duty = await makeDutyUser("全链路值班");
      await rosterToday(duty.id, "保司");

      const ticketId = await createTicket("保司");
      const before = await manager().ticket.detail({ id: ticketId });

      const result = await manager().ticket.autoAssign({ ticketIds: [ticketId] });
      expect(result.assigned).toEqual([
        expect.objectContaining({ ticketId, assigneeName: duty.name }),
      ]);

      const detail = await manager().ticket.detail({ id: ticketId });
      expect(detail.assigneeId).toBe(duty.id);
      expect(detail.status).toBe("assigned");
      expect(detail.assignedAt).not.toBeNull();
      // dueAt fixed at creation; auto-assignment must not recompute it (ADR 0002)
      expect(detail.dueAt).toBe(before.dueAt);

      // Identical trail to manual assignment: assign first, then status_change
      expect(detail.processLogs.map((log) => log.action)).toEqual([
        "create",
        "assign",
        "status_change",
      ]);
      const [, assignLog, statusLog] = detail.processLogs;
      expect(assignLog).toMatchObject({
        operatorId: seeded.users.manager.id,
        operatorName: seeded.users.manager.name,
        from: null,
        to: duty.name,
      });
      expect(statusLog).toMatchObject({ from: "unassigned", to: "assigned" });

      // 轨 1 收件箱: the new assignee is notified inside the same transaction
      const notification = await prisma.appNotification.findFirst({
        where: { ticketId },
      });
      expect(notification).toMatchObject({ type: "assigned", targetUserId: duty.id });

      await prisma.schedule.deleteMany({ where: { userId: duty.id } });
    });

    it("aborts the whole action on completed, already-assigned, deleted, or unknown tickets", async () => {
      const duty = await makeDutyUser("异常值班");
      await rosterToday(duty.id, "保司");

      const okId = await createTicket("保司");

      const completedId = await createTicket("保司");
      await prisma.ticket.update({ where: { id: completedId }, data: { status: "completed" } });
      await expect(
        manager().ticket.autoAssign({ ticketIds: [okId, completedId] }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

      const assignedId = await createTicket("保司");
      await manager().ticket.assign({ ticketId: assignedId, assigneeId: seeded.users.cs1.id });
      await expect(
        manager().ticket.autoAssign({ ticketIds: [okId, assignedId] }),
      ).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: expect.stringContaining("仅适用于未分配工单"),
      });

      const deletedId = await createTicket("保司");
      await prisma.ticket.update({ where: { id: deletedId }, data: { deletedAt: new Date() } });
      await expect(
        manager().ticket.autoAssign({ ticketIds: [okId, deletedId] }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });

      await expect(
        manager().ticket.autoAssign({ ticketIds: [okId, "no-such-ticket"] }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });

      // The healthy ticket was never partially assigned
      const detail = await manager().ticket.detail({ id: okId });
      expect(detail.status).toBe("unassigned");
      expect(detail.processLogs.map((log) => log.action)).toEqual(["create"]);

      await prisma.schedule.deleteMany({ where: { userId: duty.id } });
    });

    it("RBAC: one ticket rides ticket.assign; more than one additionally needs ticket.batch_assign", async () => {
      // 经纪 is never rostered for the real today in this file, so these stay
      // in the skipped (yet guard-passing) path regardless of test order
      const ticketA = await createTicket("经纪");
      const ticketB = await createTicket("经纪");

      for (const caller of [frontline(), observer()]) {
        await expect(caller.ticket.autoAssign({ ticketIds: [ticketA] })).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
      }

      // single-assign only: one ticket passes the guard, two do not
      const singleOnly = callerWith(seeded.users.manager, "仅单派", [
        "ticket.view",
        "ticket.view_all",
        "ticket.assign",
      ]);
      // (no roster today → skipped, but the guard let it through)
      const singleResult = await singleOnly.ticket.autoAssign({ ticketIds: [ticketA] });
      expect(singleResult.assigned.length + singleResult.skipped.length).toBe(1);
      await expect(
        singleOnly.ticket.autoAssign({ ticketIds: [ticketA, ticketB] }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      // batch-assign only: multi-ticket passes the guard
      const batchOnly = callerWith(seeded.users.manager, "仅批量", [
        "ticket.view",
        "ticket.view_all",
        "ticket.batch_assign",
      ]);
      const batchResult = await batchOnly.ticket.autoAssign({ ticketIds: [ticketA, ticketB] });
      expect(batchResult.assigned.length + batchResult.skipped.length).toBe(2);
    });

    it("applies the data scope: an assigner without ticket.view_all cannot reach the unassigned pool", async () => {
      const ticketId = await createTicket("保司");
      const scoped = callerWith(seeded.users.cs1, "受限分配员", ["ticket.view", "ticket.assign"]);
      await expect(scoped.ticket.autoAssign({ ticketIds: [ticketId] })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });
});
