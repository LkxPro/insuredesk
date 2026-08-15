import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient, Role, User } from "../src/generated/prisma/client.ts";
import { type IntegrationHarness, startIntegrationHarness } from "./integration-harness.ts";

/**
 * External ticket API integration tests: submit with prefill stamping,
 * creatorId-scoped list/detail, full field exposure (no whitelist filtering),
 * ProcessLog filtering, and notification writing.
 */
describe("external ticket API (Testcontainers)", () => {
  let harness: IntegrationHarness;
  let prisma: PrismaClient;
  let seeded: IntegrationHarness["seeded"];
  let channelId: string;
  let externalUser1: User;
  let externalUser2: User;
  let externalRole: Role;

  beforeAll(async () => {
    harness = await startIntegrationHarness({ seed: ["rolesAndUsers", "channels"] });
    prisma = harness.prisma;
    seeded = harness.seeded;
    channelId = harness.channelId("保司");

    externalRole = await prisma.role.create({
      data: {
        name: "外部用户",
        permissions: ["ticket.create_external", "ticket.process_external"],
        system: false,
        requiredTicketFields: [],
      },
    });

    // 账号1: 6 预填全配
    externalUser1 = await prisma.user.create({
      data: {
        username: "external1",
        name: "外部用户1",
        passwordHash: "dummy",
        roleId: externalRole.id,
        active: true,
        prefillChannelId: channelId,
        prefillProject: "融盛",
        prefillBrokerageEntity: "东方大地",
        prefillPaymentChannel: "连连",
        prefillUserComplaintChannel: "400热线",
        prefillComplaintReceiveChannel: "客服群",
      },
    });

    // 账号2: 无预填
    externalUser2 = await prisma.user.create({
      data: {
        username: "external2",
        name: "外部用户2",
        passwordHash: "dummy",
        roleId: externalRole.id,
        active: true,
      },
    });
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  });

  const externalCaller1 = () => harness.callerFor(externalUser1, externalRole);
  const externalCaller2 = () => harness.callerFor(externalUser2, externalRole);

  describe("submit", () => {
    it("creates ticket with source=external_channel and the account's 6 prefill values stamped", async () => {
      const caller = externalCaller1();
      const result = await caller.externalTicket.submit({
        submissionText: "客户反馈无法登录系统，需要重置密码",
      });

      expect(result.id).toBeDefined();
      expect(result.workOrderNumber).toMatch(/^WO\d+$/);

      const ticket = await prisma.ticket.findUnique({ where: { id: result.id } });
      expect(ticket).toMatchObject({
        source: "external_channel",
        submissionText: "客户反馈无法登录系统，需要重置密码",
        creatorId: externalUser1.id,
        channelId,
        project: "融盛",
        brokerageEntity: "东方大地",
        paymentChannel: "连连",
        userComplaintChannel: "400热线",
        complaintReceiveChannel: "客服群",
        status: "unassigned",
      });
      // 外部单的客户反馈随提交发生：反馈时间即创建时间
      expect(ticket?.feedbackTime).toEqual(ticket?.createdAt);
    });

    it("无预填账号提交 → 六字段全 null", async () => {
      const caller = externalCaller2();
      const result = await caller.externalTicket.submit({ submissionText: "裸提交" });

      const ticket = await prisma.ticket.findUnique({ where: { id: result.id } });
      expect(ticket).toMatchObject({
        creatorId: externalUser2.id,
        channelId: null,
        project: null,
        brokerageEntity: null,
        paymentChannel: null,
        userComplaintChannel: null,
        complaintReceiveChannel: null,
      });
    });

    it("预填渠道被停用后提交,停用渠道照常盖章", async () => {
      const disabled = await prisma.channel.create({
        data: { name: "预填后停用渠道", active: true, displayOrder: 800 },
      });
      const account = await prisma.user.create({
        data: {
          username: "ext-disabled-channel",
          name: "停用渠道账号",
          passwordHash: "dummy",
          roleId: externalRole.id,
          active: true,
          prefillChannelId: disabled.id,
        },
      });
      await prisma.channel.update({ where: { id: disabled.id }, data: { active: false } });

      const result = await harness
        .callerFor(account, externalRole)
        .externalTicket.submit({ submissionText: "停用渠道照样进单" });

      const ticket = await prisma.ticket.findUnique({ where: { id: result.id } });
      expect(ticket?.channelId).toBe(disabled.id);
    });

    it("writes action=create ProcessLog", async () => {
      const caller = externalCaller1();
      const result = await caller.externalTicket.submit({
        submissionText: "测试工单",
      });

      const logs = await prisma.processLog.findMany({
        where: { ticketId: result.id, action: "create" },
      });

      expect(logs).toHaveLength(1);
      const createLog = logs[0];
      if (!createLog) throw new Error("create log not found");
      expect(createLog.operatorId).toBe(externalUser1.id);
    });

    it("broadcasts external_submitted notification naming the account", async () => {
      const caller = externalCaller1();
      const result = await caller.externalTicket.submit({
        submissionText: "需要通知的工单",
      });

      const notifications = await prisma.appNotification.findMany({
        where: { ticketId: result.id, type: "external_submitted" },
      });

      expect(notifications.length).toBeGreaterThan(0);
      const firstNotification = notifications[0];
      if (!firstNotification) throw new Error("notification not found");

      expect(firstNotification.title).toBe("外部工单提交");
      expect(firstNotification.content).toContain(externalUser1.name);
      expect(firstNotification.content).toContain(result.workOrderNumber);
    });

    it("rejects if submissionText is missing", async () => {
      const caller = externalCaller1();
      await expect(caller.externalTicket.submit({ submissionText: "" })).rejects.toThrow();
    });

    it("rejects if submissionText exceeds 2000 characters", async () => {
      const caller = externalCaller1();
      const longText = "a".repeat(2001);
      await expect(caller.externalTicket.submit({ submissionText: longText })).rejects.toThrow();
    });

    it("内部账号(含管理员)持有点也不能走外部入口", async () => {
      const asAdmin = harness.callerFor(seeded.users.admin, seeded.roles.admin);
      await expect(
        asAdmin.externalTicket.submit({ submissionText: "管理员试图外部提交" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN", message: "该入口仅限外部账号使用" });
    });
  });

  describe("list", () => {
    it("shows only tickets the account itself submitted", async () => {
      const caller1 = externalCaller1();
      const caller2 = externalCaller2();

      const ticket1 = await caller1.externalTicket.submit({
        submissionText: "账号1的工单",
      });
      const ticket2 = await caller2.externalTicket.submit({
        submissionText: "账号2的工单",
      });

      const list1 = await caller1.externalTicket.list({ offset: 0, limit: 20 });
      const list2 = await caller2.externalTicket.list({ offset: 0, limit: 20 });

      expect(list1.items.some((t) => t.id === ticket1.id)).toBe(true);
      expect(list1.items.some((t) => t.id === ticket2.id)).toBe(false);

      expect(list2.items.some((t) => t.id === ticket2.id)).toBe(true);
      expect(list2.items.some((t) => t.id === ticket1.id)).toBe(false);
    });

    it("exposes all ticket fields including sensitive ones", async () => {
      const caller = externalCaller1();
      const result = await caller.externalTicket.submit({
        submissionText: "测试全量字段可见性",
      });

      await prisma.ticket.update({
        where: { id: result.id },
        data: {
          customerName: "张三",
          phone: "13800138000",
          contactPhone: "13900139000",
          internalOrderNumber: "ORD123456",
          policyNumbers: ["POL001", "POL002"],
          contactId: "CONTACT789",
        },
      });

      const list = await caller.externalTicket.list({ offset: 0, limit: 20 });
      const ticket = list.items.find((t) => t.id === result.id);

      expect(ticket).toBeDefined();
      if (!ticket) throw new Error("ticket not found");

      expect(ticket.workOrderNumber).toBe(result.workOrderNumber);
      expect(ticket).not.toHaveProperty("processingResult");
      expect(ticket.customerName).toBe("张三");
      expect(ticket.phone).toBe("13800138000");
      expect(ticket.contactPhone).toBe("13900139000");
      expect(ticket.internalOrderNumber).toBe("ORD123456");
      expect(ticket.policyNumbers).toEqual(["POL001", "POL002"]);
      expect(ticket.contactId).toBe("CONTACT789");
    });

    it("all accounts see full fields regardless of legacy whitelist config", async () => {
      const caller = externalCaller2();
      const result = await caller.externalTicket.submit({
        submissionText: "测试全量字段",
      });

      await prisma.ticket.update({
        where: { id: result.id },
        data: {
          customerName: "李四",
          phone: "13700137000",
        },
      });

      const list = await caller.externalTicket.list({ offset: 0, limit: 20 });
      const ticket = list.items.find((t) => t.id === result.id);

      expect(ticket).toBeDefined();
      if (!ticket) throw new Error("ticket not found");

      expect(ticket.customerName).toBe("李四");
      expect(ticket.phone).toBe("13700137000");

      const detail = await caller.externalTicket.detail({ ticketId: result.id });
      expect(detail.ticket.customerName).toBe("李四");
      expect(detail.ticket.phone).toBe("13700137000");
      expect(detail).not.toHaveProperty("visibleFields");
    });

    it("工单号与状态始终可见", async () => {
      const account = await prisma.user.create({
        data: {
          username: "ext-legacy-config",
          name: "旧配置用户",
          passwordHash: "x",
          roleId: externalRole.id,
          active: true,
        },
      });
      const caller = harness.callerFor(account, externalRole);

      const created = await caller.externalTicket.submit({ submissionText: "旧配置工单" });
      const list = await caller.externalTicket.list({ offset: 0, limit: 20 });

      const ticket = list.items.find((t) => t.id === created.id);
      expect(ticket?.workOrderNumber).toBe(created.workOrderNumber);
      expect(ticket?.status).toBe("unassigned");

      const detail = await caller.externalTicket.detail({ ticketId: created.id });
      expect(detail.ticket.workOrderNumber).toBe(created.workOrderNumber);
      expect(detail.ticket.status).toBe("unassigned");
      expect(detail).not.toHaveProperty("visibleFields");
    });

    it("excludes soft-deleted tickets", async () => {
      const caller = externalCaller1();
      const result = await caller.externalTicket.submit({
        submissionText: "将被删除的工单",
      });

      await prisma.ticket.update({
        where: { id: result.id },
        data: { deletedAt: new Date() },
      });

      const list = await caller.externalTicket.list({ offset: 0, limit: 20 });
      expect(list.items.some((t) => t.id === result.id)).toBe(false);
    });

    it("已完结单默认在列；显式 status 筛选可只看已完结", async () => {
      const caller = externalCaller1();
      const done = await caller.externalTicket.submit({ submissionText: "已完结的单" });
      await prisma.ticket.update({ where: { id: done.id }, data: { status: "completed" } });

      const defaultList = await caller.externalTicket.list({ offset: 0, limit: 100 });
      expect(defaultList.items.some((t) => t.id === done.id)).toBe(true);

      const onlyCompleted = await caller.externalTicket.list({
        offset: 0,
        limit: 100,
        status: ["completed"],
      });
      expect(onlyCompleted.items.some((t) => t.id === done.id)).toBe(true);
      expect(onlyCompleted.items.every((t) => t.status === "completed")).toBe(true);
    });

    it("按创建日期范围筛选，起止边界均在列", async () => {
      const caller = externalCaller1();
      const before = await caller.externalTicket.submit({ submissionText: "区间前的单" });
      const from = await caller.externalTicket.submit({ submissionText: "起边界的单" });
      const to = await caller.externalTicket.submit({ submissionText: "止边界的单" });
      const after = await caller.externalTicket.submit({ submissionText: "区间后的单" });

      const fromAt = new Date("2026-07-06T00:00:00.000Z");
      const toAt = new Date("2026-07-12T23:59:59.999Z");
      await prisma.ticket.update({
        where: { id: before.id },
        data: { createdAt: new Date(fromAt.getTime() - 1) },
      });
      await prisma.ticket.update({ where: { id: from.id }, data: { createdAt: fromAt } });
      await prisma.ticket.update({ where: { id: to.id }, data: { createdAt: toAt } });
      await prisma.ticket.update({
        where: { id: after.id },
        data: { createdAt: new Date(toAt.getTime() + 1) },
      });

      const list = await caller.externalTicket.list({
        offset: 0,
        limit: 100,
        createdFrom: fromAt.toISOString(),
        createdTo: toAt.toISOString(),
      });
      const ids = list.items.map((t) => t.id);
      expect(ids).toContain(from.id);
      expect(ids).toContain(to.id);
      expect(ids).not.toContain(before.id);
      expect(ids).not.toContain(after.id);
    });

    it("搜索命中保单号", async () => {
      const caller = externalCaller1();
      const hit = await caller.externalTicket.submit({ submissionText: "带保单号的单" });
      await prisma.ticket.update({
        where: { id: hit.id },
        data: { policyNumbers: ["PX-2026-0001", "PX-2026-0002"] },
      });
      const miss = await caller.externalTicket.submit({ submissionText: "不带保单号的单" });

      const list = await caller.externalTicket.list({
        offset: 0,
        limit: 100,
        search: "PX-2026-0002",
      });
      const ids = list.items.map((t) => t.id);
      expect(ids).toContain(hit.id);
      expect(ids).not.toContain(miss.id);
    });

    it("随列表返回最新可见跟进；internalOnly 再新也不可见", async () => {
      const account = await prisma.user.create({
        data: {
          username: "ext-latestlog",
          name: "最新跟进账号",
          passwordHash: "x",
          roleId: externalRole.id,
          active: true,
        },
      });
      const caller = harness.callerFor(account, externalRole);
      const ticket = await caller.externalTicket.submit({ submissionText: "带跟进的单" });

      await prisma.processLog.create({
        data: {
          ticketId: ticket.id,
          action: "comment",
          internalOnly: false,
          remark: "可见跟进",
          operatorId: seeded.users.manager.id,
          operatorName: seeded.users.manager.name,
          at: new Date(Date.now() + 60_000),
        },
      });
      // 更新的内部跟进对外部不可见，不能成为 latestLog
      await prisma.processLog.create({
        data: {
          ticketId: ticket.id,
          action: "comment",
          internalOnly: true,
          remark: "内部敏感",
          operatorId: seeded.users.manager.id,
          operatorName: seeded.users.manager.name,
          at: new Date(Date.now() + 120_000),
        },
      });

      const list = await caller.externalTicket.list({ offset: 0, limit: 20 });
      const item = list.items.find((t) => t.id === ticket.id);
      expect(item?.latestLog).toMatchObject({ action: "comment", remark: "可见跟进" });
    });

    it("客服新发言的工单置顶，其余按最新活跃倒序", async () => {
      const account = await prisma.user.create({
        data: {
          username: "ext-inbox-order",
          name: "排序账号",
          passwordHash: "x",
          roleId: externalRole.id,
          active: true,
        },
      });
      const caller = harness.callerFor(account, externalRole);

      // 提交顺序与最终序相反：旧 createdAt DESC 会给出 idle/noted/replied
      const replied = await caller.externalTicket.submit({ submissionText: "客服回复了" });
      const noted = await caller.externalTicket.submit({ submissionText: "我留言过" });
      const idle = await caller.externalTicket.submit({ submissionText: "无动静" });

      // noted 活跃更新，但 replied 是客服新发言 → replied 置顶，noted 次之
      await prisma.processLog.create({
        data: {
          ticketId: replied.id,
          action: "comment",
          internalOnly: false,
          remark: "请补充材料",
          operatorId: seeded.users.manager.id,
          operatorName: seeded.users.manager.name,
          at: new Date(Date.now() + 60_000),
        },
      });
      await prisma.processLog.create({
        data: {
          ticketId: noted.id,
          action: "external_note",
          remark: "补充一句",
          operatorId: account.id,
          operatorName: account.name,
          at: new Date(Date.now() + 120_000),
        },
      });

      const list = await caller.externalTicket.list({ offset: 0, limit: 20 });
      const ids = list.items.map((t) => t.id);
      expect(ids[0]).toBe(replied.id);
      expect(ids[1]).toBe(noted.id);
      expect(ids[2]).toBe(idle.id);
    });
  });

  describe("detail", () => {
    it("returns 404 for another account's ticket", async () => {
      const caller1 = externalCaller1();
      const caller2 = externalCaller2();

      const ticket1 = await caller1.externalTicket.submit({
        submissionText: "账号1的工单",
      });

      await expect(caller2.externalTicket.detail({ ticketId: ticket1.id })).rejects.toThrow(
        TRPCError,
      );
    });

    it("filters ProcessLog to show only allowed actions", async () => {
      const caller = externalCaller1();

      const ticket = await caller.externalTicket.submit({
        submissionText: "测试 ProcessLog 过滤",
      });

      await prisma.processLog.createMany({
        data: [
          {
            ticketId: ticket.id,
            action: "comment",
            internalOnly: false,
            remark: "可见跟进",
            operatorId: seeded.users.manager.id,
            operatorName: seeded.users.manager.name,
            at: new Date(),
          },
          {
            ticketId: ticket.id,
            action: "comment",
            internalOnly: true,
            remark: "内部跟进",
            operatorId: seeded.users.manager.id,
            operatorName: seeded.users.manager.name,
            at: new Date(),
          },
          {
            ticketId: ticket.id,
            action: "assign",
            operatorId: seeded.users.manager.id,
            operatorName: seeded.users.manager.name,
            remark: "",
            at: new Date(),
          },
          {
            ticketId: ticket.id,
            action: "external_note",
            remark: "外部留言",
            operatorId: externalUser1.id,
            operatorName: externalUser1.name,
            at: new Date(),
          },
        ],
      });

      const detail = await caller.externalTicket.detail({ ticketId: ticket.id });

      const actions = detail.processLogs.map((log) => log.action);
      expect(actions).toContain("create");
      expect(actions).toContain("comment");
      expect(actions).toContain("external_note");
      expect(actions).not.toContain("assign");

      const remarks = detail.processLogs.map((log) => log.remark).filter(Boolean);
      expect(remarks).toContain("可见跟进");
      expect(remarks).toContain("外部留言");
      expect(remarks).not.toContain("内部跟进");
    });

    it("内部员工加的 internalOnly 跟进不出现在外部任何响应中", async () => {
      const caller = externalCaller1();
      const ticket = await caller.externalTicket.submit({
        submissionText: "内部跟进可见性",
      });

      const manager = harness.callerFor(seeded.users.manager, seeded.roles.csManager);
      await manager.ticket.assign({ ticketId: ticket.id, assigneeId: seeded.users.cs1.id });
      const frontline = harness.callerFor(seeded.users.cs1, seeded.roles.frontline);
      await frontline.ticket.addComment({
        ticketId: ticket.id,
        remark: "对外可见的跟进",
      });
      await frontline.ticket.addComment({
        ticketId: ticket.id,
        remark: "内部口径，勿外传",
        internalOnly: true,
      });

      const detail = await caller.externalTicket.detail({ ticketId: ticket.id });
      expect(detail.ticket).not.toHaveProperty("processingResult");
      expect(JSON.stringify(detail)).not.toContain("内部口径，勿外传");
      expect(detail.processLogs.map((log) => log.remark)).toContain("对外可见的跟进");

      // 列表每单附最新一条可见跟进：最新跟进是 internalOnly 时也要回退到可见的那条
      const list = await caller.externalTicket.list({ offset: 0, limit: 20 });
      const item = list.items.find((t) => t.id === ticket.id);
      expect(item?.latestLog?.remark).toBe("对外可见的跟进");
      expect(JSON.stringify(item)).not.toContain("内部口径，勿外传");
    });

    it("detail exposes all fields including sensitive ones", async () => {
      const caller = externalCaller1();
      const ticket = await caller.externalTicket.submit({
        submissionText: "测试详情全量字段",
      });

      await prisma.ticket.update({
        where: { id: ticket.id },
        data: {
          customerName: "王五",
          phone: "13600136000",
          contactPhone: "13500135000",
          internalOrderNumber: "ORD999",
          policyNumbers: ["POL100", "POL200", "POL300"],
          contactId: "CONTACT456",
        },
      });

      const detail = await caller.externalTicket.detail({ ticketId: ticket.id });

      expect(detail.ticket.workOrderNumber).toBe(ticket.workOrderNumber);
      expect(detail.ticket.customerName).toBe("王五");
      expect(detail.ticket.phone).toBe("13600136000");
      expect(detail.ticket.contactPhone).toBe("13500135000");
      expect(detail.ticket.internalOrderNumber).toBe("ORD999");
      expect(detail.ticket.policyNumbers).toEqual(["POL100", "POL200", "POL300"]);
      expect(detail.ticket.contactId).toBe("CONTACT456");
      expect(detail.ticket).not.toHaveProperty("processingResult");
      expect(detail).not.toHaveProperty("visibleFields");
    });

    it("returns 404 for soft-deleted ticket", async () => {
      const caller = externalCaller1();
      const ticket = await caller.externalTicket.submit({
        submissionText: "将被删除的工单",
      });

      await prisma.ticket.update({
        where: { id: ticket.id },
        data: { deletedAt: new Date() },
      });

      await expect(caller.externalTicket.detail({ ticketId: ticket.id })).rejects.toThrow(
        TRPCError,
      );
    });
  });

  describe("addNote", () => {
    it("adds external_note ProcessLog without modifying ticket fields", async () => {
      const caller = externalCaller1();
      const ticket = await caller.externalTicket.submit({
        submissionText: "测试外部留言",
      });

      const beforeTicket = await prisma.ticket.findUnique({
        where: { id: ticket.id },
        select: { contactCount: true, nextContactTime: true },
      });

      const result = await caller.externalTicket.addNote({
        ticketId: ticket.id,
        content: "请问处理进度如何？",
      });

      expect(result.success).toBe(true);

      const logs = await prisma.processLog.findMany({
        where: { ticketId: ticket.id, action: "external_note" },
      });

      expect(logs).toHaveLength(1);
      const noteLog = logs[0];
      if (!noteLog) throw new Error("external_note log not found");
      expect(noteLog.remark).toBe("请问处理进度如何？");
      expect(noteLog.operatorId).toBe(externalUser1.id);

      const afterTicket = await prisma.ticket.findUnique({
        where: { id: ticket.id },
        select: { contactCount: true, nextContactTime: true },
      });

      expect(afterTicket?.contactCount).toBe(beforeTicket?.contactCount);
      expect(afterTicket?.nextContactTime).toEqual(beforeTicket?.nextContactTime);
    });

    it("notifies assignee when ticket is assigned", async () => {
      const caller = externalCaller1();
      const ticket = await caller.externalTicket.submit({
        submissionText: "测试通知已分配工单",
      });

      await prisma.ticket.update({
        where: { id: ticket.id },
        data: { assigneeId: seeded.users.cs1.id, status: "assigned" },
      });

      await caller.externalTicket.addNote({
        ticketId: ticket.id,
        content: "需要补充信息",
      });

      const notifications = await prisma.appNotification.findMany({
        where: {
          ticketId: ticket.id,
          type: "external_note",
          targetUserId: seeded.users.cs1.id,
        },
      });

      expect(notifications).toHaveLength(1);
      const notification = notifications[0];
      if (!notification) throw new Error("notification not found");
      expect(notification.title).toBe("外部留言");
      expect(notification.content).toContain(externalUser1.name);
      expect(notification.content).toContain(ticket.workOrderNumber);
    });

    it("broadcasts to ticket.assign holders when ticket is unassigned", async () => {
      const caller = externalCaller1();
      const ticket = await caller.externalTicket.submit({
        submissionText: "测试通知未分配工单",
      });

      await caller.externalTicket.addNote({
        ticketId: ticket.id,
        content: "尽快处理",
      });

      const notifications = await prisma.appNotification.findMany({
        where: { ticketId: ticket.id, type: "external_note" },
      });

      expect(notifications.length).toBeGreaterThan(0);
      const firstNotification = notifications[0];
      if (!firstNotification) throw new Error("notification not found");
      expect(firstNotification.title).toBe("外部留言");
    });

    it("rejects addNote for completed ticket", async () => {
      const caller = externalCaller1();
      const ticket = await caller.externalTicket.submit({
        submissionText: "将被完结的工单",
      });

      await prisma.ticket.update({
        where: { id: ticket.id },
        data: { status: "completed" },
      });

      await expect(
        caller.externalTicket.addNote({
          ticketId: ticket.id,
          content: "尝试留言",
        }),
      ).rejects.toThrow("工单已完结");
    });

    it("returns 404 for another account's ticket", async () => {
      const caller1 = externalCaller1();
      const caller2 = externalCaller2();

      const ticket1 = await caller1.externalTicket.submit({
        submissionText: "账号1的工单",
      });

      await expect(
        caller2.externalTicket.addNote({
          ticketId: ticket1.id,
          content: "尝试留言",
        }),
      ).rejects.toThrow(TRPCError);
    });

    it("rejects if content is empty", async () => {
      const caller = externalCaller1();
      const ticket = await caller.externalTicket.submit({
        submissionText: "测试空留言",
      });

      await expect(
        caller.externalTicket.addNote({
          ticketId: ticket.id,
          content: "",
        }),
      ).rejects.toThrow();
    });

    it("rejects if content exceeds 2000 characters", async () => {
      const caller = externalCaller1();
      const ticket = await caller.externalTicket.submit({
        submissionText: "测试长留言",
      });

      const longContent = "a".repeat(2001);
      await expect(
        caller.externalTicket.addNote({
          ticketId: ticket.id,
          content: longContent,
        }),
      ).rejects.toThrow();
    });
  });

  describe("外部创建者通知", () => {
    it("内部非 internal comment → 创建者收到 external_reply 通知", async () => {
      const externalCaller = externalCaller1();
      const internalCaller = harness.callerFor(seeded.users.manager, seeded.roles.csManager);

      const ticket = await externalCaller.externalTicket.submit({
        submissionText: "等回复的单",
      });
      await prisma.ticket.update({
        where: { id: ticket.id },
        data: { assigneeId: seeded.users.cs1.id, status: "assigned" },
      });

      await internalCaller.ticket.addComment({
        ticketId: ticket.id,
        remark: "请补充保单号",
        internalOnly: false,
      });

      const notifications = await prisma.appNotification.findMany({
        where: { ticketId: ticket.id, type: "external_reply", targetUserId: externalUser1.id },
      });
      expect(notifications).toHaveLength(1);
      const notification = notifications[0];
      if (!notification) throw new Error("notification not found");
      expect(notification.title).toBe("客服跟进");
      expect(notification.content).toContain(ticket.workOrderNumber);
    });

    it("internalOnly comment 不通知外部创建者", async () => {
      const externalCaller = externalCaller1();
      const internalCaller = harness.callerFor(seeded.users.manager, seeded.roles.csManager);

      const ticket = await externalCaller.externalTicket.submit({
        submissionText: "内部讨论的单",
      });
      await prisma.ticket.update({
        where: { id: ticket.id },
        data: { assigneeId: seeded.users.cs1.id, status: "assigned" },
      });

      await internalCaller.ticket.addComment({
        ticketId: ticket.id,
        remark: "内部敏感判断",
        internalOnly: true,
      });

      const notifications = await prisma.appNotification.findMany({
        where: { ticketId: ticket.id, type: "external_reply" },
      });
      expect(notifications).toHaveLength(0);
    });

    it("完结外部工单 → 创建者收到 external_resolved 通知", async () => {
      const externalCaller = externalCaller1();
      const internalCaller = harness.callerFor(seeded.users.manager, seeded.roles.csManager);

      const completionStatus = await prisma.completionStatus.findFirst({
        where: { active: true },
      });
      if (!completionStatus) throw new Error("no active completion status seeded");

      const ticket = await externalCaller.externalTicket.submit({
        submissionText: "将被完结的外部单",
      });
      await prisma.ticket.update({
        where: { id: ticket.id },
        data: { assigneeId: seeded.users.cs1.id, status: "assigned" },
      });

      await internalCaller.ticket.resolve({
        ticketId: ticket.id,
        completionStatusId: completionStatus.id,
        remark: "已赔付完结",
      });

      const notifications = await prisma.appNotification.findMany({
        where: { ticketId: ticket.id, type: "external_resolved", targetUserId: externalUser1.id },
      });
      expect(notifications).toHaveLength(1);
      const notification = notifications[0];
      if (!notification) throw new Error("notification not found");
      expect(notification.title).toBe("工单完结");
      expect(notification.content).toContain(ticket.workOrderNumber);
    });

    it("内部自建工单被跟进不触发 external_reply", async () => {
      const internalCaller = harness.callerFor(seeded.users.manager, seeded.roles.csManager);

      const manualTicket = await internalCaller.ticket.create({
        feedbackTime: new Date().toISOString(),
        channelId: null,
        project: null,
        brokerageEntity: null,
        paymentChannel: null,
        internalOrderNumber: null,
        policyNumbers: [],
        userComplaintChannel: null,
        complaintReceiveChannel: null,
        customerName: null,
        phone: null,
        contactPhone: null,
        customerRequest: "内部自建单",
        nuclearBodyStatus: null,
        hasContacted: null,
        contactTime: null,
        contactId: null,
        categoryId: null,
        complaintLevel: null,
        priority: null,
      });
      await prisma.ticket.update({
        where: { id: manualTicket.id },
        data: { assigneeId: seeded.users.cs1.id, status: "assigned" },
      });

      await internalCaller.ticket.addComment({
        ticketId: manualTicket.id,
        remark: "内部单跟进",
        internalOnly: false,
      });

      const notifications = await prisma.appNotification.findMany({
        where: { ticketId: manualTicket.id, type: "external_reply" },
      });
      expect(notifications).toHaveLength(0);
    });
  });

  describe("internalOnly flag", () => {
    it("internal comment with internalOnly=true is filtered in external detail", async () => {
      const internalCaller = harness.callerFor(seeded.users.manager, seeded.roles.csManager);
      const externalCaller = externalCaller1();

      const ticket = await externalCaller.externalTicket.submit({
        submissionText: "测试 internalOnly 过滤",
      });

      await prisma.ticket.update({
        where: { id: ticket.id },
        data: { assigneeId: seeded.users.cs1.id, status: "assigned" },
      });

      await internalCaller.ticket.addComment({
        ticketId: ticket.id,
        remark: "内部敏感判断",
        internalOnly: true,
      });

      await internalCaller.ticket.addComment({
        ticketId: ticket.id,
        remark: "外部可见跟进",
        internalOnly: false,
      });

      const detail = await externalCaller.externalTicket.detail({ ticketId: ticket.id });

      const remarks = detail.processLogs.map((log) => log.remark).filter(Boolean);
      expect(remarks).toContain("外部可见跟进");
      expect(remarks).not.toContain("内部敏感判断");
    });

    it("internal comment with internalOnly=true is visible to internal users", async () => {
      const internalCaller = harness.callerFor(seeded.users.manager, seeded.roles.csManager);

      const manualTicket = await internalCaller.ticket.create({
        feedbackTime: new Date().toISOString(),
        channelId: null,
        project: null,
        brokerageEntity: null,
        paymentChannel: null,
        internalOrderNumber: null,
        policyNumbers: [],
        userComplaintChannel: null,
        complaintReceiveChannel: null,
        customerName: null,
        phone: null,
        contactPhone: null,
        customerRequest: "测试内部可见",
        nuclearBodyStatus: null,
        hasContacted: null,
        contactTime: null,
        contactId: null,
        categoryId: null,
        complaintLevel: null,
        priority: null,
      });

      await prisma.ticket.update({
        where: { id: manualTicket.id },
        data: { assigneeId: seeded.users.cs1.id, status: "assigned" },
      });

      await internalCaller.ticket.addComment({
        ticketId: manualTicket.id,
        remark: "内部敏感判断",
        internalOnly: true,
      });

      const internalAgentCaller = harness.callerFor(seeded.users.cs1, seeded.roles.frontline);
      const detail = await internalAgentCaller.ticket.detail({ id: manualTicket.id });

      const remarks = detail.processLogs
        .map((log: { remark: string }) => log.remark)
        .filter(Boolean);
      expect(remarks).toContain("内部敏感判断");
    });
  });
});
