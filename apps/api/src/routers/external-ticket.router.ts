import {
  DEFAULT_EXTERNAL_VISIBLE_FIELDS,
  externalTicketAddNoteInputSchema,
  externalTicketDetailInputSchema,
  externalTicketListInputSchema,
  externalTicketSubmitInputSchema,
  filterVisibleFields,
  prioritySchema,
  processLogActionSchema,
  ticketStatusSchema,
} from "@insuredesk/shared";
import { TRPCError } from "@trpc/server";
import { systemClock } from "../clock";
import { prisma } from "../db";
import type { Prisma } from "../generated/prisma/client";
import { applyExternalOrgDataScope } from "../services/data-scope.service";
import {
  buildExternalNoteNotification,
  buildExternalSubmittedNotification,
  writeBulkNotifications,
} from "../services/notification.service";
import { requirePermission, router } from "../trpc";

const deps = { prisma, clock: systemClock };

/**
 * External ticket router: submit/list/detail endpoints for external users.
 * Data scope: external users see only tickets from their org.
 * Field visibility: tickets are filtered by org's visibleTicketFields whitelist.
 * ProcessLog filtering: only comment (non-internal) + external_note + resolve.
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
  const visible = filterVisibleFields(ticket, whitelist);
  return {
    id: visible.id,
    workOrderNumber: visible.workOrderNumber,
    // Re-narrow through the shared schema so the wire type carries the union
    status: ticketStatusSchema.parse(visible.status),
    submissionText: visible.submissionText,
    createdAt: visible.createdAt.toISOString(),
    feedbackTime: visible.feedbackTime?.toISOString() ?? null,
    channelId: visible.channelId,
    channelName: visible.channelId ? (ticket.channel?.name ?? null) : null,
    project: visible.project,
    brokerageEntity: visible.brokerageEntity,
    paymentChannel: visible.paymentChannel,
    userComplaintChannel: visible.userComplaintChannel,
    complaintReceiveChannel: visible.complaintReceiveChannel,
    nuclearBodyStatus: visible.nuclearBodyStatus,
    customerRequest: visible.customerRequest,
    hasContacted: visible.hasContacted,
    contactTime: visible.contactTime?.toISOString() ?? null,
    categoryId: visible.categoryId,
    categoryName: visible.categoryId ? (ticket.category?.name ?? null) : null,
    complaintLevel: visible.complaintLevel,
    priority: visible.priority === null ? null : prioritySchema.parse(visible.priority),
    processingResult: visible.processingResult,
    completionStatusId: visible.completionStatusId,
    completionStatusName: visible.completionStatusId
      ? (ticket.completionStatus?.name ?? null)
      : null,
    completionTime: visible.completionTime?.toISOString() ?? null,
  };
}

/**
 * 工单号与状态是工单对外的身份与当前进展，不是可配的业务字段：
 * EXTERNAL_VISIBLE_FIELD_OPTIONS 由建单字段推导，两者都不在其中，所以管理员
 * 在界面上根本勾不到——若只信任显式白名单，任何配过一次的机构都会丢掉工单号列
 * 与详情标题。这里补齐，让白名单只表达"业务字段给不给看"。
 */
const ALWAYS_VISIBLE_FIELDS = ["workOrderNumber", "status"] as const;

/** 机构白名单：显式配置优先，未配置走系统默认；两种情况都补上恒可见字段。 */
function resolveWhitelist(visibleTicketFields: string | null): string[] {
  const configured: string[] = visibleTicketFields
    ? JSON.parse(visibleTicketFields)
    : [...DEFAULT_EXTERNAL_VISIBLE_FIELDS];
  const missing = ALWAYS_VISIBLE_FIELDS.filter((key) => !configured.includes(key));
  // 恒可见字段排在前：白名单顺序就是列表列顺序
  return [...missing, ...configured];
}

export const externalTicketRouter = router({
  /**
   * Submit: external user creates a ticket with submissionText.
   * Stamps source=external_channel, externalOrgId, creatorId, channelId.
   * Writes action=create ProcessLog.
   * Broadcasts external_submitted notification to all users with ticket.assign.
   */
  submit: requirePermission("ticket.create_external")
    .input(externalTicketSubmitInputSchema)
    .mutation(async ({ ctx, input }) => {
      const user = ctx.user;

      if (!user.externalOrgId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "外部提交需要关联外部机构",
        });
      }

      const externalOrg = await prisma.externalOrg.findUnique({
        where: { id: user.externalOrgId },
      });

      if (!externalOrg) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "外部机构不存在",
        });
      }

      if (!externalOrg.active) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "外部机构已停用",
        });
      }

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
            externalOrgId: user.externalOrgId,
            creatorId: user.id,
            channelId: externalOrg.channelId,
            status: "unassigned",
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
          orgName: externalOrg.name,
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
   * List: external user lists tickets from their org.
   * Applies externalOrgDataScope + deletedAt IS NULL.
   * Filters each ticket by org's visibleTicketFields whitelist.
   */
  list: requirePermission("ticket.create_external")
    .input(externalTicketListInputSchema)
    .query(async ({ ctx, input }) => {
      const user = ctx.user;

      if (!user.externalOrgId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "外部查询需要关联外部机构",
        });
      }

      const externalOrg = await prisma.externalOrg.findUnique({
        where: { id: user.externalOrgId },
      });

      if (!externalOrg) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "外部机构不存在",
        });
      }

      const whitelist = resolveWhitelist(externalOrg.visibleTicketFields);

      const where: Prisma.TicketWhereInput = {
        ...applyExternalOrgDataScope(user),
        deletedAt: null,
        ...(input.status && input.status.length > 0 ? { status: { in: input.status } } : {}),
        ...(input.search
          ? {
              OR: [
                { workOrderNumber: { contains: input.search, mode: "insensitive" as const } },
                { submissionText: { contains: input.search, mode: "insensitive" as const } },
              ],
            }
          : {}),
      };

      const [tickets, total] = await Promise.all([
        prisma.ticket.findMany({
          where,
          include: catalogInclude,
          orderBy: { createdAt: "desc" },
          skip: input.offset,
          take: input.limit,
        }),
        prisma.ticket.count({ where }),
      ]);

      return {
        items: tickets.map((ticket) => serializeExternalTicket(ticket, whitelist)),
        total,
        // 列表列与详情卡片都按机构白名单渲染，客户端没有别的途径读到它
        visibleFields: whitelist,
      };
    }),

  /**
   * Detail: external user views one ticket from their org.
   * Applies externalOrgDataScope + deletedAt IS NULL (404 if not found or wrong org).
   * Filters ticket fields by whitelist.
   * Filters ProcessLog: only comment (non-internal) + external_note + resolve.
   */
  detail: requirePermission("ticket.create_external")
    .input(externalTicketDetailInputSchema)
    .query(async ({ ctx, input }) => {
      const user = ctx.user;

      if (!user.externalOrgId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "外部查询需要关联外部机构",
        });
      }

      const externalOrg = await prisma.externalOrg.findUnique({
        where: { id: user.externalOrgId },
      });

      if (!externalOrg) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "外部机构不存在",
        });
      }

      const ticket = await prisma.ticket.findFirst({
        where: {
          id: input.ticketId,
          ...applyExternalOrgDataScope(user),
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

      const whitelist = resolveWhitelist(externalOrg.visibleTicketFields);

      return {
        ticket: serializeExternalTicket(ticket, whitelist),
        visibleFields: whitelist,
        processLogs: processLogs.map((log) => ({
          id: log.id,
          // Re-narrowed so the web renders the action label without a cast
          action: processLogActionSchema.parse(log.action),
          remark: log.remark,
          createdAt: log.at.toISOString(),
          operatorId: log.operatorId,
          operatorName: log.operatorName,
        })),
      };
    }),

  /**
   * AddNote: external user adds a note to a ticket.
   * Writes action=external_note ProcessLog, does NOT modify contactCount/processingResult/nextContactTime.
   * Notifies current assignee (or broadcasts to ticket.assign holders if unassigned).
   */
  addNote: requirePermission("ticket.process_external")
    .input(externalTicketAddNoteInputSchema)
    .mutation(async ({ ctx, input }) => {
      const user = ctx.user;

      if (!user.externalOrgId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "外部留言需要关联外部机构",
        });
      }

      const ticket = await prisma.ticket.findFirst({
        where: {
          id: input.ticketId,
          ...applyExternalOrgDataScope(user),
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
