import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedRefundDefaultSlaPolicy } from "../prisma/seed-data.ts";
import { parseEnv } from "../src/env.ts";
import type { PrismaClient, SlaPolicy } from "../src/generated/prisma/client.ts";
import { buildServer } from "../src/server.ts";
import { type IntegrationHarness, startIntegrationHarness } from "./integration-harness.ts";

const PUSH_URL = "/api/integrations/jb-insurance/work-orders";
const PUSH_TOKEN = "test-push-token-0123456789";

function formatShanghai(date: Date): string {
  return new Date(date.getTime() + 8 * 3600_000).toISOString().slice(0, 19).replace("T", " ");
}

describe("jb-insurance push API (Testcontainers)", () => {
  let harness: IntegrationHarness;
  let prisma: PrismaClient;
  let app: FastifyInstance;
  let appWithoutToken: FastifyInstance;
  let refundPolicy: SlaPolicy;
  let refundKindId: string;

  let pushSeq = 0;
  function validPush(overrides: Record<string, unknown> = {}) {
    pushSeq += 1;
    return {
      sysOrderId: `SYS${pushSeq}`,
      endorNo: `ENDOR${pushSeq}`,
      workOrderType: "卡异常-退费失败",
      expectedAmount: "100.00",
      refundCreateTime: "2026-08-18 16:40:00",
      refundTrade: [{ tradeNo: "1", payNo: "PAY1", expectedAmount: "100.00" }],
      holderName: "张三",
      holderPhone: "13888888888",
      companyName: "泰康在线",
      productId: "P10001",
      productName: "泰康百万医疗险",
      policyNo: "P20260818000123",
      failureReason: "银行卡状态异常，退款被退回",
      ...overrides,
    };
  }

  function push(payload: unknown, token: string | null = PUSH_TOKEN) {
    return app.inject({
      method: "POST",
      url: PUSH_URL,
      headers: token === null ? {} : { authorization: `Bearer ${token}` },
      payload: payload as Record<string, unknown>,
    });
  }

  beforeAll(async () => {
    harness = await startIntegrationHarness({ seed: ["rolesAndUsers", "slaPolicies"] });
    prisma = harness.prisma;
    refundPolicy = await seedRefundDefaultSlaPolicy(prisma);
    refundKindId = (
      await prisma.ticketKind.findUniqueOrThrow({ where: { key: "refund_exception" } })
    ).id;

    const baseEnv = {
      DATABASE_URL: harness.databaseUrl,
      SESSION_SECRET: "jb-push-test-secret-0123456789abcdef",
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
    } as const;
    app = buildServer(parseEnv({ ...baseEnv, JB_INSURANCE_PUSH_TOKEN: PUSH_TOKEN }));
    appWithoutToken = buildServer(parseEnv(baseEnv));
    await Promise.all([app.ready(), appWithoutToken.ready()]);
  }, 180_000);

  afterAll(async () => {
    await Promise.all([app?.close(), appWithoutToken?.close()]);
    await harness?.stop();
  });

  describe("有效推送建单", () => {
    it("盖章种类/来源/标准字段，落扩展行与 SLA 锚点，返回工单号", async () => {
      const res = await push(validPush());

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toMatchObject({ success: true, code: "0000", message: "" });
      expect(body.data.workOrderNumber).toMatch(/^WO\d+$/);

      const detail = await prisma.ticketRefundDetail.findUniqueOrThrow({
        where: { platform_endorNo: { platform: "jb-insurance", endorNo: "ENDOR1" } },
        include: { ticket: true },
      });
      const ticket = detail.ticket;
      expect(ticket.workOrderNumber).toBe(body.data.workOrderNumber);
      expect(ticket).toMatchObject({
        source: "jb-insurance",
        kindId: refundKindId,
        status: "unassigned",
        slaPolicyId: refundPolicy.id,
      });
      // 不变量：退费行必无投诉 detail（持有人信息只落 refundDetail）
      expect(
        await prisma.ticketComplaintDetail.findUnique({ where: { ticketId: ticket.id } }),
      ).toBeNull();

      const anchor = new Date("2026-08-18T16:40:00+08:00");
      expect(ticket.slaAnchorAt.getTime()).toBe(anchor.getTime());
      expect(ticket.dueAt?.getTime()).toBe(anchor.getTime() + 48 * 3600_000);
      expect(ticket.firstResponseRequirement).toBe("120分钟内完成首次响应");

      expect(detail).toMatchObject({
        sysOrderId: "SYS1",
        workOrderType: "卡异常-退费失败",
        expectedAmount: "100.00",
        holderName: "张三",
        holderPhone: "13888888888",
        companyName: "泰康在线",
        productId: "P10001",
        productName: "泰康百万医疗险",
        policyNo: "P20260818000123",
        failureReason: "银行卡状态异常，退款被退回",
        compensationAmount: null,
      });
      expect(detail.refundCreateTime.getTime()).toBe(anchor.getTime());
      expect(detail.refundTrades).toEqual([
        { tradeNo: "1", payNo: "PAY1", expectedAmount: "100.00" },
      ]);
      expect(detail.pushedFields.sort()).toEqual(
        [
          "sysOrderId",
          "endorNo",
          "workOrderType",
          "expectedAmount",
          "refundCreateTime",
          "refundTrade",
          "holderName",
          "holderPhone",
          "companyName",
          "productId",
          "productName",
          "policyNo",
          "failureReason",
        ].sort(),
      );

      const createLog = await prisma.processLog.findFirst({
        where: { ticketId: ticket.id, action: "create" },
      });
      expect(createLog).not.toBeNull();
    });

    it("金额原样存取（不规整化）", async () => {
      const res = await push(validPush({ expectedAmount: "100.5" }));
      expect(res.json().code).toBe("0000");
      const detail = await prisma.ticketRefundDetail.findUniqueOrThrow({
        where: { platform_endorNo: { platform: "jb-insurance", endorNo: `ENDOR${pushSeq}` } },
      });
      expect(detail.expectedAmount).toBe("100.5");
    });

    it("workOrderType 不做枚举校验，平台新增类型照收", async () => {
      const res = await push(validPush({ workOrderType: "平台新增类型-X" }));
      expect(res.json().code).toBe("0000");
      const detail = await prisma.ticketRefundDetail.findUniqueOrThrow({
        where: { platform_endorNo: { platform: "jb-insurance", endorNo: `ENDOR${pushSeq}` } },
      });
      expect(detail.workOrderType).toBe("平台新增类型-X");
    });

    it("缺省的可选字段不锁：pushedFields 只含实收字段", async () => {
      const res = await push(
        validPush({
          holderName: undefined,
          holderPhone: undefined,
          companyName: undefined,
          productId: undefined,
          productName: undefined,
          policyNo: undefined,
          failureReason: undefined,
        }),
      );
      expect(res.json().code).toBe("0000");
      const detail = await prisma.ticketRefundDetail.findUniqueOrThrow({
        where: { platform_endorNo: { platform: "jb-insurance", endorNo: `ENDOR${pushSeq}` } },
        include: { ticket: true },
      });
      expect(detail.pushedFields.sort()).toEqual(
        [
          "sysOrderId",
          "endorNo",
          "workOrderType",
          "expectedAmount",
          "refundCreateTime",
          "refundTrade",
        ].sort(),
      );
      // 不变量：退费行必无投诉 detail
      expect(
        await prisma.ticketComplaintDetail.findUnique({
          where: { ticketId: detail.ticket.id },
        }),
      ).toBeNull();
    });

    it("空白串可选字段按缺省处理，不进 pushedFields", async () => {
      const res = await push(validPush({ holderPhone: "   " }));
      expect(res.json().code).toBe("0000");
      const detail = await prisma.ticketRefundDetail.findUniqueOrThrow({
        where: { platform_endorNo: { platform: "jb-insurance", endorNo: `ENDOR${pushSeq}` } },
        include: { ticket: true },
      });
      expect(detail.holderPhone).toBeNull();
      expect(
        await prisma.ticketComplaintDetail.findUnique({
          where: { ticketId: detail.ticket.id },
        }),
      ).toBeNull();
      expect(detail.pushedFields).not.toContain("holderPhone");
    });

    it("盖退费组内 active 且 sortOrder 最小的策略", async () => {
      const tighter = await prisma.slaPolicy.create({
        data: {
          name: "退费加急策略",
          kindId: refundKindId,
          sortOrder: -1,
          active: true,
          firstResponseMinutes: 10,
          overdueHours: 1,
          reminderRules: [],
        },
      });
      try {
        const res = await push(validPush());
        expect(res.json().code).toBe("0000");
        const detail = await prisma.ticketRefundDetail.findUniqueOrThrow({
          where: { platform_endorNo: { platform: "jb-insurance", endorNo: `ENDOR${pushSeq}` } },
          include: { ticket: true },
        });
        expect(detail.ticket.slaPolicyId).toBe(tighter.id);
        const anchor = new Date("2026-08-18T16:40:00+08:00");
        expect(detail.ticket.dueAt?.getTime()).toBe(anchor.getTime() + 1 * 3600_000);
      } finally {
        await prisma.slaPolicy.update({ where: { id: tighter.id }, data: { active: false } });
      }
    });

    it("入单同事务广播 refund_pushed 给启用且持 ticket.assign 的用户", async () => {
      const res = await push(validPush());
      expect(res.json().code).toBe("0000");
      const ticket = await prisma.ticket.findFirstOrThrow({
        where: { refundDetail: { sysOrderId: `SYS${pushSeq}` } },
      });

      const notifications = await prisma.appNotification.findMany({
        where: { type: "refund_pushed", ticketId: ticket.id },
      });
      const targetIds = notifications.map((n) => n.targetUserId);
      expect(targetIds).toContain(harness.seeded.users.manager.id);
      expect(targetIds).not.toContain(harness.seeded.users.cs1.id);
      expect(targetIds).not.toContain(harness.seeded.users.observer.id);
      for (const n of notifications) {
        expect(n.workOrderNumber).toBe(ticket.workOrderNumber);
      }
    });

    it("推送不跑工单查重：同电话同保单号的存量投诉单不影响建单", async () => {
      await harness
        .callerFor(harness.seeded.users.manager, harness.seeded.roles.csManager)
        .ticket.create({
          feedbackTime: "2026-08-20T02:00:00.000Z",
          project: "融盛",
          brokerageEntity: "东方大地",
          paymentChannel: "连连支付",
          policyNumbers: ["P-DUP-1"],
          userFeedbackChannelId: null,
          customerName: "钱查重",
          phone: "13800000001",
          customerRequest: "投诉内容",
          nuclearBodyStatus: "待核实",
          hasContacted: false,
          slaPolicyId: harness.slaPolicyId("一般投诉"),
        });

      const payload = validPush({ holderPhone: "13800000001", policyNo: "P-DUP-1" });
      const res = await push(payload);
      expect(res.json().code).toBe("0000");

      expect(await prisma.ticketComplaintDetail.count({ where: { phone: "13800000001" } })).toBe(1);
      expect(await prisma.ticketRefundDetail.count({ where: { holderPhone: "13800000001" } })).toBe(
        1,
      );
    });
  });

  describe("幂等", () => {
    it("重复 endorNo 返回 0000 + 首次工单号，全库只一单", async () => {
      const payload = validPush();
      const first = await push(payload);
      const second = await push(payload);

      expect(first.json().code).toBe("0000");
      expect(second.json()).toMatchObject({ success: true, code: "0000", message: "" });
      expect(second.json().data.workOrderNumber).toBe(first.json().data.workOrderNumber);
      expect(await prisma.ticketRefundDetail.count({ where: { endorNo: payload.endorNo } })).toBe(
        1,
      );
      expect(
        await prisma.ticketRefundDetail.count({ where: { sysOrderId: payload.sysOrderId } }),
      ).toBe(1);
    });

    it("并发同 endorNo 只建一单，全部返回同一工单号", async () => {
      const payload = validPush();
      const results = await Promise.all(Array.from({ length: 5 }, () => push(payload)));

      const numbers = new Set(results.map((r) => r.json().data?.workOrderNumber));
      for (const r of results) {
        expect(r.json().code).toBe("0000");
      }
      expect(numbers.size).toBe(1);
      expect(await prisma.ticketRefundDetail.count({ where: { endorNo: payload.endorNo } })).toBe(
        1,
      );
      expect(
        await prisma.ticketRefundDetail.count({ where: { sysOrderId: payload.sysOrderId } }),
      ).toBe(1);
    });
  });

  describe("认证与错误码", () => {
    it("无 Authorization 头 → 401 + 9998 envelope", async () => {
      const res = await push(validPush(), null);
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ success: false, code: "9998", data: null });
      expect(res.json().message).toBeTruthy();
    });

    it("错 token → 401 + 9998 envelope", async () => {
      const res = await push(validPush(), "wrong-token");
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ success: false, code: "9998", data: null });
    });

    it("缺必填字段 → 200 + 9998，报错点名字段", async () => {
      const payload = validPush();
      delete (payload as Record<string, unknown>).endorNo;
      const res = await push(payload);
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toMatchObject({ success: false, code: "9998", data: null });
      expect(body.message).toContain("endorNo");
    });

    it("参数错误不回显推送值（PII）", async () => {
      const secret = "SECRET999VALUE";
      const res = await push(validPush({ expectedAmount: secret }));
      const body = res.json();
      expect(body.code).toBe("9998");
      expect(body.message).toContain("expectedAmount");
      expect(body.message).not.toContain(secret);
    });

    it("金额边界：1.005 / .5 / 5. 拒收；0.01 收", async () => {
      for (const bad of ["1.005", ".5", "5."]) {
        const res = await push(validPush({ expectedAmount: bad }));
        expect(res.json().code, bad).toBe("9998");
      }
      const ok = await push(validPush({ expectedAmount: "0.01" }));
      expect(ok.json().code).toBe("0000");
    });

    it("malformed JSON → 200 + 9998 envelope", async () => {
      const res = await app.inject({
        method: "POST",
        url: PUSH_URL,
        headers: { authorization: `Bearer ${PUSH_TOKEN}`, "content-type": "application/json" },
        payload: "{not-json",
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ success: false, code: "9998", data: null });
    });

    it("未来时间超 5 分钟偏差 → 9998；2 分钟内照收", async () => {
      const future10 = formatShanghai(new Date(Date.now() + 10 * 60_000));
      const res10 = await push(validPush({ refundCreateTime: future10 }));
      expect(res10.json().code).toBe("9998");
      expect(res10.json().message).toContain("refundCreateTime");

      const future2 = formatShanghai(new Date(Date.now() + 2 * 60_000));
      const res2 = await push(validPush({ refundCreateTime: future2 }));
      expect(res2.json().code).toBe("0000");
    });

    it("不可能日期 → 9998", async () => {
      const res = await push(validPush({ refundCreateTime: "2026-02-30 10:00:00" }));
      expect(res.json().code).toBe("9998");
    });
  });

  describe("退费组零 active 策略", () => {
    it("应答 9999 并 ops_alert 告警管理员，不落单", async () => {
      await prisma.slaPolicy.update({ where: { id: refundPolicy.id }, data: { active: false } });
      try {
        const payload = validPush();
        const res = await push(payload);
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({ success: false, code: "9999", data: null });

        const alerts = await prisma.appNotification.findMany({
          where: { type: "ops_alert", targetUserId: harness.seeded.users.admin.id },
        });
        expect(alerts.length).toBeGreaterThan(0);
        expect(await prisma.ticketRefundDetail.count({ where: { endorNo: payload.endorNo } })).toBe(
          0,
        );
      } finally {
        await prisma.slaPolicy.update({ where: { id: refundPolicy.id }, data: { active: true } });
      }
    });
  });

  describe("env 缺省降级", () => {
    it("无 JB_INSURANCE_PUSH_TOKEN 系统正常启动，推送应答 9999", async () => {
      const res = await appWithoutToken.inject({
        method: "POST",
        url: PUSH_URL,
        headers: { authorization: "Bearer anything" },
        payload: validPush(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ success: false, code: "9999", data: null });
    });
  });
});
