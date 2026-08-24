import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fixedClock } from "../src/clock.ts";
import type { CallbackDelivery, PrismaClient } from "../src/generated/prisma/client.ts";
import {
  type CallbackFetch,
  startCallbackDeliveryWorker,
  tickCallbackDeliveries,
} from "../src/services/callback-delivery.service.ts";
import { decryptRefundCallback } from "../src/services/refund-callback-crypto.ts";
import { type IntegrationHarness, startIntegrationHarness } from "./integration-harness.ts";

const CALLBACK_URL = "https://platform.example.com/api/work/order/callback";
const SECRET = "28631eafa8d346f68b3c3bbab0fac5ec";
const NOW = new Date("2026-08-25T08:00:00.000Z");

type FetchResult = { status: number; body: string } | { throwError: Error };

function stubFetch(...results: FetchResult[]) {
  const calls: { url: string; init: { body: string; headers: Record<string, string> } }[] = [];
  const fetchImpl: CallbackFetch = async (url, init) => {
    calls.push({ url, init });
    const result = results.length > 1 ? results.shift() : results[0];
    if (!result) {
      throw new Error("stubFetch: no result configured");
    }
    if ("throwError" in result) {
      throw result.throwError;
    }
    return { status: result.status, text: async () => result.body };
  };
  return { fetchImpl, calls };
}

const okPlatform = {
  status: 200,
  body: JSON.stringify({ success: true, code: "0000", message: "", data: true }),
};

describe("callback-delivery tick (Testcontainers)", () => {
  let harness: IntegrationHarness;
  let prisma: PrismaClient;
  let refundKindId: string;
  let seq = 0;

  beforeAll(async () => {
    harness = await startIntegrationHarness({ seed: ["rolesAndUsers"] });
    prisma = harness.prisma;
    refundKindId = (
      await prisma.ticketKind.findUniqueOrThrow({ where: { key: "refund_exception" } })
    ).id;
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  });

  beforeEach(async () => {
    await prisma.callbackDelivery.deleteMany();
    await prisma.appNotification.deleteMany();
    await prisma.ticket.deleteMany();
  });

  async function createDelivery(
    overrides: Partial<{
      status: string;
      attempts: number;
      firstAttemptAt: Date | null;
      nextAttemptAt: Date | null;
      compensationAmount: string | null;
      remark: string | null;
      operator: string | null;
      actualAmount: string;
    }> = {},
  ): Promise<CallbackDelivery> {
    seq += 1;
    const ticket = await prisma.ticket.create({
      data: { source: "jb-insurance", kindId: refundKindId, slaAnchorAt: NOW },
    });
    return prisma.callbackDelivery.create({
      data: {
        ticketId: ticket.id,
        sysOrderId: `SO${seq}`,
        endorNo: `ENDOR${seq}`,
        workOrderNumber: ticket.workOrderNumber,
        actualAmount: overrides.actualAmount ?? "100.00",
        compensationAmount: overrides.compensationAmount ?? null,
        remark: overrides.remark ?? "线下退款完成",
        operator: overrides.operator ?? "cs01",
        status: overrides.status ?? "pending",
        attempts: overrides.attempts ?? 0,
        firstAttemptAt: overrides.firstAttemptAt ?? null,
        nextAttemptAt: overrides.nextAttemptAt ?? null,
      },
    });
  }

  function tickWith(fetchImpl: CallbackFetch, at: Date = NOW) {
    return tickCallbackDeliveries({
      prisma,
      clock: fixedClock(at),
      config: { callbackUrl: CALLBACK_URL, callbackSecret: SECRET },
      fetch: fetchImpl,
    });
  }

  it("0000+data=true → delivered：信封 channel/body 可解密还原载荷快照", async () => {
    const row = await createDelivery({ compensationAmount: "20" });
    const { fetchImpl, calls } = stubFetch(okPlatform);

    const summary = await tickWith(fetchImpl);

    expect(summary).toMatchObject({ attempted: 1, delivered: 1, retried: 0, dead: 0 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(CALLBACK_URL);
    expect(calls[0]?.init.headers["Content-Type"]).toContain("application/json");
    const envelope = JSON.parse(calls[0]?.init.body ?? "");
    expect(envelope.channel).toBe("WORK-ORDER");
    expect(JSON.parse(decryptRefundCallback(SECRET, envelope.body))).toEqual({
      sysOrderId: row.sysOrderId,
      endorNo: row.endorNo,
      actualAmount: "100.00",
      workOrderNumber: row.workOrderNumber,
      compensationAmount: "20",
      remark: "线下退款完成",
      operator: "cs01",
    });

    const after = await prisma.callbackDelivery.findUniqueOrThrow({ where: { id: row.id } });
    expect(after).toMatchObject({
      status: "delivered",
      attempts: 1,
      nextAttemptAt: null,
      lastError: null,
    });
    expect(after.firstAttemptAt?.toISOString()).toBe(NOW.toISOString());
    expect(after.deliveredAt?.toISOString()).toBe(NOW.toISOString());
  });

  it("compensationAmount 为 null 时载荷不携带该字段", async () => {
    await createDelivery({ compensationAmount: null });
    const { fetchImpl, calls } = stubFetch(okPlatform);

    await tickWith(fetchImpl);

    const envelope = JSON.parse(calls[0]?.init.body ?? "");
    const payload = JSON.parse(decryptRefundCallback(SECRET, envelope.body));
    expect("compensationAmount" in payload).toBe(false);
  });

  it("9999+data=false → 保持 pending，5m 后退避重试", async () => {
    const row = await createDelivery();
    const { fetchImpl } = stubFetch({
      status: 200,
      body: JSON.stringify({
        success: false,
        code: "9999",
        message: "工单回调处理异常: 对账失败",
        data: false,
      }),
    });

    const summary = await tickWith(fetchImpl);

    expect(summary).toMatchObject({ attempted: 1, delivered: 0, retried: 1, dead: 0 });
    const after = await prisma.callbackDelivery.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe("pending");
    expect(after.attempts).toBe(1);
    expect(after.firstAttemptAt?.toISOString()).toBe(NOW.toISOString());
    expect(after.nextAttemptAt?.toISOString()).toBe(
      new Date(NOW.getTime() + 5 * 60_000).toISOString(),
    );
    expect(after.lastError).toContain("9999");
    expect(after.lastError).toContain("对账失败");
  });

  it("0000+data=false 视同 9999 → 退避重试", async () => {
    const row = await createDelivery();
    const { fetchImpl } = stubFetch({
      status: 200,
      body: JSON.stringify({ success: true, code: "0000", message: "", data: false }),
    });

    await tickWith(fetchImpl);

    const after = await prisma.callbackDelivery.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe("pending");
    expect(after.nextAttemptAt?.toISOString()).toBe(
      new Date(NOW.getTime() + 5 * 60_000).toISOString(),
    );
  });

  it.each([
    ["非 200", { status: 502, body: "Bad Gateway" }],
    ["200 但非 JSON", { status: 200, body: "<html>not json</html>" }],
    ["fetch 抛错（超时/网络）", { throwError: new Error("The operation timed out") }],
  ])("%s → 退避重试", async (_label, result) => {
    const row = await createDelivery();
    const { fetchImpl } = stubFetch(result as FetchResult);

    await tickWith(fetchImpl);

    const after = await prisma.callbackDelivery.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe("pending");
    expect(after.attempts).toBe(1);
    expect(after.nextAttemptAt?.toISOString()).toBe(
      new Date(NOW.getTime() + 5 * 60_000).toISOString(),
    );
    expect(after.lastError).toBeTruthy();
  });

  it("退避档位 5m→30m→2h 循环：第 2/3/4 次失败分别 +30m/+2h/+5m", async () => {
    const fail = {
      status: 200,
      body: JSON.stringify({ success: false, code: "9999", message: "x", data: false }),
    };
    const cases = [
      { attempts: 1, expectMs: 30 * 60_000 },
      { attempts: 2, expectMs: 2 * 60 * 60_000 },
      { attempts: 3, expectMs: 5 * 60_000 },
    ];
    for (const { attempts, expectMs } of cases) {
      const row = await createDelivery({
        attempts,
        firstAttemptAt: new Date(NOW.getTime() - 60 * 60_000),
        nextAttemptAt: new Date(NOW.getTime() - 1000),
      });
      await tickWith(stubFetch(fail).fetchImpl);
      const after = await prisma.callbackDelivery.findUniqueOrThrow({ where: { id: row.id } });
      expect(after.attempts).toBe(attempts + 1);
      expect(after.nextAttemptAt?.toISOString()).toBe(
        new Date(NOW.getTime() + expectMs).toISOString(),
      );
    }
  });

  it("9998 → 终止为 dead 并经 ops_alert 告警管理员", async () => {
    const row = await createDelivery();
    const { fetchImpl } = stubFetch({
      status: 200,
      body: JSON.stringify({
        success: false,
        code: "9998",
        message: "工单回调解密异常",
        data: false,
      }),
    });

    const summary = await tickWith(fetchImpl);

    expect(summary).toMatchObject({ attempted: 1, dead: 1 });
    const after = await prisma.callbackDelivery.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe("dead");
    expect(after.nextAttemptAt).toBeNull();
    expect(after.lastError).toContain("9998");

    const alerts = await prisma.appNotification.findMany({
      where: { type: "ops_alert", workOrderNumber: row.workOrderNumber },
    });
    expect(alerts.map((a) => a.targetUserId)).toEqual([harness.seeded.users.admin.id]);
    expect(alerts[0]?.ticketId).toBe(row.ticketId);
    expect(alerts[0]?.content).toContain("9998");
  });

  it("自首试满 24h → 不再发请求，直接 dead + ops_alert 告警", async () => {
    const row = await createDelivery({
      attempts: 6,
      firstAttemptAt: new Date(NOW.getTime() - 24 * 60 * 60_000 - 60_000),
      nextAttemptAt: new Date(NOW.getTime() - 1000),
    });
    const { fetchImpl, calls } = stubFetch(okPlatform);

    const summary = await tickWith(fetchImpl);

    expect(calls).toHaveLength(0);
    expect(summary.dead).toBe(1);
    const after = await prisma.callbackDelivery.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe("dead");
    expect(after.nextAttemptAt).toBeNull();

    const alerts = await prisma.appNotification.findMany({
      where: { type: "ops_alert", workOrderNumber: row.workOrderNumber },
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.content).toContain("24");
  });

  it("未到 nextAttemptAt 的行不投递", async () => {
    const row = await createDelivery({ nextAttemptAt: new Date(NOW.getTime() + 60 * 60_000) });
    const { fetchImpl, calls } = stubFetch(okPlatform);

    await tickWith(fetchImpl);

    expect(calls).toHaveLength(0);
    const after = await prisma.callbackDelivery.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe("pending");
    expect(after.attempts).toBe(0);
  });

  it("重启续投：失败遗留的 pending 行到期即被拾取", async () => {
    const row = await createDelivery({
      attempts: 2,
      firstAttemptAt: new Date(NOW.getTime() - 40 * 60_000),
      nextAttemptAt: new Date(NOW.getTime() - 60_000),
    });
    const { fetchImpl, calls } = stubFetch(okPlatform);

    await tickWith(fetchImpl);

    expect(calls).toHaveLength(1);
    const after = await prisma.callbackDelivery.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe("delivered");
    expect(after.attempts).toBe(3);
  });

  it("JB_INSURANCE_CALLBACK_URL/SECRET 缺省 → 空转不报错，行原样保留", async () => {
    const row = await createDelivery();
    const { fetchImpl, calls } = stubFetch(okPlatform);

    const summary = await tickCallbackDeliveries({
      prisma,
      clock: fixedClock(NOW),
      config: {},
      fetch: fetchImpl,
    });

    expect(summary.disabled).toBe(true);
    expect(calls).toHaveLength(0);
    const after = await prisma.callbackDelivery.findUniqueOrThrow({ where: { id: row.id } });
    expect(after).toMatchObject({ status: "pending", attempts: 0 });
  });

  it("一次 tick 串行处理全部到期行", async () => {
    const a = await createDelivery();
    const b = await createDelivery();
    const { fetchImpl, calls } = stubFetch(okPlatform);

    const summary = await tickWith(fetchImpl);

    expect(calls).toHaveLength(2);
    expect(summary.delivered).toBe(2);
    for (const id of [a.id, b.id]) {
      const after = await prisma.callbackDelivery.findUniqueOrThrow({ where: { id } });
      expect(after.status).toBe("delivered");
    }
  });

  it("worker 串行防重入：前一次 tick 未结束时 tickNow 归并在途那一轮", async () => {
    const row = await createDelivery();
    let entered!: () => void;
    const enteredGate = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let concurrentCalls = 0;
    let maxConcurrent = 0;
    const fetchImpl: CallbackFetch = async () => {
      concurrentCalls += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrentCalls);
      entered();
      await gate;
      concurrentCalls -= 1;
      return { status: 200, text: async () => okPlatform.body };
    };

    const worker = startCallbackDeliveryWorker({
      prisma,
      clock: fixedClock(NOW),
      config: { callbackUrl: CALLBACK_URL, callbackSecret: SECRET },
      fetch: fetchImpl,
      intervalMs: 3_600_000,
    });
    try {
      const first = worker.tickNow();
      await enteredGate;
      expect(worker.tickNow()).toBe(first);
      expect(maxConcurrent).toBe(1);
      release();
      await first;
    } finally {
      worker.stop();
    }

    const after = await prisma.callbackDelivery.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe("delivered");
  });
});
