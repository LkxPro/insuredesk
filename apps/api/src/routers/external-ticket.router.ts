import {
  DEFAULT_EXTERNAL_VISIBLE_FIELDS,
  externalTicketDetailInputSchema,
  externalTicketListInputSchema,
  externalTicketSubmitInputSchema,
  filterVisibleFields,
} from "@insuredesk/shared";
import { TRPCError } from "@trpc/server";
import { systemClock } from "../clock";
import { prisma } from "../db";
import type { Prisma } from "../generated/prisma/client";
import { applyExternalOrgDataScope } from "../services/data-scope.service";
import {
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
        const nextSeq = await tx.$queryRaw<[{ nextval: bigint }]>`SELECT nextval('work_order_number_seq')`;
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

      const whitelist = externalOrg.visibleTicketFields
        ? JSON.parse(externalOrg.visibleTicketFields)
        : DEFAULT_EXTERNAL_VISIBLE_FIELDS;

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
          orderBy: { createdAt: "desc" },
          skip: input.offset,
          take: input.limit,
        }),
        prisma.ticket.count({ where }),
      ]);

      return {
        items: tickets.map((ticket) => filterVisibleFields(ticket, whitelist)),
        total,
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

      const whitelist = externalOrg.visibleTicketFields
        ? JSON.parse(externalOrg.visibleTicketFields)
        : DEFAULT_EXTERNAL_VISIBLE_FIELDS;

      return {
        ticket: filterVisibleFields(ticket, whitelist),
        processLogs: processLogs.map((log) => ({
          id: log.id,
          action: log.action,
          remark: log.remark,
          createdAt: log.at.toISOString(),
          operatorId: log.operatorId,
          operatorName: log.operatorName,
        })),
      };
    }),
});
