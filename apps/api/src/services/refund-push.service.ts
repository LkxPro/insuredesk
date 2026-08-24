import {
  computePushedFields,
  REFUND_PUSH_PLATFORM,
  TicketKindKey,
  TicketStatus,
  type WorkOrderPushInput,
} from "@insuredesk/shared";
import { Prisma } from "../generated/prisma/client.ts";
import { writeBulkNotifications, writeOpsAlertNotifications } from "./notification.service.ts";
import { stampFromPolicy, type TicketServiceDeps } from "./ticket.service.ts";
import { requireTicketKindId } from "./ticket-kind.service.ts";

/** 报错只点名字段、不回显推送值（PII）。 */
export class RefundPushValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RefundPushValidationError";
  }
}

export class RefundPushNoActivePolicyError extends Error {
  constructor() {
    super("退费异常时效策略未配置");
    this.name = "RefundPushNoActivePolicyError";
  }
}

/** 未来时间容忍：平台与己方机器时钟偏差 5 分钟内照收。 */
const FUTURE_TOLERANCE_MS = 5 * 60_000;

/**
 * 平台时间口径 `YYYY-MM-DD HH:mm:ss` @ Asia/Shanghai 不带时区偏移；
 * 上海固定 +08:00（1991 年后无 DST），直接拼偏移解析。
 * 回程校验不可少：V8 对越界分量做归一（02-30 → 03-02）而非 Invalid Date。
 */
export function parseRefundCreateTime(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!m) {
    return null;
  }
  const [, y, mo, d, h, mi, s] = m;
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}+08:00`);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const wallClock = new Date(date.getTime() + 8 * 3600_000).toISOString();
  return wallClock.startsWith(`${y}-${mo}-${d}T${h}:${mi}:${s}`) ? date : null;
}

/** 不跑工单查重：推送单命中存量投诉单属正常。 */
export async function pushRefundWorkOrder(
  { prisma, clock }: TicketServiceDeps,
  input: WorkOrderPushInput,
): Promise<{ workOrderNumber: string }> {
  const now = clock.now();
  const anchor = parseRefundCreateTime(input.refundCreateTime);
  if (anchor === null) {
    throw new RefundPushValidationError("refundCreateTime 格式不正确");
  }
  if (anchor.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) {
    throw new RefundPushValidationError("refundCreateTime 不能晚于当前时间");
  }

  const idemKey = { platform: REFUND_PUSH_PLATFORM, endorNo: input.endorNo };

  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.ticketRefundDetail.findUnique({
        where: { platform_endorNo: idemKey },
        select: { ticket: { select: { workOrderNumber: true } } },
      });
      if (existing) {
        return { workOrderNumber: existing.ticket.workOrderNumber };
      }

      const kindId = await requireTicketKindId(tx, TicketKindKey.RefundException);
      const policy = await tx.slaPolicy.findFirst({
        where: { kindId, active: true },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      });
      if (!policy) {
        throw new RefundPushNoActivePolicyError();
      }

      const ticket = await tx.ticket.create({
        data: {
          source: REFUND_PUSH_PLATFORM,
          kindId,
          createdAt: now,
          slaAnchorAt: anchor,
          status: TicketStatus.Unassigned,
          customerName: input.holderName ?? null,
          phone: input.holderPhone ?? null,
          policyNumbers: input.policyNo ? [input.policyNo] : [],
          internalOrderNumber: input.sysOrderId,
          ...stampFromPolicy(policy, anchor),
        },
      });

      await tx.ticketRefundDetail.create({
        data: {
          ticketId: ticket.id,
          platform: REFUND_PUSH_PLATFORM,
          endorNo: input.endorNo,
          sysOrderId: input.sysOrderId,
          workOrderType: input.workOrderType,
          expectedAmount: input.expectedAmount,
          refundCreateTime: anchor,
          refundTrades: input.refundTrade,
          holderName: input.holderName ?? null,
          holderPhone: input.holderPhone ?? null,
          companyName: input.companyName ?? null,
          productId: input.productId ?? null,
          productName: input.productName ?? null,
          policyNo: input.policyNo ?? null,
          failureReason: input.failureReason ?? null,
          pushedFields: computePushedFields(input),
        },
      });

      await tx.processLog.create({
        data: {
          ticketId: ticket.id,
          operatorId: REFUND_PUSH_PLATFORM,
          operatorName: "骏伯保险平台",
          action: "create",
          remark: "推送创建",
          at: now,
        },
      });

      const assignableUsers = await tx.user.findMany({
        where: { active: true, role: { permissions: { has: "ticket.assign" } } },
        select: { id: true },
      });
      await writeBulkNotifications(tx, {
        type: "refund_pushed",
        title: "退费异常工单推送",
        content: `骏伯保险平台推送了退费异常工单 ${ticket.workOrderNumber}`,
        ticketId: ticket.id,
        workOrderNumber: ticket.workOrderNumber,
        targetUserIds: assignableUsers.map((user) => user.id),
        now,
      });

      return { workOrderNumber: ticket.workOrderNumber };
    });
  } catch (error) {
    // 事务内可能撞的唯一约束只有幂等键（workOrderNumber 走序列、cuid 不自撞）
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.ticketRefundDetail.findUnique({
        where: { platform_endorNo: idemKey },
        select: { ticket: { select: { workOrderNumber: true } } },
      });
      if (existing) {
        return { workOrderNumber: existing.ticket.workOrderNumber };
      }
    }
    // 建单事务已回滚，告警须另起事务落库
    if (error instanceof RefundPushNoActivePolicyError) {
      await prisma.$transaction((tx) =>
        writeOpsAlertNotifications(tx, {
          title: "退费异常工单推送失败",
          content: `退费异常组无生效的时效策略，骏伯保险平台推送（endorNo: ${input.endorNo}）未能建单`,
          now,
        }),
      );
    }
    throw error;
  }
}
