import type { Prisma } from "../generated/prisma/client";
import type { AuthenticatedUser } from "./auth.service";
import type { TicketServiceDeps } from "./ticket.service";

/**
 * 轨 1 收件箱: user-action-triggered TRUE
 * events, this phase solely `assigned`. The write runs INSIDE the assignment
 * transaction — notification and assignment commit or roll back together, and
 * every assignment surface (single, batch, and future automatic assignment) shares this
 * one path by construction. Time-derived alerts (overdue/due_soon/待首响…)
 * are 轨 2, computed at read time: nothing here ever polls or scans.
 */

/** One duration component set, floored to whole minutes: "35 小时 20 分钟". */
function formatDuration(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0 && minutes > 0) {
    return `${hours} 小时 ${minutes} 分钟`;
  }
  return hours > 0 ? `${hours} 小时` : `${minutes} 分钟`;
}

/**
 * 改派 annotation (改派通知标注剩余时间): how long the NEW owner
 * has until dueAt as of the reassignment instant — or how far past it the
 * ticket already is. 特急 tickets have no deadline (dueAt null).
 */
function formatRemainingTime(dueAt: Date | null, now: Date) {
  if (dueAt === null) {
    return "无处理时限";
  }
  const diffMinutes = Math.floor(Math.abs(dueAt.getTime() - now.getTime()) / 60_000);
  if (dueAt.getTime() > now.getTime()) {
    return diffMinutes < 1
      ? "剩余处理时间不足 1 分钟"
      : `剩余处理时间 ${formatDuration(diffMinutes)}`;
  }
  return diffMinutes < 1 ? "已超时不足 1 分钟" : `已超时 ${formatDuration(diffMinutes)}`;
}

/**
 * Pure message builder for the `assigned` notification. operatorName is a
 * name snapshot at event time, immune to later renames.
 */
export function buildAssignedNotification(params: {
  workOrderNumber: string;
  operatorName: string;
  isFirstAssignment: boolean;
  dueAt: Date | null;
  now: Date;
}) {
  if (params.isFirstAssignment) {
    return {
      title: "新工单分配",
      content: `${params.operatorName} 将工单 ${params.workOrderNumber} 分配给你`,
    };
  }
  return {
    title: "工单改派",
    content: `${params.operatorName} 将工单 ${params.workOrderNumber} 改派给你（${formatRemainingTime(params.dueAt, params.now)}）`,
  };
}

/**
 * THE single write path for `assigned` notifications. Runs inside the
 * caller's assignment transaction; `now` is the same instant stamped on the
 * assignment's fields and ProcessLog entries.
 */
export async function writeAssignedNotification(
  tx: Prisma.TransactionClient,
  params: {
    ticket: { id: string; workOrderNumber: string; dueAt: Date | null };
    targetUserId: string;
    operatorName: string;
    isFirstAssignment: boolean;
    now: Date;
  },
) {
  const { title, content } = buildAssignedNotification({
    workOrderNumber: params.ticket.workOrderNumber,
    operatorName: params.operatorName,
    isFirstAssignment: params.isFirstAssignment,
    dueAt: params.ticket.dueAt,
    now: params.now,
  });
  await tx.appNotification.create({
    data: {
      type: "assigned",
      title,
      content,
      ticketId: params.ticket.id,
      workOrderNumber: params.ticket.workOrderNumber,
      targetUserId: params.targetUserId,
      createdAt: params.now,
    },
  });
}

/**
 * Pure message builder for the `external_submitted` notification.
 */
export function buildExternalSubmittedNotification(params: {
  accountName: string;
  workOrderNumber: string;
}) {
  return {
    title: "外部工单提交",
    content: `${params.accountName} 提交了新工单 ${params.workOrderNumber}`,
  };
}

/**
 * Pure message builder for the `external_note` notification.
 */
export function buildExternalNoteNotification(params: {
  userName: string;
  workOrderNumber: string;
}) {
  return {
    title: "外部留言",
    content: `${params.userName} 在工单 ${params.workOrderNumber} 添加了留言`,
  };
}

/**
 * Bulk write notifications to multiple users. Used for broadcasting events
 * like external submissions to all users with a specific permission.
 */
export async function writeBulkNotifications(
  tx: Prisma.TransactionClient,
  params: {
    type: string;
    title: string;
    content: string;
    ticketId: string;
    workOrderNumber: string;
    targetUserIds: string[];
    now: Date;
  },
) {
  if (params.targetUserIds.length === 0) {
    return;
  }

  await tx.appNotification.createMany({
    data: params.targetUserIds.map((targetUserId) => ({
      type: params.type,
      title: params.title,
      content: params.content,
      ticketId: params.ticketId,
      workOrderNumber: params.workOrderNumber,
      targetUserId,
      createdAt: params.now,
    })),
  });
}

/** Pure message builder for the `external_reply` notification (内部跟进回执给外部提交者). */
export function buildExternalReplyNotification(params: {
  operatorName: string;
  workOrderNumber: string;
}) {
  return {
    type: "external_reply",
    title: "客服跟进",
    content: `${params.operatorName} 在工单 ${params.workOrderNumber} 添加了跟进`,
  };
}

/** Pure message builder for the `external_resolved` notification. */
export function buildExternalResolvedNotification(params: { workOrderNumber: string }) {
  return {
    type: "external_resolved",
    title: "工单完结",
    content: `工单 ${params.workOrderNumber} 已完结`,
  };
}

/**
 * 内部动作 → 外部提交者回执的唯一写入点：只有 source=external_channel 的
 * 工单才有外部提交者可通知（其余来源的 creator 是内部同事，不在此通道），
 * 在调用方的事务内写入，与动作本身同 commit。
 */
export async function writeExternalCreatorNotification(
  tx: Prisma.TransactionClient,
  params: {
    ticket: { id: string; workOrderNumber: string; source: string; creatorId: string | null };
    type: string;
    title: string;
    content: string;
    now: Date;
  },
) {
  if (params.ticket.source !== "external_channel" || params.ticket.creatorId === null) {
    return;
  }
  await tx.appNotification.create({
    data: {
      type: params.type,
      title: params.title,
      content: params.content,
      ticketId: params.ticket.id,
      workOrderNumber: params.ticket.workOrderNumber,
      targetUserId: params.ticket.creatorId,
      createdAt: params.now,
    },
  });
}

/**
 * The bell's poll payload: the viewer's latest notifications plus their total
 * unread count, in one request (one 30s poll). Notifications
 * are strictly personal — targetUserId is pinned to the viewer, no data-scope
 * variance, no extra permission point.
 */
export async function listNotifications(
  { prisma }: TicketServiceDeps,
  viewer: AuthenticatedUser,
  input: { limit: number },
) {
  const [rows, unreadCount] = await Promise.all([
    prisma.appNotification.findMany({
      where: { targetUserId: viewer.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit,
    }),
    prisma.appNotification.count({ where: { targetUserId: viewer.id, read: false } }),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      content: row.content,
      ticketId: row.ticketId,
      workOrderNumber: row.workOrderNumber,
      read: row.read,
      createdAt: row.createdAt.toISOString(),
    })),
    unreadCount,
  };
}

/**
 * Mark one of the viewer's notifications read. updateMany with the viewer
 * pinned in the filter: someone else's id (or an unknown one) matches zero
 * rows — a silent no-op, no existence leak. Idempotent by nature.
 */
export async function markNotificationRead(
  { prisma }: TicketServiceDeps,
  viewer: AuthenticatedUser,
  id: string,
) {
  await prisma.appNotification.updateMany({
    where: { id, targetUserId: viewer.id },
    data: { read: true },
  });
}

/** 全部已读: flip every unread notification of the viewer in one statement. */
export async function markAllNotificationsRead(
  { prisma }: TicketServiceDeps,
  viewer: AuthenticatedUser,
) {
  await prisma.appNotification.updateMany({
    where: { targetUserId: viewer.id, read: false },
    data: { read: true },
  });
}
