import type { Permission, TicketCreateInput } from "@insuredesk/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fixedClock } from "../src/clock.ts";
import type { PrismaClient, User } from "../src/generated/prisma/client.ts";
import { appRouter } from "../src/routers/index.ts";
import type { AuthenticatedUser } from "../src/services/auth.service.ts";
import { findOnDutyUserIds } from "../src/services/schedule.service.ts";
import { autoAssignTicketsBySchedule } from "../src/services/ticket-assign.service.ts";
import { type IntegrationHarness, startIntegrationHarness } from "./integration-harness.ts";

/**
 * Real Postgres exercises user/day uniqueness, shift JSON, RBAC, assignment
 * transactions, load aggregation, logs, and notification writes together.
 */
describe("schedule workflow and schedule-based auto assignment (Testcontainers)", () => {
  let harness: IntegrationHarness;
  let seededChannelId: string | null;
  let prisma: PrismaClient;
  let seeded: IntegrationHarness["seeded"];

  beforeAll(async () => {
    harness = await startIntegrationHarness({
      seed: ["rolesAndUsers", "slaPolicies", "shiftTypes", "channels"],
    });
    prisma = harness.prisma;
    seeded = harness.seeded;
    // 渠道只是分类维度：造一张带渠道的单，证明路由对它视而不见
    seededChannelId = harness.channelId("保司");
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  });

  function identityOf(user: User, roleName: string, permissions: Permission[]): AuthenticatedUser {
    return {
      id: user.id,
      username: user.username,
      name: user.name,
      email: user.email,
      team: user.team,
      roleId: "role-under-test",
      roleName,
      permissions,
      requiredTicketFields: [],
      isExternal: false,
    };
  }

  function callerWith(user: User, roleName: string, permissions: Permission[]) {
    return appRouter.createCaller({
      traceId: "schedule-test",
      user: identityOf(user, roleName, permissions),
      sessionToken: null,
    });
  }

  const manager = () =>
    callerWith(
      seeded.users.manager,
      seeded.roles.csManager.name,
      seeded.roles.csManager.permissions as Permission[],
    );
  const managerActor = () =>
    identityOf(
      seeded.users.manager,
      seeded.roles.csManager.name,
      seeded.roles.csManager.permissions as Permission[],
    );

  let userSequence = 0;
  async function makeDutyUser(name: string, active = true) {
    userSequence += 1;
    return prisma.user.create({
      data: {
        username: `schedule-user-${userSequence}`,
        name,
        roleId: seeded.roles.frontline.id,
        active,
      },
    });
  }

  const baseTicketInput = {
    feedbackTime: "2026-07-09T02:00:00.000Z",
    customerName: "赵排班",
    phone: "13800000001",
    customerRequest: "请尽快处理",
    nuclearBodyStatus: "待核实",
    hasContacted: false,
    allowDuplicate: true,
  } satisfies TicketCreateInput & { allowDuplicate?: boolean };

  async function createTicket(channelId: string | null = null) {
    return (
      await manager().ticket.create({
        ...baseTicketInput,
        channelId,
        slaPolicyId: harness.slaPolicyId("一般投诉"),
      })
    ).id;
  }

  function localInstant(date: string, hour: number, minute = 0) {
    const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
    return new Date(year, month - 1, day, hour, minute);
  }

  function autoAssignAt(at: Date, ticketIds: string[]) {
    return autoAssignTicketsBySchedule({ prisma, clock: fixedClock(at) }, managerActor(), {
      ticketIds,
    });
  }

  describe("schedule CRUD API", () => {
    it("sets and replaces user/day cells, then lists a complete date-range grid", async () => {
      const early = await prisma.shiftType.findUniqueOrThrow({ where: { name: "早班" } });
      const full = await prisma.shiftType.findUniqueOrThrow({ where: { name: "全班" } });
      const user = await makeDutyUser("网格客服");

      const created = await manager().schedule.create({
        date: "2099-08-03",
        userId: user.id,
        shiftId: early.id,
        remark: "上午值班",
      });
      expect(created).toMatchObject({
        date: "2099-08-03",
        userId: user.id,
        shiftId: early.id,
        remark: "上午值班",
      });

      const replaced = await manager().schedule.create({
        date: "2099-08-03",
        userId: user.id,
        shiftId: full.id,
      });
      expect(replaced).toMatchObject({ id: created.id, shiftId: full.id, remark: null });

      await manager().schedule.create({
        date: "2099-08-05",
        userId: user.id,
        shiftId: early.id,
      });

      const grid = await manager().schedule.list({
        startDate: "2099-08-02",
        endDate: "2099-08-04",
      });
      expect(grid.entries).toEqual([
        expect.objectContaining({
          id: created.id,
          date: "2099-08-03",
          userId: user.id,
          userName: user.name,
          shiftId: full.id,
          shiftName: full.name,
        }),
      ]);
      expect(grid.users).toContainEqual(
        expect.objectContaining({ id: user.id, name: user.name, active: true }),
      );
      expect(grid.shifts.map((shift) => shift.name)).toEqual(["早班", "晚班", "全班", "休"]);
    });

    it("deletes a cell, validates targets and ranges, and enforces schedule permissions", async () => {
      const early = await prisma.shiftType.findUniqueOrThrow({ where: { name: "早班" } });
      const user = await makeDutyUser("待清除客服");
      const inactive = await makeDutyUser("停用客服", false);
      const created = await manager().schedule.create({
        date: "2099-08-06",
        userId: user.id,
        shiftId: early.id,
      });

      await expect(manager().schedule.delete({ id: created.id })).resolves.toEqual({
        id: created.id,
      });
      await expect(manager().schedule.delete({ id: created.id })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(
        manager().schedule.create({
          date: "2099-08-06",
          userId: inactive.id,
          shiftId: early.id,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(
        manager().schedule.create({
          date: "2099-08-06",
          userId: user.id,
          shiftId: "missing-shift",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(
        manager().schedule.list({ startDate: "2099-08-07", endDate: "2099-08-06" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });

      const viewer = callerWith(seeded.users.observer, "排班查看者", ["schedule.view"]);
      await expect(
        viewer.schedule.list({ startDate: "2099-08-01", endDate: "2099-08-07" }),
      ).resolves.toMatchObject({ entries: expect.any(Array) });
      await expect(
        viewer.schedule.create({
          date: "2099-08-07",
          userId: user.id,
          shiftId: early.id,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      const noAccess = callerWith(seeded.users.observer, "无排班权限", []);
      await expect(
        noAccess.schedule.list({ startDate: "2099-08-01", endDate: "2099-08-07" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("findOnDutyUserIds", () => {
    it("uses wall-clock comparisons across multiple segments and excludes zero-segment shifts", async () => {
      const split = await prisma.shiftType.create({
        data: {
          name: "测试拆分班",
          color: "#7c3aed",
          segments: [
            { start: "09:00", end: "12:00" },
            { start: "14:00", end: "18:00" },
          ],
          displayOrder: 40,
        },
      });
      const rest = await prisma.shiftType.findUniqueOrThrow({ where: { name: "休" } });
      const working = await makeDutyUser("拆分班客服");
      const resting = await makeDutyUser("休息客服");
      await manager().schedule.create({
        date: "2099-08-10",
        userId: working.id,
        shiftId: split.id,
      });
      await manager().schedule.create({
        date: "2099-08-10",
        userId: resting.id,
        shiftId: rest.id,
      });

      expect(await findOnDutyUserIds(prisma, "2099-08-10", "09:00")).toEqual([working.id]);
      expect(await findOnDutyUserIds(prisma, "2099-08-10", "12:00")).toEqual([]);
      expect(await findOnDutyUserIds(prisma, "2099-08-10", "14:30")).toEqual([working.id]);
      expect(await findOnDutyUserIds(prisma, "2099-08-10", "18:00")).toEqual([]);
    });

    it("carries an overnight segment into the following wall-clock date", async () => {
      const overnight = await prisma.shiftType.create({
        data: {
          name: "测试夜班",
          color: "#312e81",
          segments: [{ start: "18:00", end: "02:00" }],
          displayOrder: 41,
        },
      });
      const user = await makeDutyUser("跨午夜客服");
      await manager().schedule.create({
        date: "2099-08-11",
        userId: user.id,
        shiftId: overnight.id,
      });

      expect(await findOnDutyUserIds(prisma, "2099-08-11", "18:00")).toEqual([user.id]);
      expect(await findOnDutyUserIds(prisma, "2099-08-12", "01:59")).toEqual([user.id]);
      expect(await findOnDutyUserIds(prisma, "2099-08-12", "02:00")).toEqual([]);
    });
  });

  describe("autoAssignTicketsBySchedule", () => {
    it("ignores ticket channel, spreads a batch across all on-duty people, and follows shift windows", async () => {
      const date = "2099-08-15";
      const early = await prisma.shiftType.findUniqueOrThrow({ where: { name: "早班" } });
      const full = await prisma.shiftType.findUniqueOrThrow({ where: { name: "全班" } });
      const rest = await prisma.shiftType.findUniqueOrThrow({ where: { name: "休" } });
      const userA = await makeDutyUser("演示客服 A");
      const userB = await makeDutyUser("演示客服 B");
      const resting = await makeDutyUser("休息中的客服");
      await manager().schedule.create({ date, userId: userA.id, shiftId: early.id });
      await manager().schedule.create({ date, userId: userB.id, shiftId: full.id });
      await manager().schedule.create({ date, userId: resting.id, shiftId: rest.id });

      const morningTickets = [await createTicket(seededChannelId), await createTicket()];
      const morning = await autoAssignAt(localInstant(date, 11), morningTickets);
      expect(morning.skipped).toEqual([]);
      expect(morning.assigned).toHaveLength(2);
      expect(morning.assigned.map((entry) => entry.assigneeName).sort()).toEqual(
        [userA.name, userB.name].sort(),
      );

      const afternoonTicket = await createTicket(null);
      const afternoon = await autoAssignAt(localInstant(date, 14), [afternoonTicket]);
      expect(afternoon.assigned).toEqual([
        expect.objectContaining({ ticketId: afternoonTicket, assigneeName: userB.name }),
      ]);
    });

    it("keeps least-in-hand balancing and reports no-on-duty tickets without channel reasons", async () => {
      const date = "2099-08-16";
      const full = await prisma.shiftType.findUniqueOrThrow({ where: { name: "全班" } });
      const busy = await makeDutyUser("忙客服");
      const idle = await makeDutyUser("闲客服");
      await manager().schedule.create({ date, userId: busy.id, shiftId: full.id });
      await manager().schedule.create({ date, userId: idle.id, shiftId: full.id });

      const existing = await createTicket();
      await prisma.ticket.update({
        where: { id: existing },
        data: { assigneeId: busy.id, status: "assigned", assignedAt: new Date() },
      });

      const target = await createTicket();
      const assigned = await autoAssignAt(localInstant(date, 11), [target]);
      expect(assigned.assigned).toEqual([
        expect.objectContaining({ ticketId: target, assigneeName: idle.name }),
      ]);

      const uncovered = await createTicket(null);
      const skipped = await autoAssignAt(localInstant("2099-08-17", 11), [uncovered]);
      expect(skipped).toEqual({
        assigned: [],
        skipped: [
          { ticketId: uncovered, workOrderNumber: expect.any(String), reason: "no_on_duty" },
        ],
      });
    });

    it("uses the normal assignment write path and preserves its permission boundary", async () => {
      const now = new Date();
      const pad = (value: number) => String(value).padStart(2, "0");
      const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      const alwaysOn = await prisma.shiftType.create({
        data: {
          name: `全天测试-${userSequence}`,
          color: "#0f766e",
          segments: [
            { start: "00:00", end: "23:59" },
            { start: "23:59", end: "00:00" },
          ],
          displayOrder: 50,
        },
      });
      const duty = await makeDutyUser("全链路值班客服");
      await manager().schedule.create({ date: today, userId: duty.id, shiftId: alwaysOn.id });

      const ticketId = await createTicket(null);
      const before = await manager().ticket.detail({ id: ticketId });
      const result = await manager().ticket.autoAssign({ ticketIds: [ticketId] });
      expect(result.assigned).toEqual([
        expect.objectContaining({ ticketId, assigneeName: duty.name }),
      ]);

      const detail = await manager().ticket.detail({ id: ticketId });
      expect(detail).toMatchObject({
        assigneeId: duty.id,
        status: "assigned",
        dueAt: before.dueAt,
      });
      expect(detail.processLogs.map((log) => log.action)).toEqual([
        "create",
        "assign",
        "status_change",
      ]);
      await expect(
        prisma.appNotification.findFirstOrThrow({ where: { ticketId, targetUserId: duty.id } }),
      ).resolves.toMatchObject({ type: "assigned" });

      const unauthorized = callerWith(seeded.users.observer, "无分配权限", [
        "ticket.view",
        "ticket.view_all",
      ]);
      const another = await createTicket();
      await expect(unauthorized.ticket.autoAssign({ ticketIds: [another] })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });
  });
});
