import {
  ticketAddCommentInputSchema,
  ticketAssignInputSchema,
  ticketBatchAssignInputSchema,
  ticketCreateInputSchema,
  ticketListInputSchema,
} from "@insuredesk/shared";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { systemClock } from "../clock";
import { prisma } from "../db";
import {
  AssigneeNotAssignableError,
  TicketNotAssignableError,
  TicketNotFoundError,
  assignTicket,
  batchAssignTickets,
  listAssigneeOptions,
} from "../services/ticket-assign.service";
import { TicketNotProcessableError, addTicketComment } from "../services/ticket-comment.service";
import {
  SlaPolicyNotConfiguredError,
  createTicket,
  getTicketDetail,
  listTickets,
} from "../services/ticket.service";
import { requireAnyPermission, requirePermission, router } from "../trpc";

/**
 * Ticket routes (issues #22/#23/#24/#26): manual creation, the detail page
 * read, the filterable list, assignment, and follow-ups. Thin wrappers per
 * ADR 0006 — validation via the shared Zod schemas, RBAC via
 * requirePermission, business logic in the ticket services.
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
        throw error;
      }
    }),

  /**
   * Paged, filterable list for 工单管理. Data scope applies: without
   * ticket.view_all the query is pinned to assigneeId = 本人 (PRD §5.2).
   */
  list: requirePermission("ticket.view")
    .input(ticketListInputSchema)
    .query(({ ctx, input }) => listTickets(deps, ctx.user, input)),

  /**
   * Full detail + timeline for the detail page. Data scope applies: without
   * ticket.view_all only own tickets resolve; anything else is NOT_FOUND.
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
   * Assign or reassign one ticket (issue #24). Guarded by ticket.assign —
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
   * 添加跟进备注 (issue #26). Guarded by ticket.process; the data scope inside
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
   * 批量分配: the whole selection to one assignee, all-or-nothing (issue #24).
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

  /**
   * Active users for the 责任人 picker. Either assign permission unlocks it —
   * the dropdown serves both the single and the batch dialog.
   */
  assigneeOptions: requireAnyPermission(["ticket.assign", "ticket.batch_assign"]).query(() =>
    listAssigneeOptions(deps),
  ),
});
