import { createHash, timingSafeEqual } from "node:crypto";
import {
  HUIFU_SOURCE,
  type HuifuWebhookEvent,
  huifuWebhookEventSchema,
  TicketKindKey,
} from "@insuredesk/shared";
import type { Prisma } from "../generated/prisma/client.ts";
import { writeBulkNotifications } from "./notification.service.ts";
import { computeSlaStamp, type TicketServiceDeps } from "./ticket.service.ts";
import { requireTicketKindId } from "./ticket-kind.service.ts";

export class HuifuWebhookError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "HuifuWebhookError";
    this.statusCode = statusCode;
  }
}

// 汇付 Webhook Demo 约定 MD5(raw body + 终端密钥)，不能重排或重新序列化报文。
export function verifyHuifuSignature(
  body: string,
  sign: string | undefined,
  secret: string,
): boolean {
  if (!sign || !/^[a-fA-F0-9]{32}$/.test(sign)) return false;
  const expected = createHash("md5").update(body, "utf8").update(secret, "utf8").digest();
  return timingSafeEqual(expected, Buffer.from(sign, "hex"));
}

function identity(event: HuifuWebhookEvent) {
  return event.event_define_no === "wechat.complaint"
    ? {
        eventType: event.event_define_no,
        merchantId: event.mer_id,
        complaintId: event.complaint_id,
      }
    : {
        eventType: event.event_define_no,
        merchantId: event.merchantNo,
        complaintId: event.ticketId,
      };
}

export async function receiveHuifuWebhook(
  deps: TicketServiceDeps,
  input: { rawBody: string; sign?: string; secret: string; merchantIds: readonly string[] },
) {
  if (!verifyHuifuSignature(input.rawBody, input.sign, input.secret)) {
    throw new HuifuWebhookError(401, "invalid signature");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(input.rawBody);
  } catch {
    throw new HuifuWebhookError(400, "invalid JSON");
  }
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("namespace" in payload) ||
    payload.namespace !== "opps-webhook" ||
    !("event_define_no" in payload) ||
    typeof payload.event_define_no !== "string"
  ) {
    throw new HuifuWebhookError(400, "invalid event envelope");
  }
  if (!["wechat.complaint", "hotline.complaint"].includes(payload.event_define_no)) {
    return { accepted: false };
  }
  const parsed = huifuWebhookEventSchema.safeParse(payload);
  if (!parsed.success) throw new HuifuWebhookError(400, "invalid complaint event");
  const event = parsed.data;
  const key = identity(event);
  if (!input.merchantIds.includes(key.merchantId)) {
    throw new HuifuWebhookError(403, "merchant not allowed");
  }
  const digest = createHash("sha256").update(JSON.stringify(event)).digest("hex");
  const now = deps.clock.now();
  await deps.prisma.huifuWebhookEvent.upsert({
    where: { digest },
    create: { digest, ...key, rawBody: input.rawBody, receivedAt: now, nextAttemptAt: now },
    update: {},
  });
  return { accepted: true };
}

function shanghaiDate(value: string): Date {
  return new Date(`${value.replace(" ", "T")}+08:00`);
}

function describe(event: HuifuWebhookEvent) {
  if (event.event_define_no === "wechat.complaint") {
    return {
      label: "微信投诉",
      feedbackTime: shanghaiDate(event.complaint_datetime),
      customerName: null,
      contactPhone: null,
      text: [
        "汇付微信投诉，待补充投诉详情",
        `投诉单号：${event.complaint_id}`,
        `商户：${event.mer_name ?? event.mer_id}`,
        `微信订单号：${event.wechat_order_no ?? "未提供"}`,
        `投诉时间：${event.complaint_datetime}`,
        `订单金额（汇付原值）：${event.trade_amount ?? "未提供"}`,
      ].join("\n"),
    };
  }
  return {
    label: "400 消费者投诉",
    feedbackTime: shanghaiDate(event.complaintTime),
    customerName: event.userName?.trim() || null,
    // 投诉人不一定是投保人；脱敏号码只作原文展示，不盖进电话字段。
    contactPhone:
      event.userPhoneNumber && /^\+?\d[\d -]{5,24}$/.test(event.userPhoneNumber)
        ? event.userPhoneNumber
        : null,
    text: [
      event.content || "汇付 400 消费者投诉",
      `投诉单号：${event.ticketId}`,
      `商户：${event.merchantName ?? event.merchantNo}`,
      `交易号：${event.transactionNo ?? "未提供"}`,
      `外部交易号：${event.externalTransactionNo ?? "未提供"}`,
      `投诉时间：${event.complaintTime}`,
      `事件：${event.event ?? "未提供"}`,
      `操作时间：${event.operationTime ?? event.complaintTime}`,
      `投诉人电话（汇付原值）：${event.userPhoneNumber ?? "未提供"}`,
      ...(event.remark ? [`备注：${event.remark}`] : []),
      ...(event.attachmentList ? [`附件（汇付原值）：${event.attachmentList}`] : []),
    ].join("\n"),
  };
}

async function notify(
  tx: Prisma.TransactionClient,
  ticket: { id: string; workOrderNumber: string; assigneeId: string | null },
  title: string,
  now: Date,
) {
  const users = ticket.assigneeId
    ? [{ id: ticket.assigneeId }]
    : await tx.user.findMany({
        where: {
          active: true,
          role: { OR: [{ system: true }, { permissions: { has: "ticket.assign" } }] },
        },
        select: { id: true },
      });
  await writeBulkNotifications(tx, {
    type: "external_note",
    title,
    content: `${title} ${ticket.workOrderNumber}`,
    ticketId: ticket.id,
    workOrderNumber: ticket.workOrderNumber,
    targetUserIds: users.map((user) => user.id),
    now,
  });
}

async function processEvent(deps: TicketServiceDeps, id: string, slaPolicyId?: string) {
  const now = deps.clock.now();
  return deps.prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM huifu_webhook_events WHERE id = ${id} FOR UPDATE`;
    const row = await tx.huifuWebhookEvent.findUniqueOrThrow({ where: { id } });
    if (row.status !== "pending" || row.nextAttemptAt > now) return false;
    const event = huifuWebhookEventSchema.parse(JSON.parse(row.rawBody));
    const key = identity(event);
    // 同一投诉的不同事件可能由不同进程同时消费，创建映射前先串行化。
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${JSON.stringify(key)}))`;
    const existing = await tx.huifuComplaint.findUnique({
      where: { eventType_merchantId_complaintId: key },
      include: { ticket: true },
    });
    const detail = describe(event);
    if (existing?.ticket.deletedAt) {
      await tx.huifuWebhookEvent.update({
        where: { id },
        data: { status: "ignored", processedAt: now, lastError: null },
      });
      return true;
    }
    let ticket = existing?.ticket;
    if (!ticket) {
      const kindId = await requireTicketKindId(tx, TicketKindKey.Complaint);
      const slaStamp = await computeSlaStamp(tx, slaPolicyId ?? null, row.receivedAt, kindId);
      ticket = await tx.ticket.create({
        data: {
          source: HUIFU_SOURCE,
          kindId,
          createdAt: row.receivedAt,
          slaAnchorAt: row.receivedAt,
          contactPhone: detail.contactPhone,
          ...slaStamp,
          complaintDetail: {
            create: {
              feedbackTime: detail.feedbackTime,
              customerName: detail.customerName,
              customerRequest: detail.text.slice(0, 2000),
            },
          },
        },
      });
      await tx.huifuComplaint.create({ data: { ...key, ticketId: ticket.id } });
    } else {
      await tx.ticket.update({ where: { id: ticket.id }, data: { updatedAt: now } });
    }
    await tx.processLog.create({
      data: {
        ticketId: ticket.id,
        operatorId: HUIFU_SOURCE,
        operatorName: "汇付",
        action: existing ? "external_note" : "create",
        remark: detail.text,
        at: now,
      },
    });
    await notify(tx, ticket, `汇付${detail.label}${existing ? "更新" : "入单"}`, now);
    await tx.huifuWebhookEvent.update({
      where: { id },
      data: { status: "processed", processedAt: now, lastError: null },
    });
    return true;
  });
}

export async function tickHuifuWebhooks(deps: TicketServiceDeps & { slaPolicyId?: string }) {
  const rows = await deps.prisma.huifuWebhookEvent.findMany({
    where: { status: "pending", nextAttemptAt: { lte: deps.clock.now() } },
    orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
    take: 50,
    select: { id: true, attempts: true },
  });
  const summary = { processed: 0, retried: 0 };
  for (const row of rows) {
    try {
      if (await processEvent(deps, row.id, deps.slaPolicyId)) summary.processed++;
    } catch {
      const delay = Math.min(300_000 * 2 ** Math.min(row.attempts, 10), 6 * 3_600_000);
      const result = await deps.prisma.huifuWebhookEvent.updateMany({
        where: { id: row.id, status: "pending", attempts: row.attempts },
        data: {
          attempts: { increment: 1 },
          nextAttemptAt: new Date(deps.clock.now().getTime() + delay),
          lastError: "建单失败；检查投诉种类、时效策略和数据库连接后等待重试",
        },
      });
      summary.retried += result.count;
    }
  }
  return summary;
}
