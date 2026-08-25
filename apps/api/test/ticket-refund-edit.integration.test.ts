import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedRefundDefaultSlaPolicy } from "../prisma/seed-data.ts";
import type { PrismaClient } from "../src/generated/prisma/client.ts";
import { type IntegrationHarness, startIntegrationHarness } from "./integration-harness.ts";

describe("退费异常工单编辑锁定与补偿金 (Testcontainers)", () => {
  let harness: IntegrationHarness;
  let prisma: PrismaClient;
  let refundKindId: string;
  let complaintKindId: string;
  let refundPolicyId: string;
  let seq = 0;

  beforeAll(async () => {
    harness = await startIntegrationHarness({ seed: ["rolesAndUsers", "slaPolicies"] });
    prisma = harness.prisma;
    refundKindId = (
      await prisma.ticketKind.findUniqueOrThrow({ where: { key: "refund_exception" } })
    ).id;
    complaintKindId = (await prisma.ticketKind.findUniqueOrThrow({ where: { key: "complaint" } }))
      .id;
    // 退费组策略独立于 seedSlaPolicies 的 count==0 守卫，harness 的 slaPolicyId 查不到它
    refundPolicyId = (await seedRefundDefaultSlaPolicy(prisma)).id;
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  });

  const manager = () =>
    harness.callerFor(harness.seeded.users.manager, harness.seeded.roles.csManager);
  const observer = () =>
    harness.callerFor(harness.seeded.users.observer, harness.seeded.roles.readOnly);
  const frontline = () =>
    harness.callerFor(harness.seeded.users.cs1, harness.seeded.roles.frontline);

  async function createRefundTicket(
    overrides: {
      pushedFields?: string[];
      status?: string;
      stamped?: {
        customerName?: string | null;
        phone?: string | null;
        policyNumbers?: string[];
        internalOrderNumber?: string | null;
      };
      compensationAmount?: string | null;
    } = {},
  ) {
    seq += 1;
    const stamped = overrides.stamped ?? {};
    const ticket = await prisma.ticket.create({
      data: {
        source: "jb-insurance",
        kindId: refundKindId,
        slaAnchorAt: new Date("2026-08-24T08:40:00.000Z"),
        status: overrides.status ?? "processing",
        customerName: stamped.customerName ?? null,
        phone: stamped.phone ?? null,
        policyNumbers: stamped.policyNumbers ?? [],
        internalOrderNumber: stamped.internalOrderNumber ?? `SO-${seq}`,
      },
    });
    await prisma.ticketRefundDetail.create({
      data: {
        ticketId: ticket.id,
        platform: "jb-insurance",
        endorNo: `ENDOR-EDIT-${seq}`,
        sysOrderId: `SO-${seq}`,
        workOrderType: "卡异常-退费失败",
        expectedAmount: "100.00",
        refundCreateTime: new Date("2026-08-24T08:40:00.000Z"),
        refundTrades: [{ tradeNo: "1", payNo: `PAY-EDIT-${seq}`, expectedAmount: "100.00" }],
        pushedFields: overrides.pushedFields ?? [],
        compensationAmount: overrides.compensationAmount ?? null,
      },
    });
    return ticket;
  }

  function editPayload(
    ticket: { id: string; internalOrderNumber: string | null },
    overrides: Record<string, unknown> = {},
  ) {
    return {
      ticketId: ticket.id,
      internalOrderNumber: ticket.internalOrderNumber,
      slaPolicyId: refundPolicyId,
      ...overrides,
    };
  }

  describe("推送实收字段只读", () => {
    it("修改 pushedFields 盖章的标准字段被拒（客户姓名/客户电话/保单号/内部订单号）", async () => {
      const ticket = await createRefundTicket({
        pushedFields: ["holderName", "holderPhone", "policyNo", "sysOrderId"],
        stamped: {
          customerName: "张三",
          phone: "13800000001",
          policyNumbers: ["P-1"],
        },
      });

      const attempts: Array<[string, Record<string, unknown>]> = [
        ["客户姓名", { customerName: "张四" }],
        ["客户电话", { phone: "13800000002" }],
        ["保单号", { policyNumbers: ["P-2"] }],
        ["内部订单号", { internalOrderNumber: "SO-OTHER" }],
      ];
      for (const [label, patch] of attempts) {
        const error = await manager()
          .ticket.edit(editPayload(ticket, patch))
          .catch((e: unknown) => e);
        expect(error, `${label} 应被拒绝`).toMatchObject({
          code: "BAD_REQUEST",
          message: expect.stringContaining(label),
        });
      }
    });

    it("推送缺省的可选字段不在 pushedFields 内，可正常后补", async () => {
      const ticket = await createRefundTicket({ pushedFields: ["sysOrderId"] });

      const result = await manager().ticket.edit(
        editPayload(ticket, { customerName: "后补客户", phone: "13800000003", project: "融盛" }),
      );
      expect(result.changedFields).toEqual(
        expect.arrayContaining(["customerName", "phone", "project"]),
      );

      const detail = await manager().ticket.detail({ id: ticket.id });
      expect(detail.customerName).toBe("后补客户");
      expect(detail.phone).toBe("13800000003");
    });

    it("实收字段原值重写不算修改，同编辑其他字段可正常通过", async () => {
      const ticket = await createRefundTicket({
        pushedFields: ["holderName"],
        stamped: { customerName: "张三" },
      });

      const result = await manager().ticket.edit(
        editPayload(ticket, { customerName: "张三", project: "融盛" }),
      );
      expect(result.changedFields).toContain("project");
      expect(result.changedFields).not.toContain("customerName");
    });

    it("投诉单不受 pushedFields 语义影响（无扩展行），正常编辑", async () => {
      const created = await manager().ticket.create({
        customerName: "投诉客户",
        slaPolicyId: harness.slaPolicyId("一般投诉"),
        allowDuplicate: true,
      });
      const result = await manager().ticket.edit({
        ticketId: created.id,
        customerName: "改名客户",
        slaPolicyId: harness.slaPolicyId("一般投诉"),
      });
      expect(result.changedFields).toEqual(["customerName"]);
    });
  });

  describe("补偿金编辑 (ticket.updateRefundCompensation)", () => {
    it("ticket.process 持有者填写补偿金：落库并留 edit 处理记录", async () => {
      const ticket = await createRefundTicket();

      const result = await manager().ticket.updateRefundCompensation({
        ticketId: ticket.id,
        compensationAmount: "20.50",
      });
      expect(result).toMatchObject({ compensationAmount: "20.50" });

      const detail = await prisma.ticketRefundDetail.findUniqueOrThrow({
        where: { ticketId: ticket.id },
      });
      expect(detail.compensationAmount).toBe("20.50");

      const log = await prisma.processLog.findFirstOrThrow({
        where: { ticketId: ticket.id, action: "edit" },
        orderBy: { at: "desc" },
      });
      expect(log.remark).toContain("补偿金");
      expect(log.remark).toContain("20.50");
    });

    it("空值 = 无补偿：清空已填补偿金", async () => {
      const ticket = await createRefundTicket({ compensationAmount: "20.50" });

      await manager().ticket.updateRefundCompensation({
        ticketId: ticket.id,
        compensationAmount: null,
      });
      const detail = await prisma.ticketRefundDetail.findUniqueOrThrow({
        where: { ticketId: ticket.id },
      });
      expect(detail.compensationAmount).toBeNull();

      await manager().ticket.updateRefundCompensation({
        ticketId: ticket.id,
        compensationAmount: "30",
      });
      await manager().ticket.updateRefundCompensation({
        ticketId: ticket.id,
        compensationAmount: "",
      });
      const cleared = await prisma.ticketRefundDetail.findUniqueOrThrow({
        where: { ticketId: ticket.id },
      });
      expect(cleared.compensationAmount).toBeNull();
    });

    it("负数/非法金额被 schema 拒绝", async () => {
      const ticket = await createRefundTicket();
      await expect(
        manager().ticket.updateRefundCompensation({
          ticketId: ticket.id,
          compensationAmount: "-5",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(
        manager().ticket.updateRefundCompensation({
          ticketId: ticket.id,
          compensationAmount: "abc",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(
        manager().ticket.updateRefundCompensation({
          ticketId: ticket.id,
          compensationAmount: "1.005",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("完结后修改被拒", async () => {
      const ticket = await createRefundTicket({ compensationAmount: "20" });
      await prisma.ticket.update({
        where: { id: ticket.id },
        data: {
          status: "completed",
          completionTime: new Date("2026-08-25T02:00:00.000Z"),
        },
      });

      await expect(
        manager().ticket.updateRefundCompensation({
          ticketId: ticket.id,
          compensationAmount: "30",
        }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });

    it("投诉单无补偿金可编辑", async () => {
      const ticket = await prisma.ticket.create({
        data: {
          source: "manual",
          kindId: complaintKindId,
          slaAnchorAt: new Date("2026-08-24T08:40:00.000Z"),
          status: "processing",
        },
      });

      await expect(
        manager().ticket.updateRefundCompensation({
          ticketId: ticket.id,
          compensationAmount: "20",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("无 ticket.process 权限被拒", async () => {
      const ticket = await createRefundTicket();
      await expect(
        observer().ticket.updateRefundCompensation({
          ticketId: ticket.id,
          compensationAmount: "20",
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("无数据范围可见性的处理者看到的是 NOT_FOUND", async () => {
      const ticket = await createRefundTicket();
      await expect(
        frontline().ticket.updateRefundCompensation({
          ticketId: ticket.id,
          compensationAmount: "20",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  describe("退费详情读出口", () => {
    it("detail 带 refundDetail 全字段与最新回调投递；投诉单为 null", async () => {
      const ticket = await createRefundTicket({
        pushedFields: ["holderName", "sysOrderId"],
        stamped: { customerName: "张三" },
        compensationAmount: "20",
      });
      await prisma.ticketRefundDetail.update({
        where: { ticketId: ticket.id },
        data: {
          holderName: "张三",
          holderPhone: "13800000001",
          companyName: "泰康在线",
          productId: "P10001",
          productName: "泰康百万医疗险",
          policyNo: "P-1",
          failureReason: "银行卡状态异常",
        },
      });
      await prisma.callbackDelivery.create({
        data: {
          ticketId: ticket.id,
          sysOrderId: `SO-${seq}`,
          endorNo: `ENDOR-EDIT-${seq}`,
          workOrderNumber: "WO-X",
          actualAmount: "100.00",
          status: "dead",
          attempts: 3,
          lastError: "平台 HTTP 500",
        },
      });

      const detail = await manager().ticket.detail({ id: ticket.id });
      expect(detail.refundDetail).toMatchObject({
        workOrderType: "卡异常-退费失败",
        expectedAmount: "100.00",
        failureReason: "银行卡状态异常",
        holderName: "张三",
        holderPhone: "13800000001",
        companyName: "泰康在线",
        productId: "P10001",
        productName: "泰康百万医疗险",
        policyNo: "P-1",
        compensationAmount: "20",
        pushedFields: ["holderName", "sysOrderId"],
        refundTrades: [{ tradeNo: "1", payNo: `PAY-EDIT-${seq}`, expectedAmount: "100.00" }],
      });
      expect(detail.refundDetail?.sysOrderId).toBe(`SO-${seq}`);
      expect(detail.callbackDelivery).toMatchObject({
        status: "dead",
        attempts: 3,
        lastError: "平台 HTTP 500",
      });

      const complaint = await manager().ticket.create({
        customerName: "投诉客户",
        slaPolicyId: harness.slaPolicyId("一般投诉"),
        allowDuplicate: true,
      });
      const complaintDetail = await manager().ticket.detail({ id: complaint.id });
      expect(complaintDetail.refundDetail).toBeNull();
      expect(complaintDetail.callbackDelivery).toBeNull();
    });
  });
});
