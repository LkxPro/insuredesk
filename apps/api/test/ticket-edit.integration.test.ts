import type { Permission, TicketCreateInput, TicketEditInput } from "@insuredesk/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient, Role, User } from "../src/generated/prisma/client";
import { appRouter } from "../src/routers/index";
import { effectivePermissions } from "../src/services/auth.service";
import { type IntegrationHarness, startIntegrationHarness } from "./integration-harness";

const HOUR_MS = 60 * 60 * 1000;

/**
 * Acceptance tests against a real Postgres: 编辑工单 (any status,
 * 已完结 included; status untouchable; 改 complaintLevel 重算 dueAt off
 * createdAt + re-stamps the SLA requirement strings; one `edit` ProcessLog
 * per effective edit with the field diff in remark) and 软删除
 * (deletedAt tombstone; default list, detail and every lifecycle action
 * exclude it; ProcessLogs survive; no restore). Runs through
 * appRouter.createCaller — the same procedure pipeline (permission middleware
 * included) the HTTP adapter uses.
 */
describe("ticket edit + soft delete (Testcontainers)", () => {
  let harness: IntegrationHarness;
  let prisma: PrismaClient;
  let seeded: IntegrationHarness["seeded"];
  let cs2: User;

  beforeAll(async () => {
    harness = await startIntegrationHarness({ seed: ["rolesAndUsers", "slaPolicies"] });
    prisma = harness.prisma;
    seeded = harness.seeded;

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

  /** Caller with the given user identity and an explicit permission set. */
  function callerWith(user: User, roleName: string, permissions: Permission[]) {
    return appRouter.createCaller({
      traceId: "edit-test",
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
        externalOrgId: null,
      },
      sessionToken: null,
    });
  }

  /** Caller with the given seeded user's identity, permissions from their role. */
  function callerFor(user: User, role: Role) {
    return callerWith(user, role.name, effectivePermissions(role));
  }

  const admin = () => callerFor(seeded.users.admin, seeded.roles.admin);
  const manager = () => callerFor(seeded.users.manager, seeded.roles.csManager);
  const frontline = () => callerFor(seeded.users.cs1, seeded.roles.frontline);
  const observer = () => callerFor(seeded.users.observer, seeded.roles.readOnly);

  const baseInput = {
    feedbackTime: "2026-07-09T02:00:00.000Z",
    project: "融盛",
    brokerageEntity: "东方大地",
    paymentChannel: "连连支付",
    policyNumbers: ["P2026071000829"],
    userComplaintChannel: "400热线",
    customerName: "张三",
    phone: "13800000004",
    customerRequest: "对理赔金额有异议，要求复核",
    nuclearBodyStatus: "待核实",
    hasContacted: false,
    complaintLevel: "一般投诉",
  } satisfies TicketCreateInput;

  /** Full edit payload for the ticket: the unchanged base fields + overrides. */
  function editInput(ticketId: string, overrides: Partial<TicketEditInput> = {}): TicketEditInput {
    return { ticketId, ...baseInput, ...overrides };
  }

  /** A fresh unassigned ticket, created through the real create procedure. */
  async function createTicket(overrides: Partial<TicketCreateInput> = {}) {
    const created = await manager().ticket.create({ ...baseInput, ...overrides });
    return created.id;
  }

  /** A fresh completed ticket assigned to cs1. */
  async function createCompletedTicket() {
    const ticketId = await createTicket();
    await manager().ticket.assign({ ticketId, assigneeId: seeded.users.cs1.id });
    const status = await prisma.completionStatus.findUniqueOrThrow({
      where: { name: "已协商解决" },
    });
    await frontline().ticket.resolve({
      ticketId,
      completionStatusId: status.id,
      remark: "双方达成一致",
    });
    return ticketId;
  }

  describe("编辑基本信息（任意状态）", () => {
    it("edits multiple fields and writes one edit log with the before→after diff, from/to empty", async () => {
      const ticketId = await createTicket();

      const result = await manager().ticket.edit(
        editInput(ticketId, {
          customerName: "张三丰",
          internalOrderNumber: "IO-20260710-01",
          hasContacted: true,
          priority: "high",
          contactTime: "2026-07-08T13:15:00.000Z",
          complaintReceiveChannel: "监管转办",
        }),
      );
      expect(result).toMatchObject({ id: ticketId });
      expect([...result.changedFields].sort()).toEqual(
        [
          "customerName",
          "complaintReceiveChannel",
          "contactTime",
          "hasContacted",
          "internalOrderNumber",
          "priority",
        ].sort(),
      );

      const detail = await manager().ticket.detail({ id: ticketId });
      expect(detail.customerName).toBe("张三丰");
      expect(detail.internalOrderNumber).toBe("IO-20260710-01");
      expect(detail.hasContacted).toBe(true);
      expect(detail.priority).toBe("high");
      expect(detail.contactTime).toBe("2026-07-08T13:15:00.000Z");
      expect(detail.complaintReceiveChannel).toBe("监管转办");

      // 留痕: exactly one edit entry on top of create, remark carries the
      // per-field diff in 描述表行序（＝表单顺序）, from/to stay empty
      expect(detail.processLogs.map((log) => log.action)).toEqual(["create", "edit"]);
      const editLog = detail.processLogs.at(-1);
      expect(editLog).toMatchObject({
        operatorId: seeded.users.manager.id,
        operatorName: seeded.users.manager.name,
        from: null,
        to: null,
      });
      expect(editLog?.remark).toBe(
        "内部订单号: （空）→IO-20260710-01；" +
          "投诉信息接收渠道: （空）→监管转办；" +
          "客户姓名: 张三→张三丰；" +
          "客户曾进线: 否→是；" +
          "进线时间: （空）→2026-07-08T13:15:00.000Z；" +
          "优先级: （空）→高",
      );
    });

    it("clears 进线时间/投诉信息接收渠道 back to 未填写, logged as →（空）", async () => {
      const ticketId = await createTicket({
        contactTime: "2026-07-08T13:15:00.000Z",
        complaintReceiveChannel: "邮箱接收",
      });

      const result = await manager().ticket.edit(
        editInput(ticketId, {
          contactTime: null,
          complaintReceiveChannel: null,
        }),
      );
      expect([...result.changedFields].sort()).toEqual(
        ["complaintReceiveChannel", "contactTime"].sort(),
      );

      const detail = await manager().ticket.detail({ id: ticketId });
      expect(detail.contactTime).toBeNull();
      expect(detail.complaintReceiveChannel).toBeNull();
      const editLog = detail.processLogs.at(-1);
      expect(editLog?.remark).toContain("进线时间: 2026-07-08T13:15:00.000Z→（空）");
      expect(editLog?.remark).toContain("投诉信息接收渠道: 邮箱接收→（空）");
    });

    it("edits 保单号 multi values with space-joined remark; clearing logs （空）; 等值提交不留痕", async () => {
      const ticketId = await createTicket();

      const changed = await manager().ticket.edit(
        editInput(ticketId, { policyNumbers: ["P-A", "P-B"] }),
      );
      expect(changed.changedFields).toEqual(["policyNumbers"]);
      let detail = await manager().ticket.detail({ id: ticketId });
      expect(detail.policyNumbers).toEqual(["P-A", "P-B"]);
      expect(detail.processLogs.at(-1)?.remark).toBe("保单号: P2026071000829→P-A P-B");

      // 重复项在契约层去重，去重后与现值相同＝无改动
      const noop = await manager().ticket.edit(
        editInput(ticketId, { policyNumbers: ["P-A", "P-B", "P-A"] }),
      );
      expect(noop.changedFields).toEqual([]);

      const cleared = await manager().ticket.edit(editInput(ticketId, { policyNumbers: [] }));
      expect(cleared.changedFields).toEqual(["policyNumbers"]);
      detail = await manager().ticket.detail({ id: ticketId });
      expect(detail.policyNumbers).toEqual([]);
      expect(detail.processLogs.at(-1)?.remark).toBe("保单号: P-A P-B→（空）");
    });

    it("edits a completed ticket without reopening it (终态保持, 完结信息不动)", async () => {
      const ticketId = await createCompletedTicket();
      const before = await manager().ticket.detail({ id: ticketId });

      await manager().ticket.edit(editInput(ticketId, { customerName: "李四" }));

      const detail = await manager().ticket.detail({ id: ticketId });
      expect(detail.customerName).toBe("李四");
      expect(detail.status).toBe("completed");
      expect(detail.displayStatus).toBe("completed");
      expect(detail.completionStatus).toBe(before.completionStatus);
      expect(detail.completionTime).toBe(before.completionTime);
      expect(detail.processLogs.at(-1)?.action).toBe("edit");
    });

    it("ignores a smuggled status field: not editable, completed stays completed", async () => {
      const ticketId = await createCompletedTicket();

      await manager().ticket.edit({
        ...editInput(ticketId, { customerName: "王五" }),
        // Not part of the contract — Zod strips unknown keys, nothing reopens
        status: "processing",
      } as TicketEditInput);

      const detail = await manager().ticket.detail({ id: ticketId });
      expect(detail.status).toBe("completed");
      expect(detail.customerName).toBe("王五");
    });

    it("a no-change edit succeeds but leaves no trace (no empty-remark log)", async () => {
      const ticketId = await createTicket();

      const result = await manager().ticket.edit(editInput(ticketId));
      expect(result.changedFields).toEqual([]);

      const detail = await manager().ticket.detail({ id: ticketId });
      expect(detail.processLogs.map((log) => log.action)).toEqual(["create"]);
    });
  });

  describe("改 complaintLevel = 改 SLA（重算 dueAt、切换要求）", () => {
    it("特急→一般 on a 70h-old ticket: dueAt = createdAt + 48h, immediately overdue", async () => {
      const ticketId = await createTicket({ complaintLevel: "特急投诉" });
      // 特急: no deadline at all
      expect((await manager().ticket.detail({ id: ticketId })).dueAt).toBeNull();

      // Backdate the ticket well past 一般's 48h window
      const createdAt = new Date(Date.now() - 70 * HOUR_MS);
      await prisma.ticket.update({ where: { id: ticketId }, data: { createdAt } });

      await manager().ticket.edit(editInput(ticketId, { complaintLevel: "一般投诉" }));

      const detail = await manager().ticket.detail({ id: ticketId });
      // The creation formula re-runs off the UNCHANGED createdAt
      expect(detail.dueAt).toBe(new Date(createdAt.getTime() + 48 * HOUR_MS).toISOString());
      // 录入已超 48h → the ticket flips overdue the moment the edit commits
      expect(detail.displayStatus).toBe("overdue");
      // The requirement strings re-stamp from the NEW level's policy
      expect(detail.firstResponseRequirement).toBe("120分钟内完成首次响应");
      expect(detail.followUpFrequency).toBe("24小时内累计跟进1次；48小时内累计跟进2次");
      // …and the edit remark records the level change
      expect(detail.processLogs.at(-1)?.remark).toContain("投诉等级: 特急投诉→一般投诉");

      // The overdue 口径 (list filter side) picks it up with no extra writes
      const { items } = await manager().ticket.list({
        status: "overdue",
        search: detail.workOrderNumber,
      });
      expect(items.map((item) => item.id)).toEqual([ticketId]);
    });

    it("一般→特急 clears the deadline: dueAt null, never overdue again", async () => {
      const ticketId = await createTicket();
      // Already past the 一般 deadline: backdate creation AND the stamped dueAt
      const createdAt = new Date(Date.now() - 70 * HOUR_MS);
      await prisma.ticket.update({
        where: { id: ticketId },
        data: { createdAt, dueAt: new Date(createdAt.getTime() + 48 * HOUR_MS) },
      });
      expect((await manager().ticket.detail({ id: ticketId })).displayStatus).toBe("overdue");

      await manager().ticket.edit(editInput(ticketId, { complaintLevel: "特急投诉" }));

      const detail = await manager().ticket.detail({ id: ticketId });
      expect(detail.dueAt).toBeNull();
      expect(detail.displayStatus).toBe("unassigned");
      expect(detail.firstResponseRequirement).toBe("30分钟内完成首次响应");
    });

    it("priority edits drive no SLA field (dueAt/要求串 untouched)", async () => {
      const ticketId = await createTicket();
      const before = await manager().ticket.detail({ id: ticketId });

      await manager().ticket.edit(editInput(ticketId, { priority: "urgent" }));

      const detail = await manager().ticket.detail({ id: ticketId });
      expect(detail.priority).toBe("urgent");
      expect(detail.dueAt).toBe(before.dueAt);
      expect(detail.followUpFrequency).toBe(before.followUpFrequency);
      expect(detail.firstResponseRequirement).toBe(before.firstResponseRequirement);
    });
  });

  describe("软删除", () => {
    it("soft-deletes: deletedAt stamped, gone from default list/detail, ProcessLogs kept", async () => {
      const ticketId = await createTicket();
      const { workOrderNumber } = await manager().ticket.detail({ id: ticketId });

      const result = await admin().ticket.delete({ ticketId });
      expect(result).toEqual({ id: ticketId, workOrderNumber });

      // Tombstone, not a physical delete — row and its logs stay 可追溯
      const row = await prisma.ticket.findUnique({ where: { id: ticketId } });
      expect(row?.deletedAt).toBeInstanceOf(Date);
      expect(await prisma.processLog.count({ where: { ticketId } })).toBeGreaterThan(0);

      // Default list and detail exclude it (一切默认读已过滤 deletedAt)
      const { items, total } = await admin().ticket.list({ search: workOrderNumber });
      expect(items).toEqual([]);
      expect(total).toBe(0);
      await expect(admin().ticket.detail({ id: ticketId })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("a deleted ticket rejects every further action, deletion included (只删不恢复)", async () => {
      const ticketId = await createTicket();
      await manager().ticket.assign({ ticketId, assigneeId: seeded.users.cs1.id });
      await admin().ticket.delete({ ticketId });

      await expect(admin().ticket.delete({ ticketId })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(
        admin().ticket.edit(editInput(ticketId, { customerName: "删后编辑" })),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        frontline().ticket.addComment({ ticketId, remark: "删后跟进" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(manager().ticket.assign({ ticketId, assigneeId: cs2.id })).rejects.toMatchObject(
        { code: "NOT_FOUND" },
      );
    });

    it("statistics exclude deleted tickets: the list total drops with the delete", async () => {
      const keptId = await createTicket({ policyNumbers: ["P-KEEP-0001"] });
      const droppedId = await createTicket({ policyNumbers: ["P-KEEP-0001"] });

      const before = await admin().ticket.list({ search: "P-KEEP-0001" });
      expect(before.total).toBe(2);

      await admin().ticket.delete({ ticketId: droppedId });

      const after = await admin().ticket.list({ search: "P-KEEP-0001" });
      expect(after.total).toBe(1);
      expect(after.items.map((item) => item.id)).toEqual([keptId]);
    });
  });

  describe("RBAC and data scope", () => {
    it("rejects edit without ticket.edit (一线客服/只读观察) and delete without ticket.delete (客服主管)", async () => {
      const ticketId = await createTicket();

      await expect(
        frontline().ticket.edit(editInput(ticketId, { customerName: "无权编辑" })),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        observer().ticket.edit(editInput(ticketId, { customerName: "无权编辑" })),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      // 客服主管 deliberately lacks the dangerous ticket.delete
      await expect(manager().ticket.delete({ ticketId })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });

    it("applies the data scope: ticket.edit without ticket.view_all stays on own tickets", async () => {
      const ownTicketId = await createTicket();
      await manager().ticket.assign({ ticketId: ownTicketId, assigneeId: seeded.users.cs1.id });
      const othersTicketId = await createTicket();
      await manager().ticket.assign({ ticketId: othersTicketId, assigneeId: cs2.id });

      const scopedEditor = () =>
        callerWith(seeded.users.cs1, "scoped-editor", ["ticket.view", "ticket.edit"]);

      await expect(
        scopedEditor().ticket.edit(editInput(othersTicketId, { customerName: "越权" })),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });

      const result = await scopedEditor().ticket.edit(
        editInput(ownTicketId, { customerName: "本人工单" }),
      );
      expect(result.changedFields).toEqual(["customerName"]);
    });

    it("applies the data scope to delete: ticket.delete without ticket.view_all stays on own tickets", async () => {
      const othersTicketId = await createTicket();
      await manager().ticket.assign({ ticketId: othersTicketId, assigneeId: cs2.id });

      const scopedDeleter = () =>
        callerWith(seeded.users.cs1, "scoped-deleter", ["ticket.view", "ticket.delete"]);

      await expect(
        scopedDeleter().ticket.delete({ ticketId: othersTicketId }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("lets the creator without ticket.view_all edit their own ticket — unassigned and after handoff", async () => {
      const creatorEditor = () =>
        callerWith(seeded.users.cs1, "受限创建人", ["ticket.view", "ticket.create", "ticket.edit"]);
      const created = await creatorEditor().ticket.create(baseInput);

      const whileUnassigned = await creatorEditor().ticket.edit(
        editInput(created.id, { customerName: "创建人未指派时改" }),
      );
      expect(whileUnassigned.changedFields).toEqual(["customerName"]);

      await manager().ticket.assign({ ticketId: created.id, assigneeId: cs2.id });
      const afterHandoff = await creatorEditor().ticket.edit(
        editInput(created.id, { customerName: "创建人他人处理时改" }),
      );
      expect(afterHandoff.changedFields).toEqual(["customerName"]);
    });

    it("lets the creator without ticket.view_all delete their own ticket assigned to someone else", async () => {
      const creatorDeleter = () =>
        callerWith(seeded.users.cs1, "受限创建人", [
          "ticket.view",
          "ticket.create",
          "ticket.delete",
        ]);
      const created = await creatorDeleter().ticket.create(baseInput);
      await manager().ticket.assign({ ticketId: created.id, assigneeId: cs2.id });

      const result = await creatorDeleter().ticket.delete({ ticketId: created.id });
      expect(result.id).toBe(created.id);

      const row = await prisma.ticket.findUnique({ where: { id: created.id } });
      expect(row?.deletedAt).not.toBeNull();
    });
  });
});
