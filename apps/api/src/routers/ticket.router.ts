import { ticketCreateInputSchema } from "@insuredesk/shared";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { systemClock } from "../clock";
import { prisma } from "../db";
import {
  SlaPolicyNotConfiguredError,
  createTicket,
  getTicketDetail,
} from "../services/ticket.service";
import { requirePermission, router } from "../trpc";

/**
 * Ticket routes (issue #22): manual creation and the detail page read.
 * Thin wrappers per ADR 0006 — validation via the shared Zod schema, RBAC via
 * requirePermission, business logic in ticket.service.
 */

const deps = { prisma, clock: systemClock };

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
});
