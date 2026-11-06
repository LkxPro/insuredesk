import { createHash } from "node:crypto";
import { HUIFU_WEBHOOK_PATH } from "@insuredesk/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fixedClock } from "../src/clock.ts";
import { parseEnv } from "../src/env.ts";
import { buildServer } from "../src/server.ts";
import { tickHuifuWebhooks } from "../src/services/huifu-webhook.service.ts";
import {
  createComplaintTicket,
  type IntegrationHarness,
  startIntegrationHarness,
} from "./integration-harness.ts";

const SECRET = "0123456789abcdef0123456789abcdef";
const MERCHANT = "6666000155322319";
const NOW = new Date(Date.now() + 60_000);

function wechat(overrides: Record<string, unknown> = {}) {
  return {
    namespace: "opps-webhook",
    event_define_no: "wechat.complaint",
    complaint_id: "wx-1",
    mer_id: MERCHANT,
    complaint_datetime: "2026-10-29 15:30:00",
    wechat_order_no: "wx-order-1",
    mer_name: "测试商户",
    trade_amount: 15,
    ...overrides,
  };
}

function hotline(overrides: Record<string, unknown> = {}) {
  return {
    namespace: "opps-webhook",
    event_define_no: "hotline.complaint",
    ticketId: "400-1",
    merchantNo: MERCHANT,
    complaintTime: "2026-10-29 15:30:00",
    operationTime: "2026-10-29 15:31:00",
    event: "1",
    content: "客户申请退款",
    userName: "测试客户",
    userPhoneNumber: "187****8047",
    attachmentList: "[]",
    ...overrides,
  };
}

function sign(body: string) {
  return createHash("md5")
    .update(body + SECRET)
    .digest("hex")
    .toUpperCase();
}

describe("汇付 Webhook 接收及建单", () => {
  let harness: IntegrationHarness;
  let app: FastifyInstance;
  let disabled: FastifyInstance;

  function send(payload: unknown, signature?: string) {
    const body = typeof payload === "string" ? payload : JSON.stringify(payload);
    return app.inject({
      method: "POST",
      url: HUIFU_WEBHOOK_PATH,
      headers: { "content-type": "application/json", sign: signature ?? sign(body) },
      payload: body,
    });
  }

  function tick(slaPolicyId?: string, now = NOW) {
    return tickHuifuWebhooks({ prisma: harness.prisma, clock: fixedClock(now), slaPolicyId });
  }

  beforeAll(async () => {
    harness = await startIntegrationHarness({ seed: ["rolesAndUsers", "slaPolicies", "channels"] });
    const base = {
      DATABASE_URL: harness.databaseUrl,
      SESSION_SECRET: "huifu-webhook-test-secret-0123456789abcdef",
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
    };
    app = buildServer(
      parseEnv({ ...base, HUIFU_WEBHOOK_SECRET: SECRET, HUIFU_WEBHOOK_MERCHANT_IDS: MERCHANT }),
    );
    disabled = buildServer(parseEnv(base));
    await Promise.all([app.ready(), disabled.ready()]);
  });

  beforeEach(async () => {
    await harness.prisma.$transaction([
      harness.prisma.huifuWebhookEvent.deleteMany(),
      harness.prisma.huifuComplaint.deleteMany(),
      harness.prisma.appNotification.deleteMany(),
      harness.prisma.processLog.deleteMany(),
      harness.prisma.ticketComplaintDetail.deleteMany(),
      harness.prisma.ticket.deleteMany(),
    ]);
  });

  afterAll(async () => {
    await Promise.all([app?.close(), disabled?.close()]);
    await harness?.stop();
  });

  it("原文先保存后应答；worker 才创建摘要工单和通知", async () => {
    const response = await send(wechat());
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("success");
    expect(await harness.prisma.ticket.count()).toBe(0);
    expect(await harness.prisma.huifuWebhookEvent.count({ where: { status: "pending" } })).toBe(1);

    expect(await tick()).toEqual({ processed: 1, retried: 0 });
    const ticket = await harness.prisma.ticket.findFirstOrThrow({
      include: { complaintDetail: true, kind: true, processLogs: true },
    });
    expect(ticket.source).toBe("huifu");
    expect(ticket.kind.key).toBe("complaint");
    expect(ticket.status).toBe("unassigned");
    expect(ticket.slaPolicyId).toBeNull();
    expect(ticket.complaintDetail?.feedbackTime?.toISOString()).toBe("2026-10-29T07:30:00.000Z");
    expect(ticket.complaintDetail?.customerRequest).toContain("wx-order-1");
    expect(ticket.processLogs.map((log) => log.action)).toEqual(["create"]);
    expect(
      await harness.prisma.appNotification.count({ where: { ticketId: ticket.id } }),
    ).toBeGreaterThan(0);
    const viewer = harness.callerFor(harness.seeded.users.admin, harness.seeded.roles.admin);
    const list = await viewer.ticket.list({});
    expect(list.items.some((item) => item.id === ticket.id)).toBe(true);
  });

  it("无密钥返回 503；错签名、商户越权和畸形事件不入库", async () => {
    expect(
      (await disabled.inject({ method: "POST", url: HUIFU_WEBHOOK_PATH, payload: wechat() }))
        .statusCode,
    ).toBe(503);
    expect((await send(wechat(), "0".repeat(32))).statusCode).toBe(401);
    expect((await send(wechat({ mer_id: "another-merchant" }))).statusCode).toBe(403);
    expect((await send(wechat({ complaint_id: "" }))).statusCode).toBe(400);
    expect((await send(wechat({ complaint_datetime: "2026-02-30 12:00:00" }))).statusCode).toBe(
      400,
    );
    expect((await send("{broken")).statusCode).toBe(400);
    const unsigned = await app.inject({
      method: "POST",
      url: HUIFU_WEBHOOK_PATH,
      payload: wechat(),
    });
    expect(unsigned.statusCode).toBe(401);
    expect(await harness.prisma.huifuWebhookEvent.count()).toBe(0);
  });

  it("无签名空对象端点校验只应答，不保存事件或创建工单", async () => {
    for (const payload of ["{}", " \r\n{ \t}\n"]) {
      const response = await app.inject({
        method: "POST",
        url: HUIFU_WEBHOOK_PATH,
        headers: { "content-type": "application/json" },
        payload,
      });
      expect(response.statusCode).toBe(200);
      expect(response.body).toBe("success");
      expect(response.headers["content-type"]).toContain("text/plain");
    }
    expect(await harness.prisma.huifuWebhookEvent.count()).toBe(0);
    expect(await harness.prisma.ticket.count()).toBe(0);
    expect(
      (
        await disabled.inject({
          method: "POST",
          url: HUIFU_WEBHOOK_PATH,
          headers: { "content-type": "application/json" },
          payload: "{}",
        })
      ).statusCode,
    ).toBe(503);
  });

  it("探测兼容不放行非空报文或带错误签名的空对象", async () => {
    for (const payload of ["[]", "null", '""', '{"test":true}', "{}invalid", "\u00a0{}"]) {
      const response = await app.inject({
        method: "POST",
        url: HUIFU_WEBHOOK_PATH,
        headers: { "content-type": "application/json" },
        payload,
      });
      expect(response.statusCode).toBe(401);
    }
    for (const signature of ["", "0".repeat(32)]) {
      const response = await app.inject({
        method: "POST",
        url: HUIFU_WEBHOOK_PATH,
        headers: { "content-type": "application/json", sign: signature },
        payload: "{}",
      });
      expect(response.statusCode).toBe(401);
      const queryResponse = await app.inject({
        method: "POST",
        url: `${HUIFU_WEBHOOK_PATH}?sign=${signature}`,
        headers: { "content-type": "application/json" },
        payload: "{}",
      });
      expect(queryResponse.statusCode).toBe(401);
    }
    expect(await harness.prisma.huifuWebhookEvent.count()).toBe(0);
    expect(await harness.prisma.ticket.count()).toBe(0);
  });

  it("400 投诉按商户映射业务信息，后续事件不覆盖客服修改", async () => {
    await send(hotline({ merchantName: "陕西凯森保险代理有限公司", complaintSource: "04" }));
    expect(await tick()).toEqual({ processed: 1, retried: 0 });
    const detail = await harness.prisma.ticketComplaintDetail.findFirstOrThrow({
      include: { channel: true, feedbackReceiveChannel: true, userFeedbackChannel: true },
    });
    expect(detail.channel?.name).toBe("支付");
    expect(detail.brokerageEntity).toBe("凯森");
    expect(detail.paymentChannel).toBe("汇付");
    expect(detail.feedbackReceiveChannel?.name).toBe("汇付400工单投诉");
    expect(detail.userFeedbackChannel?.name).toBe("黑猫");
    const manualChannel = await harness.prisma.userFeedbackChannel.findUniqueOrThrow({
      where: { name: "政府转办" },
    });
    await harness.prisma.ticketComplaintDetail.update({
      where: { ticketId: detail.ticketId },
      data: {
        brokerageEntity: "人工核实主体",
        paymentChannel: "人工核实渠道",
        userFeedbackChannelId: manualChannel.id,
      },
    });
    await send(
      hotline({ merchantName: "东方大地保险经纪有限公司", event: "3", complaintSource: "05" }),
    );
    expect(await tick()).toEqual({ processed: 1, retried: 0 });
    expect(
      await harness.prisma.ticketComplaintDetail.findUniqueOrThrow({
        where: { ticketId: detail.ticketId },
      }),
    ).toMatchObject({
      brokerageEntity: "人工核实主体",
      paymentChannel: "人工核实渠道",
      userFeedbackChannelId: manualChannel.id,
    });
  });

  it.each([
    ["01", "支付400热线"],
    ["05", "人行专线"],
    ["13", "人行消保"],
    ["14", "人行信访"],
    ["18", "消费保"],
  ])("来源 %s 写入用户反馈渠道 %s", async (code, name) => {
    expect((await send(hotline({ complaintSource: code }))).statusCode).toBe(200);
    expect(await tick()).toEqual({ processed: 1, retried: 0 });
    const detail = await harness.prisma.ticketComplaintDetail.findFirstOrThrow({
      include: { userFeedbackChannel: true },
    });
    expect(detail.userFeedbackChannel?.name).toBe(name);
  });

  it.each([undefined, "10", "99"])("缺省或未知来源 %s 仍接单，原码保留", async (code) => {
    expect((await send(hotline({ complaintSource: code }))).statusCode).toBe(200);
    expect(await tick()).toEqual({ processed: 1, retried: 0 });
    const detail = await harness.prisma.ticketComplaintDetail.findFirstOrThrow();
    expect(detail.userFeedbackChannelId).toBeNull();
    const event = await harness.prisma.huifuWebhookEvent.findFirstOrThrow();
    expect(JSON.parse(event.rawBody).complaintSource).toBe(code);
  });

  it("已知来源渠道停用时不强行启用或写入，保留事件重试", async () => {
    const channel = await harness.prisma.userFeedbackChannel.findUniqueOrThrow({
      where: { name: "黑猫" },
    });
    await harness.prisma.userFeedbackChannel.update({
      where: { id: channel.id },
      data: { active: false },
    });
    try {
      await send(hotline({ complaintSource: "04" }));
      expect(await tick()).toEqual({ processed: 0, retried: 1 });
      expect(await harness.prisma.ticket.count()).toBe(0);
    } finally {
      await harness.prisma.userFeedbackChannel.update({
        where: { id: channel.id },
        data: { active: true },
      });
    }
  });

  it("400 接收渠道停用时保留消息重试，不绕过目录约束", async () => {
    const channel = await harness.prisma.feedbackReceiveChannel.findUniqueOrThrow({
      where: { name: "汇付400工单投诉" },
    });
    await harness.prisma.feedbackReceiveChannel.update({
      where: { id: channel.id },
      data: { active: false },
    });
    try {
      await send(hotline());
      expect(await tick()).toEqual({ processed: 0, retried: 1 });
      expect(await harness.prisma.ticket.count()).toBe(0);
    } finally {
      await harness.prisma.feedbackReceiveChannel.update({
        where: { id: channel.id },
        data: { active: true },
      });
    }
  });

  it("配置 SLA 时从接收时间盖章，不从后台处理时间重新计时", async () => {
    await send(wechat());
    const row = await harness.prisma.huifuWebhookEvent.findFirstOrThrow();
    const policy = await harness.prisma.slaPolicy.findFirstOrThrow({
      where: { kind: { key: "complaint" }, active: true, overdueHours: { not: null } },
    });
    await tick(policy.id, new Date(NOW.getTime() + 3_600_000));
    const ticket = await harness.prisma.ticket.findFirstOrThrow();
    expect(ticket.slaPolicyId).toBe(policy.id);
    expect(ticket.slaAnchorAt).toEqual(row.receivedAt);
    expect(ticket.dueAt?.getTime()).toBe(
      row.receivedAt.getTime() + (policy.overdueHours ?? 0) * 3_600_000,
    );
  });

  it("支持 URL sign；与报文头冲突时拒收，JSON 解析器不影响其他路由", async () => {
    const body = JSON.stringify(wechat());
    const response = await app.inject({
      method: "POST",
      url: `${HUIFU_WEBHOOK_PATH}?sign=${sign(body)}`,
      headers: { "content-type": "application/json" },
      payload: body,
    });
    expect(response.statusCode).toBe(200);
    const conflicting = await app.inject({
      method: "POST",
      url: `${HUIFU_WEBHOOK_PATH}?sign=${sign(body)}`,
      headers: { "content-type": "application/json", sign: "0".repeat(32) },
      payload: body,
    });
    expect(conflicting.statusCode).toBe(401);
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: {} });
    expect(login.statusCode).toBe(400);
  });

  it("附件数组通过原文验签并保存，等价字符串重推不重复建单", async () => {
    const attachments = ["https://example.com/complaint.png"];
    const payload = hotline({ attachmentList: attachments, merchantName: "中融保险经纪有限公司" });
    const response = await send(payload);
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("success");
    const row = await harness.prisma.huifuWebhookEvent.findFirstOrThrow();
    expect(JSON.parse(row.rawBody).attachmentList).toEqual(attachments);
    expect(await tick()).toEqual({ processed: 1, retried: 0 });
    const detail = await harness.prisma.ticketComplaintDetail.findFirstOrThrow();
    expect(detail.brokerageEntity).toBe("中融");
    expect(detail.customerRequest).toContain(JSON.stringify(attachments));
    expect(
      (await send({ ...payload, attachmentList: JSON.stringify(attachments) })).statusCode,
    ).toBe(200);
    expect(await harness.prisma.huifuWebhookEvent.count()).toBe(1);
    expect(await harness.prisma.ticket.count()).toBe(1);
  });

  it("保存失败不应答 success", async () => {
    const spy = vi
      .spyOn(harness.prisma.huifuWebhookEvent, "upsert")
      .mockRejectedValueOnce(new Error("DB down"));
    try {
      const response = await send(wechat());
      expect(response.statusCode).toBe(503);
      expect(response.body).not.toBe("success");
    } finally {
      spy.mockRestore();
    }
    expect(await harness.prisma.huifuWebhookEvent.count()).toBe(0);
  });

  it("重复和重排报文仅保存一次；并发 worker 不重复建单", async () => {
    const payload = wechat();
    await Promise.all([
      send(payload),
      send(payload),
      send(Object.fromEntries(Object.entries(payload).reverse())),
    ]);
    expect(await harness.prisma.huifuWebhookEvent.count()).toBe(1);
    await Promise.all([tick(), tick()]);
    expect(await harness.prisma.ticket.count()).toBe(1);
    expect(await harness.prisma.processLog.count()).toBe(1);
    await send(payload);
    await tick();
    expect(await harness.prisma.processLog.count()).toBe(1);
  });

  it("400 催办追加外部事件，不改客服字段、不计跟进或自动完结", async () => {
    await send(hotline());
    await tick();
    const ticket = await harness.prisma.ticket.findFirstOrThrow({
      include: { complaintDetail: true },
    });
    expect(ticket.contactPhone).toBeNull();
    expect(ticket.complaintDetail?.customerName).toBe("测试客户");
    await harness.prisma.ticket.update({
      where: { id: ticket.id },
      data: { status: "completed", contactCount: 2 },
    });
    await harness.prisma.ticketComplaintDetail.update({
      where: { ticketId: ticket.id },
      data: { customerRequest: "客服已补充" },
    });
    await send(hotline({ event: "2", operationTime: "2026-10-29 15:40:00", content: "客户催办" }));
    await tick();
    const after = await harness.prisma.ticket.findUniqueOrThrow({
      where: { id: ticket.id },
      include: { complaintDetail: true, processLogs: true },
    });
    expect(await harness.prisma.ticket.count()).toBe(1);
    expect(after.status).toBe("completed");
    expect(after.contactCount).toBe(2);
    expect(after.complaintDetail?.customerRequest).toBe("客服已补充");
    expect(after.processLogs.filter((log) => log.action === "external_note")).toHaveLength(1);
    expect(after.processLogs.find((log) => log.action === "external_note")?.remark).toContain(
      "客户催办",
    );
  });

  it("同一投诉的不同事件并发消费只建一张工单；两种投诉 ID 不串单", async () => {
    await Promise.all([
      send(hotline({ event: "1" })),
      send(hotline({ event: "2", operationTime: "2026-10-29 15:41:00" })),
      send(wechat({ complaint_id: "400-1" })),
    ]);
    await Promise.all([tick(), tick()]);
    expect(await harness.prisma.ticket.count()).toBe(2);
    expect(await harness.prisma.huifuComplaint.count()).toBe(2);
    expect(await harness.prisma.processLog.count()).toBe(3);
  });

  it("建单回滚后仍有接收记录，退避后可恢复，且不受手工工单查重阻挡", async () => {
    await createComplaintTicket(harness.prisma, { contactPhone: "13800000001" });
    await send(hotline({ userPhoneNumber: "13800000001" }));
    expect(await tick("missing-policy")).toEqual({ processed: 0, retried: 1 });
    expect(await harness.prisma.huifuComplaint.count()).toBe(0);
    expect(await harness.prisma.ticket.count()).toBe(1);
    const pending = await harness.prisma.huifuWebhookEvent.findFirstOrThrow();
    expect(pending.attempts).toBe(1);
    expect(pending.status).toBe("pending");
    expect(await tick()).toEqual({ processed: 0, retried: 0 });
    expect(await tick(undefined, new Date(NOW.getTime() + 301_000))).toEqual({
      processed: 1,
      retried: 0,
    });
    expect(await harness.prisma.ticket.count()).toBe(2);
  });

  it("软删除后新事件不重建、不追加通知；未知签名事件只应答", async () => {
    await send(wechat());
    await tick();
    const ticket = await harness.prisma.ticket.findFirstOrThrow();
    await harness.prisma.ticket.update({ where: { id: ticket.id }, data: { deletedAt: NOW } });
    const notifications = await harness.prisma.appNotification.count();
    await send(wechat({ trade_amount: 16 }));
    await tick();
    expect(await harness.prisma.ticket.count()).toBe(1);
    expect(await harness.prisma.processLog.count()).toBe(1);
    expect(await harness.prisma.appNotification.count()).toBe(notifications);
    const probe = await send({ namespace: "opps-webhook", event_define_no: "test" });
    expect(probe.statusCode).toBe(200);
    expect(await harness.prisma.huifuWebhookEvent.count()).toBe(2);
  });
});
