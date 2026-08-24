import type { Permission, TicketCreateInput } from "@insuredesk/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client.ts";
import { type IntegrationHarness, startIntegrationHarness } from "./integration-harness.ts";

describe("退费异常完结回调投递行 (Testcontainers)", () => {
  let harness: IntegrationHarness;
  let prisma: PrismaClient;
  let refundKindId: string;
  let seq = 0;

  beforeAll(async () => {
    harness = await startIntegrationHarness({ seed: ["rolesAndUsers", "slaPolicies"] });
    prisma = harness.prisma;
    refundKindId = (
      await prisma.ticketKind.findUniqueOrThrow({ where: { key: "refund_exception" } })
    ).id;
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  });

  const manager = () =>
    harness.callerFor(harness.seeded.users.manager, harness.seeded.roles.csManager);

  async function statusId(name: string) {
    return (await prisma.completionStatus.findUniqueOrThrow({ where: { name } })).id;
  }

  async function createAssignedRefundTicket(
    overrides: { compensationAmount?: string | null } = {},
  ) {
    seq += 1;
    const ticket = await prisma.ticket.create({
      data: {
        source: "jb-insurance",
        kindId: refundKindId,
        slaAnchorAt: new Date("2026-08-24T08:40:00.000Z"),
        status: "assigned",
        assigneeId: harness.seeded.users.cs1.id,
        assignedAt: new Date("2026-08-24T09:00:00.000Z"),
      },
    });
    await prisma.ticketRefundDetail.create({
      data: {
        ticketId: ticket.id,
        platform: "jb-insurance",
        endorNo: `ENDOR-${seq}`,
        sysOrderId: `SO-${seq}`,
        workOrderType: "卡异常-退费失败",
        expectedAmount: "100.00",
        refundCreateTime: new Date("2026-08-24T08:40:00.000Z"),
        refundTrades: [{ tradeNo: "1", payNo: `PAY-${seq}`, expectedAmount: "100.00" }],
        compensationAmount: overrides.compensationAmount ?? null,
      },
    });
    return prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
  }

  it("完结退费异常工单：同事务落 callback_deliveries 行，载荷快照原样锁定", async () => {
    const ticket = await createAssignedRefundTicket({ compensationAmount: "20" });

    const result = await manager().ticket.resolve({
      ticketId: ticket.id,
      completionStatusId: await statusId("已协商解决"),
      remark: "已线下打款，客户确认到账",
    });
    expect(result.status).toBe("completed");

    const rows = await prisma.callbackDelivery.findMany({ where: { ticketId: ticket.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "pending",
      attempts: 0,
      firstAttemptAt: null,
      nextAttemptAt: null,
      sysOrderId: `SO-${seq}`,
      endorNo: `ENDOR-${seq}`,
      workOrderNumber: ticket.workOrderNumber,
      actualAmount: "100.00",
      compensationAmount: "20",
      remark: "已线下打款，客户确认到账",
      operator: harness.seeded.users.manager.username,
      lastError: null,
      deliveredAt: null,
    });
  });

  it("无补偿金时快照 compensationAmount 为 null", async () => {
    const ticket = await createAssignedRefundTicket({ compensationAmount: null });

    await manager().ticket.resolve({
      ticketId: ticket.id,
      completionStatusId: await statusId("已协商解决"),
      remark: "原路退回完成",
    });

    const row = await prisma.callbackDelivery.findFirstOrThrow({ where: { ticketId: ticket.id } });
    expect(row.compensationAmount).toBeNull();
  });

  it("完结投诉单不产生投递行", async () => {
    const input: TicketCreateInput & { allowDuplicate?: boolean } = {
      feedbackTime: "2026-08-24T02:00:00.000Z",
      project: "融盛",
      brokerageEntity: "东方大地",
      paymentChannel: "连连支付",
      policyNumbers: ["P20260824001"],
      userFeedbackChannelId: null,
      customerName: "投诉客户",
      phone: "13800000099",
      customerRequest: "投诉理赔进度",
      nuclearBodyStatus: "待核实",
      hasContacted: false,
      slaPolicyId: harness.slaPolicyId("一般投诉"),
      allowDuplicate: true,
    };
    const created = await manager().ticket.create(input);
    await manager().ticket.assign({
      ticketId: created.id,
      assigneeId: harness.seeded.users.cs1.id,
    });

    await manager().ticket.resolve({
      ticketId: created.id,
      completionStatusId: await statusId("正常完结"),
      remark: "客户认可处理结果",
    });

    expect(await prisma.callbackDelivery.count({ where: { ticketId: created.id } })).toBe(0);
  });

  describe("人工重新投递 redeliverCallback", () => {
    async function createDeadDelivery() {
      const ticket = await createAssignedRefundTicket();
      return prisma.callbackDelivery.create({
        data: {
          ticketId: ticket.id,
          sysOrderId: `SO-${seq}`,
          endorNo: `ENDOR-${seq}`,
          workOrderNumber: ticket.workOrderNumber,
          actualAmount: "100.00",
          status: "dead",
          attempts: 9,
          firstAttemptAt: new Date("2026-08-24T08:00:00.000Z"),
          lastError: "平台 9998：工单回调解密异常",
        },
      });
    }

    it("死信行复位为 pending 并清零退避轨迹", async () => {
      const dead = await createDeadDelivery();

      const result = await manager().ticket.redeliverCallback({ deliveryId: dead.id });
      expect(result).toMatchObject({ id: dead.id, status: "pending" });

      const after = await prisma.callbackDelivery.findUniqueOrThrow({ where: { id: dead.id } });
      expect(after).toMatchObject({
        status: "pending",
        attempts: 0,
        firstAttemptAt: null,
        nextAttemptAt: null,
        lastError: null,
      });
    });

    it("非死信行拒绝复位", async () => {
      const ticket = await createAssignedRefundTicket();
      const pending = await prisma.callbackDelivery.create({
        data: {
          ticketId: ticket.id,
          sysOrderId: `SO-${seq}`,
          endorNo: `ENDOR-${seq}`,
          workOrderNumber: ticket.workOrderNumber,
          actualAmount: "100.00",
        },
      });

      await expect(
        manager().ticket.redeliverCallback({ deliveryId: pending.id }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });

    it("未知投递记录 → NOT_FOUND", async () => {
      await expect(
        manager().ticket.redeliverCallback({ deliveryId: "no-such-delivery" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("无 ticket.process 权限 → FORBIDDEN", async () => {
      const dead = await createDeadDelivery();
      const observer = harness.callerWith(
        harness.seeded.users.observer,
        harness.seeded.roles.readOnly,
        ["ticket.view"] as Permission[],
      );

      await expect(
        observer.ticket.redeliverCallback({ deliveryId: dead.id }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });
});
