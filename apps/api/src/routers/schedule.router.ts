import {
  scheduleCreateInputSchema,
  scheduleDeleteInputSchema,
  scheduleListInputSchema,
} from "@insuredesk/shared";
import { TRPCError } from "@trpc/server";
import { prisma } from "../db.ts";
import {
  createSchedule,
  DutyUserNotSchedulableError,
  deleteSchedule,
  listSchedules,
  ScheduleNotFoundError,
  ScheduleShiftNotFoundError,
} from "../services/schedule.service.ts";
import { requirePermission, router } from "../trpc.ts";

function mapWriteError(error: unknown): never {
  if (error instanceof DutyUserNotSchedulableError || error instanceof ScheduleShiftNotFoundError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
  }
  if (error instanceof ScheduleNotFoundError) {
    throw new TRPCError({ code: "NOT_FOUND", message: error.message, cause: error });
  }
  throw error;
}

export const scheduleRouter = router({
  list: requirePermission("schedule.view")
    .input(scheduleListInputSchema)
    .query(({ input }) => listSchedules(prisma, input)),
  create: requirePermission("schedule.edit")
    .input(scheduleCreateInputSchema)
    .mutation(async ({ input }) => {
      try {
        return await createSchedule(prisma, input);
      } catch (error) {
        mapWriteError(error);
      }
    }),
  delete: requirePermission("schedule.edit")
    .input(scheduleDeleteInputSchema)
    .mutation(async ({ input }) => {
      try {
        return await deleteSchedule(prisma, input);
      } catch (error) {
        mapWriteError(error);
      }
    }),
});
