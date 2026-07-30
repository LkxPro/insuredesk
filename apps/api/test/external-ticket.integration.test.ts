import { DEFAULT_EXTERNAL_VISIBLE_FIELDS } from "@insuredesk/shared";
import { TRPCError } from "@trpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient, Role, User } from "../src/generated/prisma/client";
import { type IntegrationHarness, startIntegrationHarness } from "./integration-harness";

/**
 * External ticket API integration tests: submit with prefill stamping,
 * creatorId-scoped list/detail, field visibility filtering, ProcessLog
 * filtering, and notification writing.
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

    // 账号1: 6 预填全配 + 显式白名单
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
        visibleTicketFields: JSON.stringify([
          "workOrderNumber",
          "feedbackTime",
          "status",
          "processingResult",
        ]),
      },
    });

    // 账号2: 无预填,白名单 null(系统默认)
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

    it("filters fields by the account's whitelist", async () => {
      const caller = externalCaller1();
      const result = await caller.externalTicket.submit({
        submissionText: "测试字段可见性",
      });

      await prisma.ticket.update({
        where: { id: result.id },
        data: {
          customerName: "敏感客户名",
          phone: "13800000000",
          processingResult: "处理结果",
        },
      });

      const list = await caller.externalTicket.list({ offset: 0, limit: 20 });
      const ticket = list.items.find((t) => t.id === result.id);

      expect(ticket).toBeDefined();
      if (!ticket) throw new Error("ticket not found");

      expect(ticket.workOrderNumber).toBe(result.workOrderNumber);
      expect(ticket.processingResult).toBe("处理结果");
      // 敏感字段不在外部 wire shape 里，连键都不存在
      expect(ticket).not.toHaveProperty("customerName");
      expect(ticket).not.toHaveProperty("phone");
    });

    it("uses default whitelist when the account has null visibleTicketFields", async () => {
      const caller = externalCaller2();
      const result = await caller.externalTicket.submit({
        submissionText: "测试默认白名单",
      });

      await prisma.ticket.update({
        where: { id: result.id },
        data: {
          customerName: "敏感客户名",
          processingResult: "处理结果",
        },
      });

      const list = await caller.externalTicket.list({ offset: 0, limit: 20 });
      const ticket = list.items.find((t) => t.id === result.id);

      expect(ticket).toBeDefined();
      expect(DEFAULT_EXTERNAL_VISIBLE_FIELDS).toContain("workOrderNumber");
      expect(DEFAULT_EXTERNAL_VISIBLE_FIELDS).toContain("status");
      expect(list.visibleFields).toEqual([...DEFAULT_EXTERNAL_VISIBLE_FIELDS]);
      expect(ticket).not.toHaveProperty("customerName");
    });

    it("keeps 工单号/状态 visible even when the account's whitelist omits them", async () => {
      // 管理员界面的候选清单由建单字段推导，勾不到工单号与状态 —— 任何配过一次
      // 的账号白名单都不含它们，但工单号是外部方唯一的工单标识，必须还在
      const account = await prisma.user.create({
        data: {
          username: "ext-narrow-whitelist",
          name: "窄白名单用户",
          passwordHash: "x",
          roleId: externalRole.id,
          active: true,
          visibleTicketFields: JSON.stringify(["feedbackTime", "priority"]),
        },
      });
      const caller = harness.callerFor(account, externalRole);

      const created = await caller.externalTicket.submit({ submissionText: "窄白名单" });
      const list = await caller.externalTicket.list({ offset: 0, limit: 20 });

      expect(list.visibleFields).toEqual(["workOrderNumber", "status", "feedbackTime", "priority"]);
      const ticket = list.items.find((t) => t.id === created.id);
      expect(ticket?.workOrderNumber).toBe(created.workOrderNumber);
      expect(ticket?.status).toBe("unassigned");
      // 未配的业务字段仍然被裁掉
      expect(ticket?.customerRequest).toBeNull();
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

    it("filters ticket fields by whitelist", async () => {
      const caller = externalCaller1();
      const ticket = await caller.externalTicket.submit({
        submissionText: "测试详情字段过滤",
      });

      await prisma.ticket.update({
        where: { id: ticket.id },
        data: {
          customerName: "敏感客户名",
          phone: "13800000000",
          processingResult: "处理结果",
        },
      });

      const detail = await caller.externalTicket.detail({ ticketId: ticket.id });

      expect(detail.ticket.workOrderNumber).toBe(ticket.workOrderNumber);
      expect(detail.ticket.processingResult).toBe("处理结果");
      expect(detail.ticket).not.toHaveProperty("customerName");
      expect(detail.ticket).not.toHaveProperty("phone");
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
        select: { contactCount: true, processingResult: true, nextContactTime: true },
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
        select: { contactCount: true, processingResult: true, nextContactTime: true },
      });

      expect(afterTicket?.contactCount).toBe(beforeTicket?.contactCount);
      expect(afterTicket?.processingResult).toBe(beforeTicket?.processingResult);
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
