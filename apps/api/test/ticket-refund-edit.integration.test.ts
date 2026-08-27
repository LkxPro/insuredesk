import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedRefundDefaultSlaPolicy } from "../prisma/seed-data.ts";
import type { PrismaClient } from "../src/generated/prisma/client.ts";
import { type IntegrationHarness, startIntegrationHarness } from "./integration-harness.ts";

describe("退费异常工单编辑契约与补偿金 (Testcontainers)", () => {
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
      status?: string;
      compensationAmount?: string | null;
      pushedFields?: string[];
    } = {},
  ) {
    seq += 1;
    const ticket = await prisma.ticket.create({
      data: {
        source: "jb-insurance",
        kindId: refundKindId,
        slaAnchorAt: new Date("2026-08-24T08:40:00.000Z"),
        status: overrides.status ?? "processing",
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

  describe("editRefund 契约", () => {
    it("裁键：仅联系人电话与时效策略可改，其余键缺席正常落库", async () => {
      const ticket = await createRefundTicket();

      const result = await manager().ticket.editRefund({
        ticketId: ticket.id,
        contactPhone: "13911112222",
        slaPolicyId: refundPolicyId,
      });
      expect(result.changedFields).toEqual(expect.arrayContaining(["contactPhone", "slaPolicyId"]));

      const row = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
      expect(row.contactPhone).toBe("13911112222");
      expect(row.slaPolicyId).toBe(refundPolicyId);
      expect(row.dueAt).not.toBeNull();

      const log = await prisma.processLog.findFirstOrThrow({
        where: { ticketId: ticket.id, action: "edit" },
      });
      expect(log.remark).toContain("联系人电话: （空）→13911112222");
      expect(log.remark).toContain("时效策略: （空）→退费异常默认策略");
      expect(log.from).toBeNull();
      expect(log.to).toBe("退费异常默认策略");
    });

    it("墓碑：携带任一下沉键即报错（含 null 值）", async () => {
      const ticket = await createRefundTicket();
      for (const key of ["customerName", "feedbackTime", "policyNumbers", "priority"]) {
        const error = await manager()
          .ticket.editRefund({ ticketId: ticket.id, [key]: null })
          .catch((e: unknown) => e);
        expect(error, key).toMatchObject({
          code: "BAD_REQUEST",
          message: expect.stringContaining("退费工单仅可编辑联系人电话与时效策略"),
        });
      }
    });

    it("kind 核对：editRefund 拒投诉单，editComplaint 拒退费单", async () => {
      const refund = await createRefundTicket();
      await manager().ticket.create({ customerName: "投诉客户", allowDuplicate: true });
      const complaint = await prisma.ticket.findFirstOrThrow({
        where: { complaintDetail: { customerName: "投诉客户" } },
      });

      await expect(
        manager().ticket.editRefund({ ticketId: complaint.id, contactPhone: "13800000000" }),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringContaining("editComplaint"),
      });
      await expect(
        manager().ticket.editComplaint({ ticketId: refund.id, contactPhone: "13800000000" }),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: expect.stringContaining("editRefund"),
      });
    });

    it("contactPhone 改动触发提交兜底查重；allowDuplicate 放行", async () => {
      const blocker = await manager().ticket.create({
        customerName: "占位客户",
        contactPhone: "13700001111",
        allowDuplicate: true,
      });
      expect(blocker.id).toBeDefined();
      const ticket = await createRefundTicket();

      await expect(
        manager().ticket.editRefund({ ticketId: ticket.id, contactPhone: "13700001111" }),
      ).rejects.toMatchObject({ code: "CONFLICT" });

      const forced = await manager().ticket.editRefund({
        ticketId: ticket.id,
        contactPhone: "13700001111",
        allowDuplicate: true,
      });
      expect(forced.changedFields).toContain("contactPhone");
    });

    it("contactPhone 未改不查重：编辑无关字段不被存量重复阻塞", async () => {
      const ticket = await createRefundTicket();
      await manager().ticket.editRefund({
        ticketId: ticket.id,
        contactPhone: "13700002222",
        allowDuplicate: true,
      });
      const result = await manager().ticket.editRefund({
        ticketId: ticket.id,
        contactPhone: "13700002222",
        slaPolicyId: refundPolicyId,
      });
      expect(result.changedFields).toEqual(["slaPolicyId"]);
    });

    it("旧端点 ticket.edit 墓碑：退费/投诉任何调用一律报客户端版本过旧", async () => {
      const refund = await createRefundTicket();
      const complaint = await manager().ticket.create({
        customerName: "投诉客户甲",
        slaPolicyId: harness.slaPolicyId("一般投诉"),
        allowDuplicate: true,
      });

      for (const input of [
        { ticketId: refund.id, contactPhone: "13600003333", slaPolicyId: refundPolicyId },
        { ticketId: refund.id, customerName: "张三" },
        { ticketId: complaint.id, customerName: "改名客户" },
      ]) {
        const error = await manager()
          .ticket.edit(input)
          .catch((e: unknown) => e);
        expect(error).toMatchObject({
          code: "BAD_REQUEST",
          message: expect.stringContaining("客户端版本过旧，请刷新"),
        });
      }
    });

    it("editComplaint 对缺 detail 行的存量投诉单 upsert 补齐", async () => {
      const legacy = await prisma.ticket.create({
        data: {
          source: "manual",
          kindId: complaintKindId,
          slaAnchorAt: new Date("2026-08-01T00:00:00.000Z"),
          status: "processing",
        },
      });

      const result = await manager().ticket.editComplaint({
        ticketId: legacy.id,
        customerName: "补齐客户",
      });
      expect(result.changedFields).toContain("customerName");

      const detail = await prisma.ticketComplaintDetail.findUniqueOrThrow({
        where: { ticketId: legacy.id },
      });
      expect(detail.customerName).toBe("补齐客户");

      const log = await prisma.processLog.findFirstOrThrow({
        where: { ticketId: legacy.id, action: "edit" },
      });
      expect(log.remark).toContain("客户姓名: （空）→补齐客户");
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
    it("detail 带 refundDetail 全字段与最新回调投递；下沉字段键保留、值恒为 null", async () => {
      const ticket = await createRefundTicket({
        pushedFields: ["holderName", "sysOrderId"],
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

      expect(detail).toMatchObject({
        feedbackTime: null,
        channel: null,
        project: null,
        customerName: null,
        phone: null,
        policyNumbers: [],
        noPolicyNumber: false,
        category: null,
        priority: null,
        contactTime: null,
      });

      const complaint = await manager().ticket.create({
        customerName: "投诉客户",
        slaPolicyId: harness.slaPolicyId("一般投诉"),
        allowDuplicate: true,
      });
      const complaintDetail = await manager().ticket.detail({ id: complaint.id });
      expect(complaintDetail.refundDetail).toBeNull();
      expect(complaintDetail.callbackDelivery).toBeNull();
      expect(complaintDetail.customerName).toBe("投诉客户");
    });
  });
});
