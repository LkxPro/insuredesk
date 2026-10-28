import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Role, User } from "../src/generated/prisma/client.ts";
import {
  createComplaintTicket,
  type IntegrationHarness,
  startIntegrationHarness,
} from "./integration-harness.ts";

describe("外部工单关联提醒", () => {
  let harness: IntegrationHarness;
  let role: Role;
  let owner: User;
  let other: User;

  beforeAll(async () => {
    harness = await startIntegrationHarness({ seed: ["rolesAndUsers"] });
    role = await harness.prisma.role.create({
      data: { name: "外部关联测试", permissions: ["ticket.create_external"] },
    });
    owner = await harness.prisma.user.create({
      data: { username: "related-owner", name: "外部甲", passwordHash: "dummy", roleId: role.id },
    });
    other = await harness.prisma.user.create({
      data: { username: "related-other", name: "外部乙", passwordHash: "dummy", roleId: role.id },
    });
  });

  afterAll(async () => {
    await harness?.stop();
  });

  it.each([
    ["phone", "phone"],
    ["phone", "contactPhone"],
    ["contactPhone", "phone"],
    ["contactPhone", "contactPhone"],
  ] as const)("本单 %s 与另一单 %s 匹配", async (sourceField, targetField) => {
    const phone = `1380000${sourceField === "phone" ? "01" : "02"}${targetField === "phone" ? "01" : "02"}`;
    const source = await createComplaintTicket(
      harness.prisma,
      {
        creatorId: owner.id,
        source: "external_channel",
        contactPhone: sourceField === "contactPhone" ? phone : null,
      },
      { phone: sourceField === "phone" ? phone : null },
    );
    const target = await createComplaintTicket(
      harness.prisma,
      {
        creatorId: owner.id,
        source: "external_channel",
        contactPhone: targetField === "contactPhone" ? phone : null,
      },
      { phone: targetField === "phone" ? phone : null },
    );
    const result = await harness
      .callerFor(owner, role)
      .externalTicket.detail({ ticketId: source.id });
    expect(result.relatedTickets).toEqual([
      expect.objectContaining({ id: target.id, matchedFields: [sourceField] }),
    ]);
  });

  it("任意保单号相同即提醒；排除自身、其他账号、内部工单和软删除单", async () => {
    const source = await createComplaintTicket(
      harness.prisma,
      { creatorId: owner.id, source: "external_channel" },
      { policyNumbers: ["RELATED1", "RELATED2"] },
    );
    const target = await createComplaintTicket(
      harness.prisma,
      { creatorId: owner.id, source: "external_channel", status: "processing" },
      { policyNumbers: ["RELATED2", "RELATED3"] },
    );
    for (const core of [
      { creatorId: other.id, source: "external_channel" },
      { creatorId: harness.seeded.users.admin.id, source: "manual" },
      { creatorId: owner.id, source: "external_channel", deletedAt: new Date() },
      { creatorId: owner.id, source: "external_channel", status: "completed" },
    ]) {
      await createComplaintTicket(harness.prisma, core, { policyNumbers: ["RELATED2"] });
    }
    const caller = harness.callerFor(owner, role);
    const result = await caller.externalTicket.detail({ ticketId: source.id });
    expect(result.relatedTickets).toEqual([
      expect.objectContaining({ id: target.id, matchedFields: ["policyNumbers"] }),
    ]);
    await expect(
      harness.callerFor(other, role).externalTicket.detail({ ticketId: source.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      harness
        .callerFor(harness.seeded.users.admin, harness.seeded.roles.admin)
        .externalTicket.detail({ ticketId: source.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("仅内部跟进不出现在摘要，也不改变关联记录排序", async () => {
    const tickets = [];
    for (let index = 0; index < 3; index++) {
      tickets.push(
        await createComplaintTicket(
          harness.prisma,
          { creatorId: owner.id, source: "external_channel", createdAt: new Date("2026-01-01") },
          { policyNumbers: ["PRIVATE1"] },
        ),
      );
    }
    const [source, first, second] = tickets;
    if (!source || !first || !second) throw new Error("missing fixture");
    await harness.prisma.processLog.createMany({
      data: [
        {
          ticketId: first.id,
          action: "comment",
          remark: "公开跟进",
          internalOnly: false,
          at: new Date("2026-02-01"),
          operatorId: owner.id,
          operatorName: owner.name,
        },
        {
          ticketId: first.id,
          action: "comment",
          remark: "内部秘密",
          internalOnly: true,
          at: new Date("2026-04-01"),
          operatorId: owner.id,
          operatorName: owner.name,
        },
        {
          ticketId: second.id,
          action: "external_note",
          remark: "外部留言",
          at: new Date("2026-03-01"),
          operatorId: owner.id,
          operatorName: owner.name,
        },
      ],
    });
    const result = await harness
      .callerFor(owner, role)
      .externalTicket.detail({ ticketId: source.id });
    expect(result.relatedTickets.map(({ id, activityText }) => ({ id, activityText }))).toEqual([
      { id: second.id, activityText: "外部留言" },
      { id: first.id, activityText: "公开跟进" },
    ]);
    expect(JSON.stringify(result)).not.toContain("内部秘密");
  });

  it("未补全结构化字段时无关联，不从原文猜测电话或保单号", async () => {
    const source = await createComplaintTicket(harness.prisma, {
      creatorId: owner.id,
      source: "external_channel",
      submissionText: "13800000101 RELATED2",
    });
    const result = await harness
      .callerFor(owner, role)
      .externalTicket.detail({ ticketId: source.id });
    expect(result.relatedTickets).toEqual([]);
  });

  it("录入手机号时只查询自己工单，匹配两种电话且隐藏内部记录", async () => {
    const phone = "13912345678";
    const own = await createComplaintTicket(
      harness.prisma,
      { creatorId: owner.id, source: "external_channel" },
      { phone },
    );
    const cross = await createComplaintTicket(harness.prisma, {
      creatorId: owner.id,
      source: "external_channel",
      contactPhone: phone,
    });
    for (const core of [
      { creatorId: other.id, source: "external_channel" },
      { creatorId: harness.seeded.users.admin.id, source: "manual" },
      { creatorId: owner.id, source: "external_channel", deletedAt: new Date() },
      { creatorId: owner.id, source: "external_channel", status: "completed" },
    ])
      await createComplaintTicket(harness.prisma, core, { phone });
    await harness.prisma.processLog.create({
      data: {
        ticketId: own.id,
        action: "comment",
        internalOnly: true,
        remark: "不应泄露的内部记录",
        at: new Date(),
        operatorId: owner.id,
        operatorName: owner.name,
      },
    });
    const caller = harness.callerFor(owner, role);
    const result = await caller.externalTicket.findRelated({ phone: ` ${phone} ` });
    expect(result.map((row) => row.id).sort()).toEqual([own.id, cross.id].sort());
    expect(JSON.stringify(result)).not.toContain("不应泄露的内部记录");
    expect(await caller.externalTicket.findRelated({ phone: "13999999999" })).toEqual([]);
    await expect(
      harness
        .callerFor(harness.seeded.users.admin, harness.seeded.roles.admin)
        .externalTicket.findRelated({ phone }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      harness.callerWith(owner, role, []).externalTicket.findRelated({ phone }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("新提交的手机号保存至投诉明细并立即参与后续关联", async () => {
    const caller = harness.callerFor(owner, role);
    const ticket = await caller.externalTicket.submit({
      phone: " 13712345678 ",
      submissionText: "手机号录入测试",
    });
    const detail = await caller.externalTicket.detail({ ticketId: ticket.id });
    expect(detail.ticket.phone).toBe("13712345678");
    expect(await caller.externalTicket.findRelated({ phone: "13712345678" })).toEqual([
      expect.objectContaining({ id: ticket.id }),
    ]);
    await expect(
      caller.externalTicket.submit({
        phone: "13712345678",
        submissionText: "不能重复提交",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await harness.prisma.ticket.update({ where: { id: ticket.id }, data: { status: "completed" } });
    expect(await caller.externalTicket.findRelated({ phone: "13712345678" })).toEqual([]);
    const second = await caller.externalTicket.submit({
      phone: "13712345678",
      submissionText: "完结后可新建",
    });
    expect(second.id).not.toBe(ticket.id);
  });

  it("并发提交同手机号只创建一单", async () => {
    const caller = harness.callerFor(owner, role);
    const input = { phone: "13612345678", submissionText: "并发提交" };
    const results = await Promise.allSettled([
      caller.externalTicket.submit(input),
      caller.externalTicket.submit(input),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toEqual([
      expect.objectContaining({ reason: expect.objectContaining({ code: "CONFLICT" }) }),
    ]);
    expect(
      await harness.prisma.ticket.count({
        where: { creatorId: owner.id, complaintDetail: { phone: input.phone } },
      }),
    ).toBe(1);
  });

  it("已有工单的联系人电话命中也阻止新建；其他账号同号不阻止", async () => {
    const phone = "13512345678";
    await createComplaintTicket(harness.prisma, {
      creatorId: owner.id,
      source: "external_channel",
      contactPhone: phone,
    });
    await expect(
      harness.callerFor(owner, role).externalTicket.submit({ phone, submissionText: "不能新建" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      harness.callerFor(other, role).externalTicket.submit({ phone, submissionText: "其他账号" }),
    ).resolves.toHaveProperty("id");
  });

  it.each(["", "   ", "1380000", "1380000111x", "138000011111"])(
    "拒绝无效手机号 %j",
    async (phone) => {
      const caller = harness.callerFor(owner, role);
      await expect(
        caller.externalTicket.submit({ phone, submissionText: "不能入库" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(caller.externalTicket.findRelated({ phone })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
    },
  );
});
