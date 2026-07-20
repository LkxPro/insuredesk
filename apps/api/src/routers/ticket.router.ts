import {
  ticketAddCommentInputSchema,
  ticketAssignInputSchema,
  ticketAutoAssignInputSchema,
  ticketBatchAssignInputSchema,
  ticketCreateInputSchema,
  ticketDeleteInputSchema,
  ticketEditInputSchema,
  ticketImportBatchListInputSchema,
  ticketImportRevokeInputSchema,
  ticketListInputSchema,
  ticketResolveInputSchema,
} from "@insuredesk/shared";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { systemClock } from "../clock";
import { prisma } from "../db";
import { CatalogUnavailableError } from "../services/dictionary-catalog.service";
import {
  createTicket,
  getTicketDetail,
  listTickets,
  RequiredFieldsMissingError,
  SlaPolicyNotConfiguredError,
} from "../services/ticket.service";
import {
  AssigneeNotAssignableError,
  assignTicket,
  autoAssignTicketsBySchedule,
  batchAssignTickets,
  listAssigneeOptions,
  TicketNotAssignableError,
  TicketNotFoundError,
} from "../services/ticket-assign.service";
import { addTicketComment, TicketNotProcessableError } from "../services/ticket-comment.service";
import { deleteTicket } from "../services/ticket-delete.service";
import { editTicket } from "../services/ticket-edit.service";
import {
  ImportBatchAlreadyRevokedError,
  ImportBatchLockedError,
  ImportBatchNotFoundError,
  listImportBatches,
  revokeImportBatch,
} from "../services/ticket-import-batch.service";
import { resolveTicket, TicketNotResolvableError } from "../services/ticket-resolve.service";
import { requireAnyPermission, requirePermission, router } from "../trpc";

/**
 * Ticket routes: manual creation, the detail page read, the filterable list,
 * assignment (manual and batch), follow-ups, resolution,
 * editing, and soft deletion. Thin wrappers — validation via the shared Zod
 * schemas, RBAC via requirePermission, business logic in the ticket services.
 */

const deps = { prisma, clock: systemClock };

/** Assignment domain errors → transport codes; anything else rethrows as-is. */
function mapAssignmentError(error: unknown): never {
  if (error instanceof TicketNotFoundError) {
    throw new TRPCError({ code: "NOT_FOUND", message: error.message, cause: error });
  }
  if (error instanceof TicketNotAssignableError) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message, cause: error });
  }
  if (error instanceof AssigneeNotAssignableError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
  }
  throw error;
}

export const ticketRouter = router({
  /**
   * Create a manually-entered ticket. Guarded by ticket.create — users
   * without it are rejected here regardless of what the UI shows.
   */
  create: requirePermission("ticket.create")
    .input(ticketCreateInputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const ticket = await createTicket(deps, ctx.user, input);
        return { id: ticket.id, workOrderNumber: ticket.workOrderNumber };
      } catch (error) {
        if (error instanceof SlaPolicyNotConfiguredError) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: error.message,
            cause: error,
          });
        }
        if (error instanceof RequiredFieldsMissingError) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: error.message,
            cause: error,
          });
        }
        if (error instanceof CatalogUnavailableError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
        }
        throw error;
      }
    }),

  /**
   * Paged, filterable list for 工单管理. Data scope applies: without
   * ticket.view_all the query is pinned to 指派给我 OR 我创建的.
   */
  list: requirePermission("ticket.view")
    .input(ticketListInputSchema)
    .query(({ ctx, input }) => listTickets(deps, ctx.user, input)),

  /**
   * Full detail + timeline for the detail page. Data scope applies: without
   * ticket.view_all only tickets assigned to or created by the viewer
   * resolve; anything else is NOT_FOUND.
   */
  detail: requirePermission("ticket.view")
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const detail = await getTicketDetail(deps, ctx.user, input.id);
      if (detail === null) {
        throw new TRPCError({ code: "NOT_FOUND", message: "工单不存在或无权查看" });
      }
      return detail;
    }),

  /**
   * Assign or reassign one ticket. Guarded by ticket.assign —
   * the UI hides its entry points without it, and the API rejects regardless.
   */
  assign: requirePermission("ticket.assign")
    .input(ticketAssignInputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await assignTicket(deps, ctx.user, input);
      } catch (error) {
        mapAssignmentError(error);
      }
    }),

  /**
   * 添加跟进备注. Guarded by ticket.process; the data scope inside
   * keeps a frontline CS on their own tickets.
   */
  addComment: requirePermission("ticket.process")
    .input(ticketAddCommentInputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await addTicketComment(deps, ctx.user, input);
      } catch (error) {
        if (error instanceof TicketNotFoundError) {
          throw new TRPCError({ code: "NOT_FOUND", message: error.message, cause: error });
        }
        if (error instanceof TicketNotProcessableError) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: error.message,
            cause: error,
          });
        }
        throw error;
      }
    }),

  /**
   * 完结工单. Guarded by ticket.process like follow-ups — 完结 is
   * part of 处理工单; the data scope inside keeps a frontline CS on their own
   * tickets.
   */
  resolve: requirePermission("ticket.process")
    .input(ticketResolveInputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await resolveTicket(deps, ctx.user, input);
      } catch (error) {
        if (error instanceof TicketNotFoundError) {
          throw new TRPCError({ code: "NOT_FOUND", message: error.message, cause: error });
        }
        if (error instanceof TicketNotResolvableError) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: error.message,
            cause: error,
          });
        }
        if (error instanceof CatalogUnavailableError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
        }
        throw error;
      }
    }),

  /**
   * 编辑工单基本信息 — any status, 已完结 included; status itself
   * is not an editable field. Guarded by ticket.edit; the data scope inside
   * keeps an editor without ticket.view_all on their own tickets.
   */
  edit: requirePermission("ticket.edit")
    .input(ticketEditInputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await editTicket(deps, ctx.user, input);
      } catch (error) {
        if (error instanceof TicketNotFoundError) {
          throw new TRPCError({ code: "NOT_FOUND", message: error.message, cause: error });
        }
        if (error instanceof SlaPolicyNotConfiguredError) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: error.message,
            cause: error,
          });
        }
        if (error instanceof CatalogUnavailableError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
        }
        throw error;
      }
    }),

  /**
   * 删除工单: soft delete — dangerous, double-confirmed in the UI,
   * guarded by ticket.delete. No restore this phase.
   */
  delete: requirePermission("ticket.delete")
    .input(ticketDeleteInputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await deleteTicket(deps, ctx.user, input);
      } catch (error) {
        if (error instanceof TicketNotFoundError) {
          throw new TRPCError({ code: "NOT_FOUND", message: error.message, cause: error });
        }
        throw error;
      }
    }),

  /**
   * 导入历史: the viewer's batches, or every batch with ticket.view_all.
   * Guarded by ticket.import — the history lives inside the import dialog,
   * behind the same entry point as uploading.
   */
  importBatches: requirePermission("ticket.import")
    .input(ticketImportBatchListInputSchema)
    .query(({ ctx, input }) => listImportBatches(deps, ctx.user, input)),

  /**
   * 整批撤销导入: all-or-nothing soft delete of one clean batch — dangerous,
   * double-confirmed in the UI, guarded by ticket.delete like single deletes.
   * A batch with any processed ticket rejects with the count; a revoked batch
   * is final.
   */
  revokeImportBatch: requirePermission("ticket.delete")
    .input(ticketImportRevokeInputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await revokeImportBatch(deps, ctx.user, input);
      } catch (error) {
        if (error instanceof ImportBatchNotFoundError) {
          throw new TRPCError({ code: "NOT_FOUND", message: error.message, cause: error });
        }
        if (
          error instanceof ImportBatchAlreadyRevokedError ||
          error instanceof ImportBatchLockedError
        ) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: error.message,
            cause: error,
          });
        }
        throw error;
      }
    }),

  /**
   * 批量分配: the whole selection to one assignee, all-or-nothing.
   */
  batchAssign: requirePermission("ticket.batch_assign")
    .input(ticketBatchAssignInputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await batchAssignTickets(deps, ctx.user, input);
      } catch (error) {
        mapAssignmentError(error);
      }
    }),

  autoAssign: requireAnyPermission(["ticket.assign", "ticket.batch_assign"])
    .input(ticketAutoAssignInputSchema)
    .mutation(async ({ ctx, input }) => {
      if (input.ticketIds.length > 1 && !ctx.user.permissions.includes("ticket.batch_assign")) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Missing required permission: ticket.batch_assign",
        });
      }
      try {
        return await autoAssignTicketsBySchedule(deps, ctx.user, input);
      } catch (error) {
        mapAssignmentError(error);
      }
    }),

  /**
   * Active users for the 责任人 picker. Either assign permission unlocks it —
   * the dropdown serves both the single and the batch dialog.
   */
  assigneeOptions: requireAnyPermission(["ticket.assign", "ticket.batch_assign"]).query(() =>
    listAssigneeOptions(deps),
  ),
});
