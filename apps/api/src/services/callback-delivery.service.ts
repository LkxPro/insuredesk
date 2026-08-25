import { callbackPlaintextSchema } from "@insuredesk/shared";
import type { Clock } from "../clock.ts";
import type { CallbackDelivery, Prisma, PrismaClient } from "../generated/prisma/client.ts";
import { writeOpsAlertNotifications } from "./notification.service.ts";
import { encryptRefundCallback } from "./refund-callback-crypto.ts";

// 平台契约：channel 固定为 WORK-ORDER。
const REQUEST_TIMEOUT_MS = 10_000;
const CALLBACK_CHANNEL = "WORK-ORDER";
const BACKOFF_MS = [5 * 60_000, 30 * 60_000, 2 * 60 * 60_000] as const;
const DEAD_AFTER_MS = 24 * 60 * 60_000;

export type CallbackFetch = (
  url: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  },
) => Promise<{ status: number; text(): Promise<string> }>;

export interface CallbackDeliveryConfig {
  callbackUrl?: string | undefined;
  callbackSecret?: string | undefined;
}

export interface CallbackDeliveryDeps {
  prisma: PrismaClient;
  clock: Clock;
  config: CallbackDeliveryConfig;
  fetch?: CallbackFetch;
}

export interface TickSummary {
  disabled: boolean;
  attempted: number;
  delivered: number;
  retried: number;
  dead: number;
}

function buildPayload(row: CallbackDelivery) {
  const payload = callbackPlaintextSchema.parse({
    sysOrderId: row.sysOrderId,
    endorNo: row.endorNo,
    actualAmount: row.actualAmount,
    workOrderNumber: row.workOrderNumber,
    ...(row.compensationAmount !== null ? { compensationAmount: row.compensationAmount } : {}),
    ...(row.remark !== null ? { remark: row.remark } : {}),
    ...(row.operator !== null ? { operator: row.operator } : {}),
  });
  return payload;
}

type Outcome =
  | { kind: "delivered" }
  | { kind: "retry"; error: string }
  | { kind: "dead"; error: string };

/** 平台响应解释：0000+data=true 才算投成；9998 终止；其余（含 0000+data=false）一律可重试。 */
function interpretResponse(parsed: unknown): Outcome {
  const body =
    typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  const code = typeof body.code === "string" ? body.code : "";
  const message = typeof body.message === "string" ? body.message : "";
  if (code === "0000" && body.data === true) {
    return { kind: "delivered" };
  }
  if (code === "9998") {
    return { kind: "dead", error: `平台 9998：${message}` };
  }
  return { kind: "retry", error: `平台 code=${code || "未知"}：${message}` };
}

async function sendOnce(
  fetchImpl: CallbackFetch,
  url: string,
  secret: string,
  row: CallbackDelivery,
): Promise<Outcome> {
  const envelope = JSON.stringify({
    channel: CALLBACK_CHANNEL,
    body: encryptRefundCallback(secret, JSON.stringify(buildPayload(row))),
  });
  let response: { status: number; text(): Promise<string> };
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json;charset=UTF-8" },
      body: envelope,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    return { kind: "retry", error: error instanceof Error ? error.message : String(error) };
  }
  if (response.status !== 200) {
    return { kind: "retry", error: `平台 HTTP ${response.status}` };
  }
  try {
    return interpretResponse(JSON.parse(await response.text()));
  } catch {
    return { kind: "retry", error: "平台响应非 JSON" };
  }
}

async function markDead(
  prisma: PrismaClient,
  row: CallbackDelivery,
  now: Date,
  error: string,
  alertContent: string,
  extra: { attempts: number; firstAttemptAt: Date | null } = {
    attempts: row.attempts,
    firstAttemptAt: row.firstAttemptAt,
  },
) {
  await prisma.$transaction(async (tx) => {
    await tx.callbackDelivery.update({
      where: { id: row.id },
      data: {
        status: "dead",
        attempts: extra.attempts,
        firstAttemptAt: extra.firstAttemptAt,
        nextAttemptAt: null,
        lastError: error,
      },
    });
    await writeOpsAlertNotifications(tx, {
      title: "退费回调投递失败",
      content: alertContent,
      ticketId: row.ticketId,
      workOrderNumber: row.workOrderNumber,
      now,
    });
  });
}

async function deliverOne(
  deps: CallbackDeliveryDeps & { fetch: CallbackFetch; url: string; secret: string },
  row: CallbackDelivery,
) {
  const { prisma, clock, fetch: fetchImpl, url, secret } = deps;
  const now = clock.now();

  if (
    row.firstAttemptAt !== null &&
    now.getTime() - row.firstAttemptAt.getTime() >= DEAD_AFTER_MS
  ) {
    await markDead(
      prisma,
      row,
      now,
      row.lastError ?? "超过 24h 未投递成功",
      `工单 ${row.workOrderNumber} 的退费回调自首试起 24h 内未投递成功，已转死信，请人工排查后重新投递`,
    );
    return "dead" as const;
  }

  const outcome = await sendOnce(fetchImpl, url, secret, row);
  const attempts = row.attempts + 1;
  const firstAttemptAt = row.firstAttemptAt ?? now;

  if (outcome.kind === "delivered") {
    await prisma.callbackDelivery.update({
      where: { id: row.id },
      data: {
        status: "delivered",
        attempts,
        firstAttemptAt,
        deliveredAt: now,
        nextAttemptAt: null,
        lastError: null,
      },
    });
    return "delivered" as const;
  }

  if (outcome.kind === "dead") {
    await markDead(
      prisma,
      row,
      now,
      outcome.error,
      `工单 ${row.workOrderNumber} 的退费回调被平台拒绝（9998，不会重试）：${outcome.error}，请人工排查后重新投递`,
      { attempts, firstAttemptAt },
    );
    return "dead" as const;
  }

  await prisma.callbackDelivery.update({
    where: { id: row.id },
    data: {
      attempts,
      firstAttemptAt,
      nextAttemptAt: new Date(
        now.getTime() + (BACKOFF_MS[(attempts - 1) % BACKOFF_MS.length] ?? BACKOFF_MS[0]),
      ),
      lastError: outcome.error,
    },
  });
  return "retried" as const;
}

/**
 * pending-until-success：投成才落 delivered；崩溃/重启造成的重复投递由平台按
 * endorNo 幂等吸收（at-least-once，合同已约定）。
 */
export async function tickCallbackDeliveries(deps: CallbackDeliveryDeps): Promise<TickSummary> {
  const summary: TickSummary = { disabled: false, attempted: 0, delivered: 0, retried: 0, dead: 0 };
  const { callbackUrl, callbackSecret } = deps.config;
  if (!callbackUrl || !callbackSecret) {
    return { ...summary, disabled: true };
  }
  const fetchImpl = deps.fetch ?? (globalThis.fetch.bind(globalThis) as CallbackFetch);

  const due = await deps.prisma.callbackDelivery.findMany({
    where: {
      status: "pending",
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: deps.clock.now() } }],
    },
    orderBy: { createdAt: "asc" },
  });
  for (const row of due) {
    summary.attempted += 1;
    const result = await deliverOne(
      { ...deps, fetch: fetchImpl, url: callbackUrl, secret: callbackSecret },
      row,
    );
    summary[result] += 1;
  }
  return summary;
}

export interface CallbackDeliveryWorker {
  tickNow(): Promise<void>;
  stop(): void;
}

/** 单实例假设 —— 水平扩容前须先给投递加原子认领。 */
export function startCallbackDeliveryWorker(
  deps: CallbackDeliveryDeps & {
    intervalMs?: number;
    log?: { info(msg: string): void; error(err: unknown, msg: string): void };
  },
): CallbackDeliveryWorker {
  const intervalMs = deps.intervalMs ?? 60_000;
  let current: Promise<void> | null = null;
  const tickNow = () => {
    current ??= (async () => {
      try {
        await tickCallbackDeliveries(deps);
      } catch (error) {
        deps.log?.error(error, "callback delivery tick failed");
      } finally {
        current = null;
      }
    })();
    return current;
  };
  void tickNow();
  const timer = setInterval(() => void tickNow(), intervalMs);
  timer.unref();
  return { tickNow, stop: () => clearInterval(timer) };
}

/** 退费单必有扩展行（推送建单同事务写入）——查无此行 = 数据损坏，拒绝完结而非静默丢回调。 */
export async function createRefundCallbackDelivery(
  tx: Prisma.TransactionClient,
  params: {
    ticket: { id: string; workOrderNumber: string };
    operatorUsername: string;
    remark: string;
  },
) {
  const detail = await tx.ticketRefundDetail.findUnique({
    where: { ticketId: params.ticket.id },
  });
  if (!detail) {
    throw new RefundDetailMissingError(params.ticket.workOrderNumber);
  }
  await tx.callbackDelivery.create({
    data: {
      ticketId: params.ticket.id,
      sysOrderId: detail.sysOrderId,
      endorNo: detail.endorNo,
      workOrderNumber: params.ticket.workOrderNumber,
      actualAmount: detail.expectedAmount,
      compensationAmount: detail.compensationAmount,
      remark: params.remark,
      operator: params.operatorUsername,
    },
  });
}

export class RefundDetailMissingError extends Error {
  constructor(workOrderNumber: string) {
    super(`退费工单 ${workOrderNumber} 缺少扩展数据，无法生成回调投递`);
    this.name = "RefundDetailMissingError";
  }
}

export class CallbackDeliveryNotFoundError extends Error {
  constructor() {
    super("回调投递记录不存在");
    this.name = "CallbackDeliveryNotFoundError";
  }
}

export class CallbackDeliveryNotDeadError extends Error {
  constructor() {
    super("仅死信状态的回调投递可重新投递");
    this.name = "CallbackDeliveryNotDeadError";
  }
}

/** 复位须清零 firstAttemptAt —— 24h 死信窗口自首试起算，保留旧值会立即再死信。 */
export async function redeliverCallbackDelivery(
  { prisma }: Pick<CallbackDeliveryDeps, "prisma">,
  deliveryId: string,
) {
  const row = await prisma.callbackDelivery.findUnique({ where: { id: deliveryId } });
  if (!row) {
    throw new CallbackDeliveryNotFoundError();
  }
  if (row.status !== "dead") {
    throw new CallbackDeliveryNotDeadError();
  }
  return prisma.callbackDelivery.update({
    where: { id: row.id },
    data: {
      status: "pending",
      attempts: 0,
      firstAttemptAt: null,
      nextAttemptAt: null,
      lastError: null,
    },
  });
}
