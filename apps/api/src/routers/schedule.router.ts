import {
  scheduleCreateInputSchema,
  scheduleDeleteInputSchema,
  scheduleListInputSchema,
} from "@insuredesk/shared";
import { TRPCError } from "@trpc/server";
import { systemClock } from "../clock";
import { prisma } from "../db";
import {
  DuplicateScheduleError,
  DutyUserNotSchedulableError,
  ScheduleNotFoundError,
  createSchedule,
  deleteSchedule,
  listSchedules,
} from "../services/schedule.service";
import { listAssigneeOptions } from "../services/ticket-assign.service";
import { requirePermission, router } from "../trpc";

/**
 * 排班配置 routes (issue #31): the calendar read and the duty-entry
 * add/remove. Thin wrappers per ADR 0006 — validation via the shared Zod
 * schemas, RBAC via requirePermission (schedule.view to read, schedule.edit
 * to change), business logic in schedule.service.
 */

const deps = { prisma, clock: systemClock };

export const scheduleRouter = router({
  /** One day of the 排班日历 — the 班次 × 渠道 grid data. */
  list: requirePermission("schedule.view")
    .input(scheduleListInputSchema)
    .query(({ input }) => listSchedules(deps, input)),

  /** Put one user on duty for a date × shift × channel cell. */
  create: requirePermission("schedule.edit")
    .input(scheduleCreateInputSchema)
    .mutation(async ({ input }) => {
      try {
        return await createSchedule(deps, input);
      } catch (error) {
        if (error instanceof DutyUserNotSchedulableError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
        }
        if (error instanceof DuplicateScheduleError) {
          throw new TRPCError({ code: "CONFLICT", message: error.message, cause: error });
        }
        throw error;
      }
    }),

  /** Take one duty entry off the roster. */
  delete: requirePermission("schedule.edit")
    .input(scheduleDeleteInputSchema)
    .mutation(async ({ input }) => {
      try {
        return await deleteSchedule(deps, input);
      } catch (error) {
        if (error instanceof ScheduleNotFoundError) {
          throw new TRPCError({ code: "NOT_FOUND", message: error.message, cause: error });
        }
        throw error;
      }
    }),

  /**
   * Active users for the 值班人 picker — the same "active accounts only" list
   * the 责任人 picker uses, re-guarded here for roster editors who hold no
   * assignment permission.
   */
  dutyUserOptions: requirePermission("schedule.edit").query(() => listAssigneeOptions(deps)),
});
