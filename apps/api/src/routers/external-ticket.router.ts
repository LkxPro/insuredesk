import {
  externalTicketAddNoteInputSchema,
  externalTicketDetailInputSchema,
  externalTicketListInputSchema,
  externalTicketSubmitInputSchema,
  prioritySchema,
  processLogActionSchema,
  ticketStatusSchema,
} from "@insuredesk/shared";
import { TRPCError } from "@trpc/server";
import { systemClock } from "../clock";
import { prisma } from "../db";
import { Prisma } from "../generated/prisma/client";
import { buildExternalTicketConditions } from "../services/external-ticket-query";
import {
  buildExternalNoteNotification,
  buildExternalSubmittedNotification,
  writeBulkNotifications,
} from "../services/notification.service";
import { requirePermission, router } from "../trpc";

const deps = { prisma, clock: systemClock };

/**
 * External ticket router: submit/list/detail endpoints for external users.
 * Data scope: external users see only tickets they submitted (creatorId = 本人).
 * Field visibility: all ticket fields with values are exposed (no whitelist filtering).
 * ProcessLog filtering: only comment (non-internal) + external_note + resolve + create.
 */

/** 目录名随查询 JOIN 出来，裁剪后按引用是否可见决定是否给出名字。 */
const catalogInclude = {
  channel: { select: { name: true } },
  category: { select: { name: true } },
  completionStatus: { select: { name: true } },
} as const;

type TicketWithCatalogs = Prisma.TicketGetPayload<{ include: typeof catalogInclude }>;

/**
 * Wire shape for the external surface: dates as ISO-8601 strings (no
 * transformer on the tRPC link) and 目录引用 paired with the名字.
 * All valued fields are exposed.
 */
function serializeExternalTicket(ticket: TicketWithCatalogs) {
  return {
    id: ticket.id,
    workOrderNumber: ticket.workOrderNumber,
    status: ticketStatusSchema.parse(ticket.status),
    submissionText: ticket.submissionText,
    createdAt: ticket.createdAt.toISOString(),
    feedbackTime: ticket.feedbackTime?.toISOString() ?? null,
    channelId: ticket.channelId,
    channelName: ticket.channel?.name ?? null,
    project: ticket.project,
    brokerageEntity: ticket.brokerageEntity,
    paymentChannel: ticket.paymentChannel,
    internalOrderNumber: ticket.internalOrderNumber,
    policyNumbers: ticket.policyNumbers,
    userComplaintChannel: ticket.userComplaintChannel,
    complaintReceiveChannel: ticket.complaintReceiveChannel,
    customerName: ticket.customerName,
    phone: ticket.phone,
    contactPhone: ticket.contactPhone,
    nuclearBodyStatus: ticket.nuclearBodyStatus,
    customerRequest: ticket.customerRequest,
    hasContacted: ticket.hasContacted,
    contactTime: ticket.contactTime?.toISOString() ?? null,
    contactId: ticket.contactId,
    categoryId: ticket.categoryId,
    categoryName: ticket.category?.name ?? null,
    complaintLevel: ticket.complaintLevel,
    priority: ticket.priority === null ? null : prioritySchema.parse(ticket.priority),
    completionStatusId: ticket.completionStatusId,
    completionStatusName: ticket.completionStatus?.name ?? null,
    completionTime: ticket.completionTime?.toISOString() ?? null,
  };
}

/**
 * 外部界面的入口闸：权限点之外再要求账号本身是外部的 —— 管理员展开后同样
 * 持有 ticket.create_external，却不能从外部口子提交（无预填可盖，数据范围
 * 语义也是外部账号的）。
 */
function requireExternalAccount(isExternal: boolean) {
  if (!isExternal) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "该入口仅限外部账号使用",
    });
  }
}

/** 预填不进会话快照，每个入口现读现用 —— 改配置下次请求即生效。 */
async function loadExternalAccountConfig(userId: string) {
  const account = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      prefillChannelId: true,
      prefillProject: true,
      prefillBrokerageEntity: true,
      prefillPaymentChannel: true,
      prefillUserComplaintChannel: true,
      prefillComplaintReceiveChannel: true,
    },
  });
  if (!account) {
    throw new TRPCError({ code: "NOT_FOUND", message: "账号不存在" });
  }
  return account;
}

export const externalTicketRouter = router({
  /**
   * Submit: external user creates a ticket with submissionText.
   * Stamps source=external_channel, creatorId, and the account's 6 prefill
   * values into the ticket fields (创建时盖章，进单后与手填无异；停用渠道照常写入).
   * Writes action=create ProcessLog.
   * Broadcasts external_submitted notification to all users with ticket.assign.
   */
  submit: requirePermission("ticket.create_external")
    .input(externalTicketSubmitInputSchema)
    .mutation(async ({ ctx, input }) => {
      const user = ctx.user;
      requireExternalAccount(user.isExternal);
      const account = await loadExternalAccountConfig(user.id);

      const now = deps.clock.now();

      const ticket = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const nextSeq = await tx.$queryRaw<
          [{ nextval: bigint }]
        >`SELECT nextval('work_order_number_seq')`;
        const workOrderNumber = `WO${nextSeq[0].nextval}`;

        const newTicket = await tx.ticket.create({
          data: {
            workOrderNumber,
            source: "external_channel",
            submissionText: input.submissionText,
            creatorId: user.id,
            channelId: account.prefillChannelId,
            project: account.prefillProject,
            brokerageEntity: account.prefillBrokerageEntity,
            paymentChannel: account.prefillPaymentChannel,
            userComplaintChannel: account.prefillUserComplaintChannel,
            complaintReceiveChannel: account.prefillComplaintReceiveChannel,
            status: "unassigned",
            // 外部单的客户反馈随提交发生，反馈时间即创建时间
            feedbackTime: now,
            createdAt: now,
            updatedAt: now,
          },
        });

        await tx.processLog.create({
          data: {
            ticketId: newTicket.id,
            action: "create",
            operatorId: user.id,
            operatorName: user.name,
            remark: "",
            at: now,
          },
        });

        const assignableUsers = await tx.user.findMany({
          where: {
            active: true,
            role: {
              permissions: {
                has: "ticket.assign",
              },
            },
          },
          select: { id: true },
        });

        const { title, content } = buildExternalSubmittedNotification({
          accountName: user.name,
          workOrderNumber: newTicket.workOrderNumber,
        });

        await writeBulkNotifications(tx, {
          type: "external_submitted",
          title,
          content,
          ticketId: newTicket.id,
          workOrderNumber: newTicket.workOrderNumber,
          targetUserIds: assignableUsers.map((u) => u.id),
          now,
        });

        return newTicket;
      });

      return {
        id: ticket.id,
        workOrderNumber: ticket.workOrderNumber,
      };
    }),

  /**
   * List: external user lists tickets they submitted.
   * Scope: creatorId = 本人 + deletedAt IS NULL。排序：最新可见跟进是客服
   * comment 的工单置顶（"该你说话了"），其余按最新可见跟进时刻倒序。
   * 每单附最新一条可见跟进（可见性口径与 detail 相同），客户端据此渲染
   * 摘要行与「客服新发言」徽标——纯派生，无已读落库。
   *
   * "每单最新一条可见日志 + 按它排序"超出 Prisma 关系查询能力，页切片走
   * LATERAL 子查询取 id 页，再回 Prisma 水合字段（序列化口径只有一份）。
   */
  list: requirePermission("ticket.create_external")
    .input(externalTicketListInputSchema)
    .query(async ({ ctx, input }) => {
      const user = ctx.user;
      requireExternalAccount(user.isExternal);
      await loadExternalAccountConfig(user.id);

      const whereSql = Prisma.join(buildExternalTicketConditions(user.id, input), " AND ");

      const [pageRows, countRows] = await Promise.all([
        prisma.$queryRaw<
          {
            id: string;
            latest_action: string | null;
            latest_remark: string | null;
            latest_at: Date | null;
          }[]
        >`
          SELECT t.id, p.action AS latest_action, p.remark AS latest_remark, p.at AS latest_at
          FROM tickets t
          LEFT JOIN LATERAL (
            SELECT p0.action, p0.remark, p0.at
            FROM process_logs p0
            WHERE p0."ticketId" = t.id
              AND (
                p0.action IN ('create', 'external_note', 'resolve')
                OR (p0.action = 'comment' AND p0."internalOnly" = false)
              )
            ORDER BY p0.at DESC
            LIMIT 1
          ) p ON true
          WHERE ${whereSql}
          ORDER BY (p.action = 'comment') DESC NULLS LAST,
                   COALESCE(p.at, t."createdAt") DESC,
                   t.id DESC
          LIMIT ${input.limit} OFFSET ${input.offset}
        `,
        prisma.$queryRaw<[{ count: bigint }]>`
          SELECT count(*) AS count FROM tickets t WHERE ${whereSql}
        `,
      ]);

      const pageIds = pageRows.map((row) => row.id);
      const tickets = await prisma.ticket.findMany({
        where: { id: { in: pageIds } },
        include: catalogInclude,
      });
      const ticketById = new Map(tickets.map((ticket) => [ticket.id, ticket]));

      const items = pageRows.map((row) => {
        const ticket = ticketById.get(row.id);
        if (!ticket) {
          return null;
        }
        return {
          ...serializeExternalTicket(ticket),
          latestLog:
            row.latest_action === null
              ? null
              : {
                  action: processLogActionSchema.parse(row.latest_action),
                  remark: row.latest_remark ?? "",
                  at: (row.latest_at as Date).toISOString(),
                },
        };
      });

      return {
        items: items.filter((item) => item !== null),
        total: Number(countRows[0].count),
      };
    }),

  /**
   * Detail: external user views one ticket they submitted.
   * Applies creatorId = 本人 + deletedAt IS NULL (404 if not found or not theirs).
   * All ticket fields are exposed (no whitelist filtering).
   * Filters ProcessLog: only comment (non-internal) + external_note + resolve + create.
   */
  detail: requirePermission("ticket.create_external")
    .input(externalTicketDetailInputSchema)
    .query(async ({ ctx, input }) => {
      const user = ctx.user;
      requireExternalAccount(user.isExternal);

      const ticket = await prisma.ticket.findFirst({
        where: {
          id: input.ticketId,
          creatorId: user.id,
          deletedAt: null,
        },
        include: catalogInclude,
      });

      if (!ticket) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "工单不存在或无权访问",
        });
      }

      const processLogs = await prisma.processLog.findMany({
        where: {
          ticketId: ticket.id,
          OR: [
            { action: "create" },
            { action: "external_note" },
            { action: "resolve" },
            {
              action: "comment",
              internalOnly: false,
            },
          ],
        },
        orderBy: { at: "asc" },
      });

      return {
        ticket: serializeExternalTicket(ticket),
        processLogs: processLogs.map((log) => ({
          id: log.id,
          action: processLogActionSchema.parse(log.action),
          remark: log.remark,
          createdAt: log.at.toISOString(),
          operatorId: log.operatorId,
          operatorName: log.operatorName,
        })),
      };
    }),

  /**
   * AddNote: external user adds a note to a ticket they submitted.
   * Writes action=external_note ProcessLog, does NOT modify contactCount/nextContactTime.
   * Notifies current assignee (or broadcasts to ticket.assign holders if unassigned).
   */
  addNote: requirePermission("ticket.process_external")
    .input(externalTicketAddNoteInputSchema)
    .mutation(async ({ ctx, input }) => {
      const user = ctx.user;
      requireExternalAccount(user.isExternal);

      const ticket = await prisma.ticket.findFirst({
        where: {
          id: input.ticketId,
          creatorId: user.id,
          deletedAt: null,
        },
        select: { id: true, workOrderNumber: true, status: true, assigneeId: true },
      });

      if (!ticket) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "工单不存在或无权访问",
        });
      }

      if (ticket.status === "completed") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "工单已完结，不能添加留言",
        });
      }

      const now = deps.clock.now();

      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.processLog.create({
          data: {
            ticketId: ticket.id,
            action: "external_note",
            operatorId: user.id,
            operatorName: user.name,
            remark: input.content,
            at: now,
          },
        });

        const { title, content } = buildExternalNoteNotification({
          userName: user.name,
          workOrderNumber: ticket.workOrderNumber,
        });

        if (ticket.assigneeId) {
          await tx.appNotification.create({
            data: {
              type: "external_note",
              title,
              content,
              ticketId: ticket.id,
              workOrderNumber: ticket.workOrderNumber,
              targetUserId: ticket.assigneeId,
              createdAt: now,
            },
          });
        } else {
          const assignableUsers = await tx.user.findMany({
            where: {
              active: true,
              role: {
                permissions: {
                  has: "ticket.assign",
                },
              },
            },
            select: { id: true },
          });

          await writeBulkNotifications(tx, {
            type: "external_note",
            title,
            content,
            ticketId: ticket.id,
            workOrderNumber: ticket.workOrderNumber,
            targetUserIds: assignableUsers.map((u) => u.id),
            now,
          });
        }
      });

      return { success: true };
    }),
});
