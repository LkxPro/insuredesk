import {
  DEFAULT_EXTERNAL_DETAIL_FIELDS,
  DEFAULT_EXTERNAL_LIST_FIELDS,
  EXTERNAL_VISIBLE_FIELD_OPTIONS,
  externalTicketAddNoteInputSchema,
  externalTicketDetailInputSchema,
  externalTicketListInputSchema,
  externalTicketSubmitInputSchema,
  externalTicketUpdatePreferencesInputSchema,
  prioritySchema,
  processLogActionSchema,
  resolveExternalFieldOrder,
  resolveExternalVisibleFields,
  TICKET_STATUS_LABELS,
  ticketStatusSchema,
} from "@insuredesk/shared";
import { TRPCError } from "@trpc/server";
import { systemClock } from "../clock";
import { prisma } from "../db";
import { Prisma } from "../generated/prisma/client";
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
 * Field visibility: list and detail/search/export use independent ordered account configs.
 * ProcessLog filtering: create, public comment, external_note, status_change and resolve only.
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
 * transformer on the tRPC link) and 目录引用 paired with the名字 the外部方 can
 * actually read — an id is useless to them, and they may not query the catalogs.
 * 名字只在对应 id 通过白名单时给出，否则跟着 id 一起消失。
 */
function serializeExternalTicket(ticket: TicketWithCatalogs, whitelist: readonly string[]) {
  const payload = {
    id: ticket.id,
    submissionText: ticket.submissionText,
    createdAt: ticket.createdAt.toISOString(),
    workOrderNumber: ticket.workOrderNumber,
    status: ticketStatusSchema.parse(ticket.status),
    feedbackTime: ticket.feedbackTime?.toISOString() ?? null,
    channelId: ticket.channelId,
    channelName: ticket.channelId ? (ticket.channel?.name ?? null) : null,
    project: ticket.project,
    brokerageEntity: ticket.brokerageEntity,
    paymentChannel: ticket.paymentChannel,
    policyNumbers: ticket.policyNumbers,
    userComplaintChannel: ticket.userComplaintChannel,
    complaintReceiveChannel: ticket.complaintReceiveChannel,
    customerName: ticket.customerName,
    phone: ticket.phone,
    nuclearBodyStatus: ticket.nuclearBodyStatus,
    customerRequest: ticket.customerRequest,
    hasContacted: ticket.hasContacted,
    contactTime: ticket.contactTime?.toISOString() ?? null,
    categoryId: ticket.categoryId,
    categoryName: ticket.categoryId ? (ticket.category?.name ?? null) : null,
    complaintLevel: ticket.complaintLevel,
    priority: ticket.priority === null ? null : prioritySchema.parse(ticket.priority),
    processingResult: ticket.processingResult,
    completionStatusId: ticket.completionStatusId,
    completionStatusName: ticket.completionStatusId
      ? (ticket.completionStatus?.name ?? null)
      : null,
    completionTime: ticket.completionTime?.toISOString() ?? null,
  };

  const fieldDependencies: Partial<Record<string, readonly string[]>> = {
    channelId: ["channelName"],
    categoryId: ["categoryName"],
    completionStatusId: ["completionStatusName", "completionTime"],
  };
  const visible = new Set(whitelist);
  const projected = payload as Record<string, unknown>;
  for (const field of EXTERNAL_VISIBLE_FIELD_OPTIONS) {
    if (!visible.has(field)) {
      delete projected[field];
      for (const dependent of fieldDependencies[field] ?? []) {
        delete projected[dependent];
      }
    }
  }
  return payload;
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

/** 预填与白名单不进会话快照，每个入口现读现用 —— 改配置下次请求即生效。 */
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
      externalListFields: true,
      externalDetailFields: true,
      externalListOrder: true,
      externalExportOrder: true,
    },
  });
  if (!account) {
    throw new TRPCError({ code: "NOT_FOUND", message: "账号不存在" });
  }
  return account;
}

export const externalTicketRouter = router({
  preferences: requirePermission("ticket.create_external").query(async ({ ctx }) => {
    requireExternalAccount(ctx.user.isExternal);
    const account = await loadExternalAccountConfig(ctx.user.id);
    const defaultListFields = resolveExternalVisibleFields(
      account.externalListFields,
      DEFAULT_EXTERNAL_LIST_FIELDS,
    );
    const defaultExportFields = resolveExternalVisibleFields(
      account.externalDetailFields,
      DEFAULT_EXTERNAL_DETAIL_FIELDS,
    );

    return {
      listFields: resolveExternalFieldOrder(account.externalListOrder, defaultListFields),
      exportFields: resolveExternalFieldOrder(account.externalExportOrder, defaultExportFields),
      defaultListFields,
      defaultExportFields,
    };
  }),

  updatePreferences: requirePermission("ticket.create_external")
    .input(externalTicketUpdatePreferencesInputSchema)
    .mutation(async ({ ctx, input }) => {
      requireExternalAccount(ctx.user.isExternal);
      const account = await loadExternalAccountConfig(ctx.user.id);
      const allowedFields = resolveExternalVisibleFields(
        input.surface === "list" ? account.externalListFields : account.externalDetailFields,
        input.surface === "list" ? DEFAULT_EXTERNAL_LIST_FIELDS : DEFAULT_EXTERNAL_DETAIL_FIELDS,
      );
      const resolvedFields = resolveExternalFieldOrder(
        input.fields.length > 0 ? JSON.stringify(input.fields) : null,
        allowedFields,
      );

      await prisma.user.update({
        where: { id: ctx.user.id },
        data:
          input.surface === "list"
            ? { externalListOrder: input.fields.length > 0 ? JSON.stringify(resolvedFields) : null }
            : {
                externalExportOrder:
                  input.fields.length > 0 ? JSON.stringify(resolvedFields) : null,
              },
      });

      return { fields: resolvedFields };
    }),

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
            createdAt: now,
            feedbackTime: now,
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
   * Scope: creatorId = 本人 + deletedAt IS NULL，默认包含全部状态；支持状态、
   * 完结状态、反馈时间和已授权文本字段筛选。默认按反馈时间倒序，也可按状态、
   * 完结状态或最新活动时间排序。每单附最新公开客服回复和账号级已读游标，
   * 客户端据此渲染「客服新回复」徽标。
   *
   * "每单最新一条可见日志 + 按它排序"超出 Prisma 关系查询能力，页切片走
   * LATERAL 子查询取 id 页，再回 Prisma 水合字段（序列化口径只有一份）。
   */
  list: requirePermission("ticket.create_external")
    .input(externalTicketListInputSchema)
    .query(async ({ ctx, input }) => {
      const user = ctx.user;
      requireExternalAccount(user.isExternal);
      const account = await loadExternalAccountConfig(user.id);
      const defaultListFields = resolveExternalVisibleFields(
        account.externalListFields,
        DEFAULT_EXTERNAL_LIST_FIELDS,
      );
      const listWhitelist = resolveExternalFieldOrder(account.externalListOrder, defaultListFields);
      const detailWhitelist = resolveExternalVisibleFields(
        account.externalDetailFields,
        DEFAULT_EXTERNAL_DETAIL_FIELDS,
      );

      const conditions: Prisma.Sql[] = [
        Prisma.sql`t."creatorId" = ${user.id}`,
        Prisma.sql`t."deletedAt" IS NULL`,
      ];
      if (input.status && input.status.length > 0) {
        conditions.push(Prisma.sql`t.status IN (${Prisma.join(input.status)})`);
      } else if (!input.includeCompleted) {
        conditions.push(Prisma.sql`t.status <> 'completed'`);
      }
      if (input.completionStatusId && input.completionStatusId.length > 0) {
        conditions.push(
          Prisma.sql`t."completionStatusId" IN (${Prisma.join(input.completionStatusId)})`,
        );
      }
      if (input.feedbackFrom) {
        conditions.push(Prisma.sql`t."feedbackTime" >= ${new Date(input.feedbackFrom)}`);
      }
      if (input.feedbackTo) {
        conditions.push(Prisma.sql`t."feedbackTime" <= ${new Date(input.feedbackTo)}`);
      }
      if (input.search) {
        const pattern = `%${input.search}%`;
        const searchTerms: Prisma.Sql[] = [];
        const searchExpressions: Record<string, Prisma.Sql> = {
          submissionText: Prisma.sql`t."submissionText" ILIKE ${pattern}`,
          workOrderNumber: Prisma.sql`t."workOrderNumber" ILIKE ${pattern}`,
          project: Prisma.sql`t.project ILIKE ${pattern}`,
          brokerageEntity: Prisma.sql`t."brokerageEntity" ILIKE ${pattern}`,
          paymentChannel: Prisma.sql`t."paymentChannel" ILIKE ${pattern}`,
          policyNumbers: Prisma.sql`array_to_string(t."policyNumbers", ' ') ILIKE ${pattern}`,
          userComplaintChannel: Prisma.sql`t."userComplaintChannel" ILIKE ${pattern}`,
          complaintReceiveChannel: Prisma.sql`t."complaintReceiveChannel" ILIKE ${pattern}`,
          customerName: Prisma.sql`t."customerName" ILIKE ${pattern}`,
          nuclearBodyStatus: Prisma.sql`t."nuclearBodyStatus" ILIKE ${pattern}`,
          customerRequest: Prisma.sql`t."customerRequest" ILIKE ${pattern}`,
          complaintLevel: Prisma.sql`t."complaintLevel" ILIKE ${pattern}`,
          priority: Prisma.sql`t.priority ILIKE ${pattern}`,
          processingResult: Prisma.sql`t."processingResult" ILIKE ${pattern}`,
        };
        const phoneDigits = input.search.replace(/\D/g, "");
        if (phoneDigits) {
          searchExpressions.phone = Prisma.sql`regexp_replace(t.phone, '[^0-9]', '', 'g') ILIKE ${`%${phoneDigits}%`}`;
        }
        for (const field of detailWhitelist) {
          const expression = searchExpressions[field];
          if (expression) searchTerms.push(expression);
        }
        conditions.push(
          searchTerms.length > 0
            ? Prisma.sql`(${Prisma.join(searchTerms, " OR ")})`
            : Prisma.sql`false`,
        );
      }
      const whereSql = Prisma.join(conditions, " AND ");

      const sortExpression =
        input.sortBy === "feedbackTime"
          ? Prisma.sql`t."feedbackTime"`
          : input.sortBy === "status"
            ? Prisma.sql`t.status`
            : input.sortBy === "completionStatus"
              ? Prisma.sql`cs."displayOrder"`
              : Prisma.sql`COALESCE(p.at, t."createdAt")`;
      const sortDirection = input.sortOrder === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;

      // 可见性口径与 detail 的 ProcessLog 过滤相同，改一处必须改另一处
      const [pageRows, countRows] = await Promise.all([
        prisma.$queryRaw<
          {
            id: string;
            latest_action: string | null;
            latest_remark: string | null;
            latest_at: Date | null;
            has_unread_reply: boolean;
          }[]
        >`
          SELECT t.id,
                 p.action AS latest_action,
                 p.remark AS latest_remark,
                 p.at AS latest_at,
                 EXISTS (
                   SELECT 1
                   FROM process_logs unread
                   WHERE unread."ticketId" = t.id
                     AND unread.action = 'comment'
                     AND unread."internalOnly" = false
                     AND (read_state."lastReadReplyAt" IS NULL OR unread.at > read_state."lastReadReplyAt")
                 ) AS has_unread_reply
          FROM tickets t
          LEFT JOIN completion_statuses cs ON cs.id = t."completionStatusId"
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
          LEFT JOIN external_ticket_read_states read_state
            ON read_state."ticketId" = t.id AND read_state."userId" = ${user.id}
          WHERE ${whereSql}
          ORDER BY ${sortExpression} ${sortDirection} NULLS LAST,
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
          // 页切片与水合之间并发删除了该单：跳过比 500 更接近真实
          return null;
        }
        return {
          ...serializeExternalTicket(ticket, [...new Set([...listWhitelist, ...detailWhitelist])]),
          latestLog:
            row.latest_action === null
              ? null
              : {
                  action: processLogActionSchema.parse(row.latest_action),
                  remark: row.latest_remark ?? "",
                  at: (row.latest_at as Date).toISOString(),
                },
          hasUnreadReply: row.has_unread_reply,
        };
      });

      return {
        items: items.filter((item) => item !== null),
        total: Number(countRows[0].count),
        visibleFields: listWhitelist,
        detailVisibleFields: detailWhitelist,
      };
    }),

  /**
   * Detail: external user views one ticket they submitted.
   * Applies creatorId = 本人 + deletedAt IS NULL (404 if not found or not theirs).
   * Filters ticket fields by whitelist.
   * Filters ProcessLog: only comment (non-internal) + external_note + resolve.
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
            { action: "status_change" },
            { action: "resolve" },
            {
              action: "comment",
              internalOnly: false,
            },
          ],
        },
        orderBy: [{ at: "desc" }, { id: "desc" }],
      });

      const latestPublicReply = processLogs.find(
        (log) => log.action === "comment" && !log.internalOnly,
      );
      if (latestPublicReply) {
        await prisma.$executeRaw`
          INSERT INTO external_ticket_read_states ("userId", "ticketId", "lastReadReplyAt")
          VALUES (${user.id}, ${ticket.id}, ${latestPublicReply.at})
          ON CONFLICT ("userId", "ticketId") DO UPDATE
          SET "lastReadReplyAt" = GREATEST(
            external_ticket_read_states."lastReadReplyAt",
            EXCLUDED."lastReadReplyAt"
          )
        `;
      }

      const account = await loadExternalAccountConfig(user.id);
      const whitelist = resolveExternalVisibleFields(
        account.externalDetailFields,
        DEFAULT_EXTERNAL_DETAIL_FIELDS,
      );

      return {
        ticket: serializeExternalTicket(ticket, whitelist),
        visibleFields: whitelist,
        canAddNote: ticket.status !== "completed",
        processLogs: processLogs.map((log) => ({
          id: log.id,
          // Re-narrowed so the web renders the action label without a cast
          action: processLogActionSchema.parse(log.action),
          remark:
            log.action === "status_change" && log.from && log.to
              ? `${TICKET_STATUS_LABELS[ticketStatusSchema.parse(log.from)]} → ${
                  TICKET_STATUS_LABELS[ticketStatusSchema.parse(log.to)]
                }`
              : log.remark,
          createdAt: log.at.toISOString(),
          operatorId: log.operatorId,
          operatorName: log.operatorName,
        })),
      };
    }),

  /**
   * AddNote: external user adds a note to a ticket they submitted.
   * Writes action=external_note ProcessLog, does NOT modify contactCount/processingResult/nextContactTime.
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
