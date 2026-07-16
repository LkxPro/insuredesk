import {
  ticketCategoryCreateInputSchema,
  ticketCategoryDeleteInputSchema,
  ticketCategorySetActiveInputSchema,
  ticketCategoryUpdateInputSchema,
} from "@insuredesk/shared";
import { TRPCError } from "@trpc/server";
import { prisma } from "../db";
import {
  createTicketCategory,
  deleteTicketCategory,
  listTicketCategories,
  listTicketCategoryOptions,
  setTicketCategoryActive,
  TicketCategoryInUseError,
  TicketCategoryNameConflictError,
  TicketCategoryNotFoundError,
  updateTicketCategory,
} from "../services/ticket-category.service";
import { protectedProcedure, requirePermission, router } from "../trpc";

function translateError(error: unknown): never {
  if (
    error instanceof TicketCategoryNameConflictError ||
    error instanceof TicketCategoryInUseError
  ) {
    throw new TRPCError({ code: "CONFLICT", message: error.message });
  }
  if (error instanceof TicketCategoryNotFoundError) {
    throw new TRPCError({ code: "NOT_FOUND", message: error.message });
  }
  throw error;
}

const manageDictionaryProcedure = requirePermission("dictionary.manage");

export const ticketCategoryRouter = router({
  list: manageDictionaryProcedure.query(() => listTicketCategories(prisma)),
  /** 建单/编辑下拉的数据源：任何登录用户可读，只含启用项。 */
  options: protectedProcedure.query(() => listTicketCategoryOptions(prisma)),
  create: manageDictionaryProcedure
    .input(ticketCategoryCreateInputSchema)
    .mutation(async ({ input }) => {
      try {
        return await createTicketCategory(prisma, input);
      } catch (error) {
        translateError(error);
      }
    }),
  update: manageDictionaryProcedure
    .input(ticketCategoryUpdateInputSchema)
    .mutation(async ({ input }) => {
      try {
        return await updateTicketCategory(prisma, input);
      } catch (error) {
        translateError(error);
      }
    }),
  setActive: manageDictionaryProcedure
    .input(ticketCategorySetActiveInputSchema)
    .mutation(async ({ input }) => {
      try {
        return await setTicketCategoryActive(prisma, input.id, input.active);
      } catch (error) {
        translateError(error);
      }
    }),
  delete: manageDictionaryProcedure
    .input(ticketCategoryDeleteInputSchema)
    .mutation(async ({ input }) => {
      try {
        return await deleteTicketCategory(prisma, input.id);
      } catch (error) {
        translateError(error);
      }
    }),
});
