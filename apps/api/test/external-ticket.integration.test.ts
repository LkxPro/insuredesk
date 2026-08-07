import { DEFAULT_EXTERNAL_DETAIL_FIELDS, DEFAULT_EXTERNAL_LIST_FIELDS } from "@insuredesk/shared";
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
        externalListFields: JSON.stringify([
          "workOrderNumber",
          "feedbackTime",
          "status",
          "processingResult",
        ]),
        externalDetailFields: JSON.stringify([
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

  describe("preferences", () => {
    it("reconciles a personal list order with the account's current authorized fields", async () => {
      await prisma.user.update({
        where: { id: externalUser1.id },
        data: {
          externalListOrder: JSON.stringify(["status", "revoked", "feedbackTime"]),
        },
      });

      const preferences = await externalCaller1().externalTicket.preferences();

      expect(preferences.listFields).toEqual([
        "status",
        "feedbackTime",
        "workOrderNumber",
        "processingResult",
      ]);
    });

    it("persists a personal export order and appends newly authorized fields", async () => {
      const caller = externalCaller1();

      await caller.externalTicket.updatePreferences({
        surface: "export",
        fields: ["processingResult", "status"],
      });
      const preferences = await caller.externalTicket.preferences();

      expect(preferences.exportFields).toEqual([
        "processingResult",
        "status",
        "workOrderNumber",
        "feedbackTime",
      ]);
    });

    it("uses the personal list order in list responses and can restore the default", async () => {
      const caller = externalCaller1();

      await caller.externalTicket.updatePreferences({
        surface: "list",
        fields: ["processingResult", "status", "feedbackTime", "workOrderNumber"],
      });
      const reordered = await caller.externalTicket.list({ offset: 0, limit: 1 });
      expect(reordered.visibleFields).toEqual([
        "processingResult",
        "status",
        "feedbackTime",
        "workOrderNumber",
      ]);

      await caller.externalTicket.updatePreferences({ surface: "list", fields: [] });
      const restored = await caller.externalTicket.list({ offset: 0, limit: 1 });
      expect(restored.visibleFields).toEqual([
        "workOrderNumber",
        "feedbackTime",
        "status",
        "processingResult",
      ]);
    });
  });

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

    it("uses separate default fields when the account has null surface configs", async () => {
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
      expect(ticket?.customerName).toBe("敏感客户名");

      // 白名单本身随详情下发（列表已不携带）
      const detail = await caller.externalTicket.detail({ ticketId: result.id });
      expect(DEFAULT_EXTERNAL_LIST_FIELDS).toContain("customerName");
      expect(DEFAULT_EXTERNAL_DETAIL_FIELDS).toContain("workOrderNumber");
      expect(detail.visibleFields).toEqual([...DEFAULT_EXTERNAL_DETAIL_FIELDS]);
    });

    it("keeps each surface selection exact, including selectable system fields", async () => {
      const account = await prisma.user.create({
        data: {
          username: "ext-narrow-whitelist",
          name: "窄白名单用户",
          passwordHash: "x",
          roleId: externalRole.id,
          active: true,
          externalListFields: JSON.stringify(["feedbackTime", "priority"]),
          externalDetailFields: JSON.stringify(["feedbackTime", "priority"]),
        },
      });
      const caller = harness.callerFor(account, externalRole);

      const created = await caller.externalTicket.submit({ submissionText: "窄白名单" });
      const list = await caller.externalTicket.list({ offset: 0, limit: 20 });

      const ticket = list.items.find((t) => t.id === created.id);
      expect(ticket).not.toHaveProperty("workOrderNumber");
      expect(ticket).not.toHaveProperty("status");
      expect(ticket).not.toHaveProperty("customerRequest");

      const detail = await caller.externalTicket.detail({ ticketId: created.id });
      expect(detail.visibleFields).toEqual(["feedbackTime", "priority"]);
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

    it("默认包含已完结；显式状态筛选仍只返回所选状态", async () => {
      const caller = externalCaller1();
      const done = await caller.externalTicket.submit({ submissionText: "已完结的单" });
      await prisma.ticket.update({ where: { id: done.id }, data: { status: "completed" } });

      const defaultList = await caller.externalTicket.list({ offset: 0, limit: 100 });
      expect(defaultList.items.some((t) => t.id === done.id)).toBe(true);

      // 显式状态筛选优先于 includeCompleted 缺省
      const onlyCompleted = await caller.externalTicket.list({
        offset: 0,
        limit: 100,
        status: ["completed"],
      });
      expect(onlyCompleted.items.some((t) => t.id === done.id)).toBe(true);
      expect(onlyCompleted.items.every((t) => t.status === "completed")).toBe(true);
    });

    it("按反馈时间范围含首尾筛选", async () => {
      const caller = externalCaller1();
      const start = await caller.externalTicket.submit({ submissionText: "范围起点" });
      const middle = await caller.externalTicket.submit({ submissionText: "范围中间" });
      const end = await caller.externalTicket.submit({ submissionText: "范围终点" });
      const outside = await caller.externalTicket.submit({ submissionText: "范围之外" });
      await Promise.all([
        prisma.ticket.update({
          where: { id: start.id },
          data: { feedbackTime: new Date("2026-08-01T00:00:00.000Z") },
        }),
        prisma.ticket.update({
          where: { id: middle.id },
          data: { feedbackTime: new Date("2026-08-01T12:00:00.000Z") },
        }),
        prisma.ticket.update({
          where: { id: end.id },
          data: { feedbackTime: new Date("2026-08-01T23:59:59.999Z") },
        }),
        prisma.ticket.update({
          where: { id: outside.id },
          data: { feedbackTime: new Date("2026-08-02T00:00:00.000Z") },
        }),
      ]);

      const list = await caller.externalTicket.list({
        feedbackFrom: "2026-08-01T00:00:00.000Z",
        feedbackTo: "2026-08-01T23:59:59.999Z",
        offset: 0,
        limit: 100,
      });
      const ids = new Set(list.items.map((item) => item.id));
      expect(ids).toEqual(new Set([start.id, middle.id, end.id]));
    });

    it("只搜索详情组已授权字段，电话忽略空格与连字符", async () => {
      const account = await prisma.user.create({
        data: {
          username: "ext-authorized-search",
          name: "授权搜索账号",
          passwordHash: "x",
          roleId: externalRole.id,
          active: true,
          externalListFields: JSON.stringify(["feedbackTime", "customerName", "phone"]),
          externalDetailFields: JSON.stringify(["customerName", "policyNumbers", "phone"]),
        },
      });
      const caller = harness.callerFor(account, externalRole);
      const hit = await caller.externalTicket.submit({ submissionText: "普通原文" });
      await prisma.ticket.update({
        where: { id: hit.id },
        data: {
          customerName: "王小明",
          policyNumbers: ["POL-SEARCH-88"],
          phone: "138-0013 8000",
        },
      });

      expect(
        (await caller.externalTicket.list({ search: "小明", offset: 0, limit: 100 })).items.map(
          (item) => item.id,
        ),
      ).toContain(hit.id);
      expect(
        (
          await caller.externalTicket.list({ search: "138 0013-8000", offset: 0, limit: 100 })
        ).items.map((item) => item.id),
      ).toContain(hit.id);

      await prisma.ticket.update({
        where: { id: hit.id },
        data: { customerName: "绝密姓名" },
      });
      const unauthorized = await externalCaller1().externalTicket.list({
        search: "绝密姓名",
        offset: 0,
        limit: 100,
      });
      expect(unauthorized.items).toHaveLength(0);

      const hiddenSubmission = await caller.externalTicket.list({
        search: "普通原文",
        offset: 0,
        limit: 100,
      });
      expect(hiddenSubmission.items).toHaveLength(0);
      await prisma.user.update({
        where: { id: account.id },
        data: {
          externalDetailFields: JSON.stringify([
            "submissionText",
            "customerName",
            "policyNumbers",
            "phone",
          ]),
        },
      });
      const authorizedSubmission = await caller.externalTicket.list({
        search: "普通原文",
        offset: 0,
        limit: 100,
      });
      expect(authorizedSubmission.items.map((item) => item.id)).toContain(hit.id);
    });

    it("returns no matches when the detail group has no searchable text fields", async () => {
      const account = await prisma.user.create({
        data: {
          username: "ext-no-searchable-fields",
          name: "无文本搜索字段账号",
          passwordHash: "x",
          roleId: externalRole.id,
          active: true,
          externalListFields: JSON.stringify(["status"]),
          externalDetailFields: JSON.stringify(["status", "feedbackTime"]),
        },
      });
      const caller = harness.callerFor(account, externalRole);
      await caller.externalTicket.submit({ submissionText: "不应被搜索命中" });

      const result = await caller.externalTicket.list({
        search: "不应被搜索命中",
        offset: 0,
        limit: 100,
      });

      expect(result.items).toEqual([]);
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

    it("客服公开回复跨刷新保持未读，详情加载后已读，新回复再次触发", async () => {
      const account = await prisma.user.create({
        data: {
          username: "ext-persistent-unread",
          name: "持久未读账号",
          passwordHash: "x",
          roleId: externalRole.id,
          active: true,
        },
      });
      const caller = harness.callerFor(account, externalRole);
      const ticket = await caller.externalTicket.submit({ submissionText: "等待客服回复" });
      const firstReplyAt = new Date("2026-08-01T10:00:00.000Z");
      await prisma.processLog.create({
        data: {
          ticketId: ticket.id,
          action: "comment",
          internalOnly: false,
          remark: "第一次公开回复",
          operatorId: seeded.users.manager.id,
          operatorName: seeded.users.manager.name,
          at: firstReplyAt,
        },
      });

      let item = (await caller.externalTicket.list({ offset: 0, limit: 20 })).items.find(
        (row) => row.id === ticket.id,
      );
      expect(item?.hasUnreadReply).toBe(true);

      await caller.externalTicket.detail({ ticketId: ticket.id });
      expect(
        await prisma.externalTicketReadState.findUnique({
          where: { userId_ticketId: { userId: account.id, ticketId: ticket.id } },
        }),
      ).toMatchObject({ lastReadReplyAt: firstReplyAt });
      item = (await caller.externalTicket.list({ offset: 0, limit: 20 })).items.find(
        (row) => row.id === ticket.id,
      );
      expect(item?.hasUnreadReply).toBe(false);

      await prisma.processLog.create({
        data: {
          ticketId: ticket.id,
          action: "status_change",
          from: "assigned",
          to: "processing",
          remark: "",
          operatorId: seeded.users.manager.id,
          operatorName: seeded.users.manager.name,
          at: new Date("2026-08-01T11:00:00.000Z"),
        },
      });
      item = (await caller.externalTicket.list({ offset: 0, limit: 20 })).items.find(
        (row) => row.id === ticket.id,
      );
      expect(item?.hasUnreadReply).toBe(false);

      await prisma.processLog.create({
        data: {
          ticketId: ticket.id,
          action: "comment",
          internalOnly: false,
          remark: "第二次公开回复",
          operatorId: seeded.users.manager.id,
          operatorName: seeded.users.manager.name,
          at: new Date("2026-08-01T12:00:00.000Z"),
        },
      });
      item = (await caller.externalTicket.list({ offset: 0, limit: 20 })).items.find(
        (row) => row.id === ticket.id,
      );
      expect(item?.hasUnreadReply).toBe(true);
    });

    it("默认按反馈时间倒序，客服新回复不改变行序", async () => {
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

      const replied = await caller.externalTicket.submit({ submissionText: "客服回复了" });
      const noted = await caller.externalTicket.submit({ submissionText: "我留言过" });
      const idle = await caller.externalTicket.submit({ submissionText: "无动静" });

      await Promise.all([
        prisma.ticket.update({
          where: { id: replied.id },
          data: { feedbackTime: new Date("2026-08-01T08:00:00.000Z") },
        }),
        prisma.ticket.update({
          where: { id: noted.id },
          data: { feedbackTime: new Date("2026-08-02T08:00:00.000Z") },
        }),
        prisma.ticket.update({
          where: { id: idle.id },
          data: { feedbackTime: new Date("2026-08-03T08:00:00.000Z") },
        }),
      ]);

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
      expect(ids[0]).toBe(idle.id);
      expect(ids[1]).toBe(noted.id);
      expect(ids[2]).toBe(replied.id);
    });

    it("sorts completion status by the catalog's display order", async () => {
      const firstStatus = await prisma.completionStatus.create({
        data: { id: "z-completion-first", name: "排序第一", displayOrder: 10 },
      });
      const secondStatus = await prisma.completionStatus.create({
        data: { id: "a-completion-second", name: "排序第二", displayOrder: 20 },
      });
      const caller = externalCaller1();
      const first = await caller.externalTicket.submit({ submissionText: "完结状态第一" });
      const second = await caller.externalTicket.submit({ submissionText: "完结状态第二" });
      await Promise.all([
        prisma.ticket.update({
          where: { id: first.id },
          data: { status: "completed", completionStatusId: firstStatus.id },
        }),
        prisma.ticket.update({
          where: { id: second.id },
          data: { status: "completed", completionStatusId: secondStatus.id },
        }),
      ]);

      const result = await caller.externalTicket.list({
        sortBy: "completionStatus",
        sortOrder: "asc",
        offset: 0,
        limit: 100,
      });
      const ids = result.items.map((item) => item.id);

      expect(ids.indexOf(first.id)).toBeLessThan(ids.indexOf(second.id));
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
            action: "status_change",
            from: "assigned",
            to: "processing",
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
      expect(actions).toContain("status_change");
      expect(actions).not.toContain("assign");
      const times = detail.processLogs.map((log) => Date.parse(log.createdAt));
      expect(times).toEqual([...times].sort((a, b) => b - a));

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
