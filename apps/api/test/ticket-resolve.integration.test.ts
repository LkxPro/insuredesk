import type { Permission, TicketCreateInput } from "@insuredesk/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient, Role, User } from "../src/generated/prisma/client.ts";
import { appRouter } from "../src/routers/index.ts";
import { type IntegrationHarness, startIntegrationHarness } from "./integration-harness.ts";

describe("ticket resolve 完结 (Testcontainers)", () => {
  let harness: IntegrationHarness;
  let prisma: PrismaClient;
  let seeded: IntegrationHarness["seeded"];
  let cs2: User;

  beforeAll(async () => {
    harness = await startIntegrationHarness({ seed: ["rolesAndUsers", "slaPolicies"] });
    prisma = harness.prisma;
    seeded = harness.seeded;

    baseInput = {
      feedbackTime: "2026-07-09T02:00:00.000Z",
      project: "融盛",
      brokerageEntity: "东方大地",
      paymentChannel: "连连支付",
      policyNumbers: ["P2026071000728"],
      userFeedbackChannelId: null,
      customerName: "孙完结",
      phone: "13800000003",
      customerRequest: "对理赔金额有异议，要求复核",
      nuclearBodyStatus: "待核实",
      hasContacted: false,
      slaPolicyId: harness.slaPolicyId("一般投诉"),
      allowDuplicate: true,
    };

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
    await harness?.stop();
  });

  function callerWith(user: User, roleName: string, permissions: Permission[]) {
    return appRouter.createCaller({
      traceId: "resolve-test",
      user: {
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
      },
      sessionToken: null,
    });
  }

  function callerFor(user: User, role: Role) {
    return callerWith(user, role.name, role.permissions as Permission[]);
  }

  async function statusId(name: string) {
    const row = await prisma.completionStatus.findUniqueOrThrow({ where: { name } });
    return row.id;
  }

  const manager = () => callerFor(seeded.users.manager, seeded.roles.csManager);
  const frontline = () => callerFor(seeded.users.cs1, seeded.roles.frontline);
  const observer = () => callerFor(seeded.users.observer, seeded.roles.readOnly);

  let baseInput: TicketCreateInput & { allowDuplicate?: boolean };

  async function createTicket() {
    const created = await manager().ticket.create(baseInput);
    return created.id;
  }

  async function createAssignedTicket(assigneeId?: string) {
    const ticketId = await createTicket();
    await manager().ticket.assign({
      ticketId,
      assigneeId: assigneeId ?? seeded.users.cs1.id,
    });
    return ticketId;
  }

  async function createProcessingTicket() {
    const ticketId = await createAssignedTicket();
    await frontline().ticket.addComment({ ticketId, remark: "已电话联系客户，复核中" });
    return ticketId;
  }

  describe("完结流转 (assigned/processing → completed)", () => {
    it("resolves a processing ticket: → completed, stamps completionTime/completionStatus, writes resolve + status_change logs in order", async () => {
      const ticketId = await createProcessingTicket();

      const result = await frontline().ticket.resolve({
        ticketId,
        completionStatusId: await statusId("已协商解决"),
        remark: "复核完成，客户认可金额，双方达成一致",
      });
      expect(result).toMatchObject({
        id: ticketId,
        workOrderNumber: expect.stringMatching(/^WO\d+$/),
        status: "completed",
        completionStatus: "已协商解决",
      });

      const detail = await manager().ticket.detail({ id: ticketId });
      expect(detail.status).toBe("completed");
      expect(detail.displayStatus).toBe("completed");
      expect(detail.completionStatus).toBe("已协商解决");

      expect(detail.processLogs.map((log) => log.action)).toEqual([
        "create",
        "assign",
        "status_change",
        "comment",
        "status_change",
        "resolve",
        "status_change",
      ]);

      const [resolveLog, transitionLog] = detail.processLogs.slice(-2);
      expect(resolveLog).toMatchObject({
        operatorId: seeded.users.cs1.id,
        operatorName: seeded.users.cs1.name,
        from: null,
        to: null,
        remark: "复核完成，客户认可金额，双方达成一致",
      });
      expect(transitionLog).toMatchObject({
        operatorId: seeded.users.cs1.id,
        from: "processing",
        to: "completed",
      });
      expect(transitionLog?.at).toBe(resolveLog?.at);
      expect(detail.completionTime).toBe(resolveLog?.at);
    });

    it("resolves an assigned ticket directly (无跟进也可完结) and never touches dueAt/assignedAt/contactCount", async () => {
      const ticketId = await createAssignedTicket();
      const before = await manager().ticket.detail({ id: ticketId });

      const result = await frontline().ticket.resolve({
        ticketId,
        completionStatusId: await statusId("无效工单"),
        remark: "重复录入，按无效工单完结",
      });
      expect(result).toMatchObject({ status: "completed", completionStatus: "无效工单" });

      const detail = await manager().ticket.detail({ id: ticketId });
      expect(detail.status).toBe("completed");
      expect(detail.processLogs.map((log) => log.action)).toEqual([
        "create",
        "assign",
        "status_change",
        "resolve",
        "status_change",
      ]);
      expect(detail.processLogs.at(-1)).toMatchObject({ from: "assigned", to: "completed" });

      expect(detail.dueAt).toBe(before.dueAt);
      expect(detail.assignedAt).toBe(before.assignedAt);
      expect(detail.contactCount).toBe(0);
    });
  });

  describe("guards and 终态保护", () => {
    it("rejects resolving an unassigned ticket, leaving no trace", async () => {
      const ticketId = await createTicket();

      await expect(
        manager().ticket.resolve({
          ticketId,
          completionStatusId: await statusId("正常完结"),
          remark: "还没分配就想完结",
        }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

      const detail = await manager().ticket.detail({ id: ticketId });
      expect(detail.status).toBe("unassigned");
      expect(detail.completionTime).toBeNull();
      expect(detail.completionStatus).toBeNull();
      expect(detail.processLogs.map((log) => log.action)).toEqual(["create"]);
    });

    it("completed is a 终态: no second resolve, no further follow-ups, no reassignment", async () => {
      const ticketId = await createProcessingTicket();
      await frontline().ticket.resolve({
        ticketId,
        completionStatusId: await statusId("已达成一致"),
        remark: "客户认可处理方案",
      });

      await expect(
        frontline().ticket.resolve({
          ticketId,
          completionStatusId: await statusId("正常完结"),
          remark: "重复完结",
        }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

      await expect(
        frontline().ticket.addComment({ ticketId, remark: "已完结还想跟进" }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

      await expect(manager().ticket.assign({ ticketId, assigneeId: cs2.id })).rejects.toMatchObject(
        { code: "PRECONDITION_FAILED" },
      );

      const detail = await manager().ticket.detail({ id: ticketId });
      expect(detail.status).toBe("completed");
      expect(detail.completionStatus).toBe("已达成一致");
      expect(detail.processLogs.map((log) => log.action).slice(-2)).toEqual([
        "resolve",
        "status_change",
      ]);
    });

    it("rejects unknown and soft-deleted tickets as NOT_FOUND", async () => {
      await expect(
        manager().ticket.resolve({
          ticketId: "no-such-ticket",
          completionStatusId: await statusId("正常完结"),
          remark: "无中生有",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });

      const ticketId = await createAssignedTicket();
      await prisma.ticket.update({ where: { id: ticketId }, data: { deletedAt: new Date() } });
      await expect(
        manager().ticket.resolve({
          ticketId,
          completionStatusId: await statusId("正常完结"),
          remark: "已删除还想完结",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("rejects a reference to a nonexistent 完结状态目录项", async () => {
      const ticketId = await createAssignedTicket();

      await expect(
        manager().ticket.resolve({
          ticketId,
          completionStatusId: "no-such-status",
          remark: "目录之外",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "所选完结状态不存在" });
    });

    it("rejects a blank 完结备注", async () => {
      const ticketId = await createAssignedTicket();

      await expect(
        manager().ticket.resolve({
          ticketId,
          completionStatusId: await statusId("正常完结"),
          remark: "   ",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  describe("RBAC and data scope", () => {
    it("applies the data scope: a frontline CS cannot resolve someone else's ticket", async () => {
      const ticketId = await createAssignedTicket(cs2.id);

      await expect(
        frontline().ticket.resolve({
          ticketId,
          completionStatusId: await statusId("正常完结"),
          remark: "不是我的工单",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("lets the creator resolve their own ticket after it was assigned to someone else", async () => {
      const creator = () =>
        callerWith(seeded.users.cs1, "受限创建人", [
          "ticket.view",
          "ticket.create",
          "ticket.process",
        ]);
      const created = await creator().ticket.create(baseInput);
      await manager().ticket.assign({ ticketId: created.id, assigneeId: cs2.id });

      const result = await creator().ticket.resolve({
        ticketId: created.id,
        completionStatusId: await statusId("正常完结"),
        remark: "客户来电确认已解决，创建人代结",
      });
      expect(result).toMatchObject({ status: "completed", completionStatus: "正常完结" });
    });

    it("lets ticket.process + ticket.view_all resolve others' tickets (主管顶班)", async () => {
      const ticketId = await createAssignedTicket(seeded.users.cs1.id);

      const result = await manager().ticket.resolve({
        ticketId,
        completionStatusId: await statusId("转其他部门处理"),
        remark: "属理赔核算范围，移交理赔部",
      });
      expect(result).toMatchObject({ status: "completed", completionStatus: "转其他部门处理" });

      const detail = await manager().ticket.detail({ id: ticketId });
      expect(detail.processLogs.at(-2)).toMatchObject({
        action: "resolve",
        operatorId: seeded.users.manager.id,
        operatorName: seeded.users.manager.name,
      });
    });

    it("rejects callers without ticket.process (只读观察)", async () => {
      const ticketId = await createAssignedTicket();

      await expect(
        observer().ticket.resolve({
          ticketId,
          completionStatusId: await statusId("正常完结"),
          remark: "只读也想完结",
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("完结后移出超时/预警口径 (实时运营视角)", () => {
    async function listUnder(status: "pending_timeout" | "overdue" | "completed", search: string) {
      const { items } = await manager().ticket.list({ status, search });
      return items;
    }

    it("an overdue ticket leaves the overdue 口径 the moment it resolves", async () => {
      const ticketId = await createAssignedTicket();
      const { workOrderNumber } = await manager().ticket.detail({ id: ticketId });
      await prisma.ticket.update({
        where: { id: ticketId },
        data: { dueAt: new Date(Date.now() - 60 * 60 * 1000) },
      });

      const before = await listUnder("overdue", workOrderNumber);
      expect(before.map((item) => item.id)).toEqual([ticketId]);
      expect(before[0]?.displayStatus).toBe("overdue");

      await frontline().ticket.resolve({
        ticketId,
        completionStatusId: await statusId("冷处理"),
        remark: "多次沟通无进展，转冷处理",
      });

      expect(await listUnder("overdue", workOrderNumber)).toEqual([]);
      const after = await listUnder("completed", workOrderNumber);
      expect(after.map((item) => item.displayStatus)).toEqual(["completed"]);
    });

    it("a pending_timeout ticket leaves the 预警口径 the moment it resolves", async () => {
      const ticketId = await createAssignedTicket();
      const { workOrderNumber } = await manager().ticket.detail({ id: ticketId });
      await prisma.ticket.update({
        where: { id: ticketId },
        data: { dueAt: new Date(Date.now() + 60 * 60 * 1000) },
      });

      const before = await listUnder("pending_timeout", workOrderNumber);
      expect(before.map((item) => item.id)).toEqual([ticketId]);

      await frontline().ticket.resolve({
        ticketId,
        completionStatusId: await statusId("联系不上"),
        remark: "多渠道均联系不上客户，先行完结",
      });

      expect(await listUnder("pending_timeout", workOrderNumber)).toEqual([]);
      expect(await listUnder("completed", workOrderNumber)).toHaveLength(1);
    });
  });
});
