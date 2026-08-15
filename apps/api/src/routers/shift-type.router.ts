import {
  shiftTypeCreateInputSchema,
  shiftTypeDeleteInputSchema,
  shiftTypeUpdateInputSchema,
} from "@insuredesk/shared";
import { TRPCError } from "@trpc/server";
import { prisma } from "../db.ts";
import {
  createShiftType,
  deleteShiftType,
  listShiftTypes,
  ShiftTypeInUseError,
  ShiftTypeNameConflictError,
  ShiftTypeNotFoundError,
  updateShiftType,
} from "../services/shift-type.service.ts";
import { requirePermission, router } from "../trpc.ts";

function translateError(error: unknown): never {
  if (error instanceof ShiftTypeNameConflictError || error instanceof ShiftTypeInUseError) {
    throw new TRPCError({ code: "CONFLICT", message: error.message });
  }
  if (error instanceof ShiftTypeNotFoundError) {
    throw new TRPCError({ code: "NOT_FOUND", message: error.message });
  }
  throw error;
}

const manageShiftTypesProcedure = requirePermission("schedule.manage_shifts");

export const shiftTypeRouter = router({
  list: manageShiftTypesProcedure.query(() => listShiftTypes(prisma)),
  create: manageShiftTypesProcedure
    .input(shiftTypeCreateInputSchema)
    .mutation(async ({ input }) => {
      try {
        return await createShiftType(prisma, input);
      } catch (error) {
        translateError(error);
      }
    }),
  update: manageShiftTypesProcedure
    .input(shiftTypeUpdateInputSchema)
    .mutation(async ({ input }) => {
      try {
        return await updateShiftType(prisma, input);
      } catch (error) {
        translateError(error);
      }
    }),
  delete: manageShiftTypesProcedure
    .input(shiftTypeDeleteInputSchema)
    .mutation(async ({ input }) => {
      try {
        return await deleteShiftType(prisma, input.id);
      } catch (error) {
        translateError(error);
      }
    }),
});
