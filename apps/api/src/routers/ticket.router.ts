import {
  editComplaintInputSchema,
  editRefundInputSchema,
  type TicketEditData,
  type TicketEditInput,
  ticketAddCommentInputSchema,
  ticketAssignInputSchema,
  ticketAutoAssignInputSchema,
  ticketBatchAssignInputSchema,
  ticketCreateInputSchema,
  ticketDeleteInputSchema,
  ticketEditInputSchema,
  ticketFindDuplicatesInputSchema,
  ticketImportBatchListInputSchema,
  ticketImportRevokeInputSchema,
  ticketListInputSchema,
  ticketResolveInputSchema,
  ticketUpdateRefundCompensationInputSchema,
} from "@insuredesk/shared";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { systemClock } from "../clock.ts";
import { prisma } from "../db.ts";
import {
  CallbackDeliveryNotDeadError,
  CallbackDeliveryNotFoundError,
  redeliverCallbackDelivery,
} from "../services/callback-delivery.service.ts";
import { CatalogUnavailableError } from "../services/dictionary-catalog.service.ts";
import {
  createTicket,
  getTicketDetail,
  listTickets,
  RequiredFieldsMissingError,
  SlaPolicyNotConfiguredError,
} from "../services/ticket.service.ts";
import {
  AssigneeNotAssignableError,
  AssigneeNotProcessableError,
  assignTicket,
  autoAssignTicketsBySchedule,
  batchAssignTickets,
  listAssigneeOptions,
  TicketNotAssignableError,
  TicketNotFoundError,
} from "../services/ticket-assign.service.ts";
import { addTicketComment, TicketNotProcessableError } from "../services/ticket-comment.service.ts";
import { deleteTicket } from "../services/ticket-delete.service.ts";
import {
  DuplicateTicketsFoundError,
  findDuplicateTickets,
} from "../services/ticket-duplicate.service.ts";
import {
  EditKindMismatchError,
  editComplaint,
  editRefund,
  editTicket,
  RefundCompensationLockedError,
  RefundCompensationNotApplicableError,
  RefundEditRetiredFieldsError,
  updateRefundCompensation,
} from "../services/ticket-edit.service.ts";
import {
  ImportBatchAlreadyRevokedError,
  ImportBatchLockedError,
  ImportBatchNotFoundError,
  listImportBatches,
  revokeImportBatch,
} from "../services/ticket-import-batch.service.ts";
import { resolveTicket, TicketNotResolvableError } from "../services/ticket-resolve.service.ts";
import { requireAnyPermission, requirePermission, router } from "../trpc.ts";

const deps = { prisma, clock: systemClock };

function mapAssignmentError(error: unknown): never {
  if (error instanceof TicketNotFoundError) {
    throw new TRPCError({ code: "NOT_FOUND", message: error.message, cause: error });
  }
  if (error instanceof TicketNotAssignableError) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message, cause: error });
  }
  if (error instanceof AssigneeNotAssignableError || error instanceof AssigneeNotProcessableError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
  }
  throw error;
}

function mapDuplicateError(error: unknown): never {
  if (error instanceof DuplicateTicketsFoundError) {
    throw new TRPCError({ code: "CONFLICT", message: error.message, cause: error });
  }
  throw error;
}

function mapEditError(error: unknown): never {
  if (error instanceof TicketNotFoundError) {
    throw new TRPCError({ code: "NOT_FOUND", message: error.message, cause: error });
  }
  if (
    error instanceof RefundEditRetiredFieldsError ||
    error instanceof EditKindMismatchError ||
    error instanceof CatalogUnavailableError
  ) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
  }
  if (error instanceof SlaPolicyNotConfiguredError) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: error.message,
      cause: error,
    });
  }
  mapDuplicateError(error);
}

/**
 * 旧统一端点的退役键检测：zod 解析后「键缺席」与「键值为 null」无法区分，
 * 故 preprocess 先截获原始键集。preprocess 的 input 推断为 unknown，显式
 * 标注 ZodType 保住客户端入参类型。
 */
type LegacyEditPayload = TicketEditInput & { allowDuplicate?: boolean };
const legacyTicketEditInputSchema = z.preprocess(
  (raw) => ({
    data: raw,
    presentKeys: raw !== null && typeof raw === "object" ? Object.keys(raw) : [],
  }),
  z.object({
    data: ticketEditInputSchema.extend({ allowDuplicate: z.boolean().optional() }),
    presentKeys: z.array(z.string()),
  }),
) as unknown as z.ZodType<
  { data: TicketEditData & { allowDuplicate?: boolean }; presentKeys: string[] },
  LegacyEditPayload
>;

export const ticketRouter = router({
  create: requirePermission("ticket.create")
    .input(ticketCreateInputSchema.extend({ allowDuplicate: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const { allowDuplicate, ...data } = input;
        const ticket = await createTicket(deps, ctx.user, data, { allowDuplicate });
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
        mapDuplicateError(error);
      }
    }),

  findDuplicates: requirePermission("ticket.view")
    .input(ticketFindDuplicatesInputSchema)
    .query(({ input }) => findDuplicateTickets(deps, input)),

  list: requirePermission("ticket.view")
    .input(ticketListInputSchema)
    .query(({ ctx, input }) => listTickets(deps, ctx.user, input)),

  detail: requirePermission("ticket.view")
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const detail = await getTicketDetail(deps, ctx.user, input.id);
      if (detail === null) {
        throw new TRPCError({ code: "NOT_FOUND", message: "工单不存在或无权查看" });
      }
      return detail;
    }),

  assign: requirePermission("ticket.assign")
    .input(ticketAssignInputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await assignTicket(deps, ctx.user, input);
      } catch (error) {
        mapAssignmentError(error);
      }
    }),

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

  redeliverCallback: requirePermission("ticket.process")
    .input(z.object({ deliveryId: z.string().min(1) }))
    .mutation(async ({ input }) => {
      try {
        const row = await redeliverCallbackDelivery(deps, input.deliveryId);
        return { id: row.id, status: row.status };
      } catch (error) {
        if (error instanceof CallbackDeliveryNotFoundError) {
          throw new TRPCError({ code: "NOT_FOUND", message: error.message, cause: error });
        }
        if (error instanceof CallbackDeliveryNotDeadError) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: error.message,
            cause: error,
          });
        }
        throw error;
      }
    }),

  edit: requirePermission("ticket.edit")
    .input(legacyTicketEditInputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        const { allowDuplicate, ...data } = input.data;
        return await editTicket(deps, ctx.user, data, {
          allowDuplicate,
          presentKeys: input.presentKeys,
        });
      } catch (error) {
        mapEditError(error);
      }
    }),

  editComplaint: requirePermission("ticket.edit")
    .input(editComplaintInputSchema.extend({ allowDuplicate: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const { allowDuplicate, ...data } = input;
        return await editComplaint(deps, ctx.user, data, { allowDuplicate });
      } catch (error) {
        mapEditError(error);
      }
    }),

  editRefund: requirePermission("ticket.edit")
    .input(editRefundInputSchema.extend({ allowDuplicate: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      try {
        const { allowDuplicate, ...data } = input;
        return await editRefund(deps, ctx.user, data, { allowDuplicate });
      } catch (error) {
        mapEditError(error);
      }
    }),

  updateRefundCompensation: requirePermission("ticket.process")
    .input(ticketUpdateRefundCompensationInputSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await updateRefundCompensation(deps, ctx.user, input);
      } catch (error) {
        if (error instanceof TicketNotFoundError) {
          throw new TRPCError({ code: "NOT_FOUND", message: error.message, cause: error });
        }
        if (error instanceof RefundCompensationNotApplicableError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
        }
        if (error instanceof RefundCompensationLockedError) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: error.message,
            cause: error,
          });
        }
        throw error;
      }
    }),

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

  importBatches: requirePermission("ticket.import")
    .input(ticketImportBatchListInputSchema)
    .query(({ ctx, input }) => listImportBatches(deps, ctx.user, input)),

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

  assigneeOptions: requireAnyPermission(["ticket.assign", "ticket.batch_assign"]).query(() =>
    listAssigneeOptions(deps),
  ),
});
