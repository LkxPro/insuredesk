import {
  completionStatusCreateInputSchema,
  completionStatusDeleteInputSchema,
  completionStatusSetActiveInputSchema,
  completionStatusUpdateInputSchema,
} from "@insuredesk/shared";
import { TRPCError } from "@trpc/server";
import { prisma } from "../db";
import {
  CompletionStatusInUseError,
  CompletionStatusNameConflictError,
  CompletionStatusNotFoundError,
  createCompletionStatus,
  deleteCompletionStatus,
  listCompletionStatuses,
  listCompletionStatusFilterOptions,
  listCompletionStatusOptions,
  setCompletionStatusActive,
  updateCompletionStatus,
} from "../services/completion-status.service";
import { protectedProcedure, requirePermission, router } from "../trpc";

function translateError(error: unknown): never {
  if (
    error instanceof CompletionStatusNameConflictError ||
    error instanceof CompletionStatusInUseError
  ) {
    throw new TRPCError({ code: "CONFLICT", message: error.message });
  }
  if (error instanceof CompletionStatusNotFoundError) {
    throw new TRPCError({ code: "NOT_FOUND", message: error.message });
  }
  throw error;
}

const manageDictionaryProcedure = requirePermission("dictionary.manage");

export const completionStatusRouter = router({
  list: manageDictionaryProcedure.query(() => listCompletionStatuses(prisma)),
  /** 完结弹窗下拉的数据源：任何登录用户可读，只含启用项。 */
  options: protectedProcedure.query(() => listCompletionStatusOptions(prisma)),
  /** 工单列表筛选的数据源：全目录含停用项，任何登录用户可读。 */
  filterOptions: protectedProcedure.query(() => listCompletionStatusFilterOptions(prisma)),
  create: manageDictionaryProcedure
    .input(completionStatusCreateInputSchema)
    .mutation(async ({ input }) => {
      try {
        return await createCompletionStatus(prisma, input);
      } catch (error) {
        translateError(error);
      }
    }),
  update: manageDictionaryProcedure
    .input(completionStatusUpdateInputSchema)
    .mutation(async ({ input }) => {
      try {
        return await updateCompletionStatus(prisma, input);
      } catch (error) {
        translateError(error);
      }
    }),
  setActive: manageDictionaryProcedure
    .input(completionStatusSetActiveInputSchema)
    .mutation(async ({ input }) => {
      try {
        return await setCompletionStatusActive(prisma, input.id, input.active);
      } catch (error) {
        translateError(error);
      }
    }),
  delete: manageDictionaryProcedure
    .input(completionStatusDeleteInputSchema)
    .mutation(async ({ input }) => {
      try {
        return await deleteCompletionStatus(prisma, input.id);
      } catch (error) {
        translateError(error);
      }
    }),
});
