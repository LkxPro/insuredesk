import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createComplaintTicket,
  type IntegrationHarness,
  startIntegrationHarness,
} from "./integration-harness.ts";

describe("工单列表消息预览", () => {
  let harness: IntegrationHarness;

  beforeAll(async () => {
    harness = await startIntegrationHarness({ seed: ["rolesAndUsers"] });
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  });

  beforeEach(async () => {
    await harness.prisma.ticket.deleteMany();
  });

  it("返回三类沟通中的最新非空正文，跳过更晚的系统事件和空白", async () => {
    const { prisma, seeded } = harness;
    const ticket = await createComplaintTicket(prisma);
    await prisma.processLog.createMany({
      data: [
        { id: "message-a", action: "comment", remark: "已联系客户" },
        { id: "message-b", action: "internal_note", remark: "补充核实信息" },
        { id: "message-c", action: "external_note", remark: "客户确认\n等待退款" },
        { id: "message-d", action: "comment", remark: " \n\t\u3000\u00a0" },
        { id: "message-e", action: "resolve", remark: "已完结" },
      ].map((log, index) => ({
        ...log,
        ticketId: ticket.id,
        operatorId: seeded.users.manager.id,
        operatorName: "测试发送人",
        at: new Date(Date.UTC(2026, 10, 10, 0, index)),
      })),
    });

    const result = await harness
      .callerFor(seeded.users.manager, seeded.roles.csManager)
      .ticket.list({});
    expect(result.items).toEqual([
      expect.objectContaining({
        id: ticket.id,
        latestMessage: "客户确认\n等待退款",
        latestMessageAction: "external_note",
        latestMessageAuthor: "测试发送人",
        latestMessageAt: "2026-11-10T00:02:00.000Z",
      }),
    ]);
  });

  it("相同时间按记录 id 定序，各工单独立，无消息返回 null", async () => {
    const { prisma, seeded } = harness;
    const first = await createComplaintTicket(prisma);
    const second = await createComplaintTicket(prisma);
    const empty = await createComplaintTicket(prisma);
    await prisma.processLog.createMany({
      data: [
        {
          id: "tie-b",
          ticketId: first.id,
          action: "internal_note",
          remark: "最后的内部备注",
          internalOnly: true,
        },
        { id: "tie-a", ticketId: first.id, action: "external_note", remark: "客户留言" },
        { id: "other", ticketId: second.id, action: "comment", remark: "第二张工单" },
        { id: "empty", ticketId: empty.id, action: "comment", remark: "" },
      ].map((log) => ({
        ...log,
        operatorId: seeded.users.manager.id,
        at: new Date("2026-11-10T00:00:00Z"),
      })),
    });
    const caller = harness.callerFor(seeded.users.manager, seeded.roles.csManager);
    const list = await caller.ticket.list({});
    expect(list.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: first.id,
          latestMessage: "最后的内部备注",
          latestMessageAction: "internal_note",
        }),
        expect.objectContaining({
          id: second.id,
          latestMessage: "第二张工单",
          latestMessageAction: "comment",
        }),
        expect.objectContaining({ id: empty.id, latestMessage: null, latestMessageAction: null }),
      ]),
    );
    const detail = await caller.ticket.detail({ id: first.id });
    expect(detail.processLogs.map((log) => log.remark)).toEqual(["客户留言", "最后的内部备注"]);
  });

  it("预览沿用个人范围、查看全部和软删除约束，详情不可越权读取", async () => {
    const { prisma, seeded } = harness;
    const own = await createComplaintTicket(prisma, { creatorId: seeded.users.cs1.id });
    const assigned = await createComplaintTicket(prisma, { assigneeId: seeded.users.cs1.id });
    const hidden = await createComplaintTicket(prisma, { creatorId: seeded.users.manager.id });
    const deleted = await createComplaintTicket(prisma, {
      creatorId: seeded.users.cs1.id,
      deletedAt: new Date(),
    });
    for (const ticket of [own, assigned, hidden, deleted]) {
      await prisma.processLog.create({
        data: {
          ticketId: ticket.id,
          action: "comment",
          remark: `消息-${ticket.id}`,
          operatorId: seeded.users.manager.id,
          at: new Date(),
        },
      });
    }
    const caller = harness.callerFor(seeded.users.cs1, seeded.roles.frontline);
    const list = await caller.ticket.list({});
    expect(list.items.map((item) => item.id).sort()).toEqual([own.id, assigned.id].sort());
    expect(list.items.every((item) => item.latestMessage === `消息-${item.id}`)).toBe(true);
    await expect(caller.ticket.detail({ id: hidden.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(caller.ticket.detail({ id: deleted.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const manager = harness.callerFor(seeded.users.manager, seeded.roles.csManager);
    expect((await manager.ticket.list({})).items.map((item) => item.id).sort()).toEqual(
      [own.id, assigned.id, hidden.id].sort(),
    );
    await expect(
      harness.callerWith(seeded.users.cs1, seeded.roles.frontline, []).ticket.list({}),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await caller.ticket.list({ search: "没有这张工单" })).items).toEqual([]);
  });

  it("外部列表不增加内部预览，外部详情仍过滤内部消息", async () => {
    const { prisma, seeded } = harness;
    const role = await prisma.role.create({
      data: {
        name: "预览测试外部角色",
        permissions: ["ticket.create_external", "ticket.process_external"],
      },
    });
    const user = await prisma.user.create({
      data: {
        username: "preview-external",
        name: "预览外部用户",
        passwordHash: "unused",
        roleId: role.id,
      },
    });
    const ticket = await createComplaintTicket(prisma, {
      creatorId: user.id,
      source: "external_channel",
    });
    await prisma.processLog.createMany({
      data: [
        { action: "comment", remark: "公开回复", internalOnly: false },
        { action: "internal_note", remark: "仅内部可见", internalOnly: true },
      ].map((log, index) => ({
        ...log,
        ticketId: ticket.id,
        operatorId: seeded.users.manager.id,
        at: new Date(Date.UTC(2026, 10, 10, 0, index)),
      })),
    });
    const caller = harness.callerFor(user, role);
    const list = await caller.externalTicket.list({ offset: 0, limit: 20 });
    expect(list.items[0]).not.toHaveProperty("latestMessage");
    const detail = await caller.externalTicket.detail({ ticketId: ticket.id });
    expect(detail.processLogs.map((log) => log.remark)).toEqual(["公开回复"]);
    await expect(caller.ticket.list({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
