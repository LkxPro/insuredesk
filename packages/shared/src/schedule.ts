import { z } from "zod";

/** A calendar day in local wall-clock form. */
export const scheduleDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式应为 YYYY-MM-DD")
  .refine((value) => {
    const [year = 0, month = 0, day = 0] = value.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return (
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day
    );
  }, "不是有效的日期");

/** The grid fetches all schedule cells in an inclusive wall-clock date range. */
export const scheduleListInputSchema = z
  .object({
    startDate: scheduleDateSchema,
    endDate: scheduleDateSchema,
  })
  .refine(({ startDate, endDate }) => startDate <= endDate, {
    message: "开始日期不能晚于结束日期",
    path: ["endDate"],
  });
export type ScheduleListInput = z.infer<typeof scheduleListInputSchema>;

/** Set (or replace) the single shift assigned to one user/day grid cell. */
export const scheduleCreateInputSchema = z.object({
  date: scheduleDateSchema,
  userId: z.string().min(1, "请选择客服人员"),
  shiftId: z.string().min(1, "请选择班次"),
  remark: z
    .string()
    .trim()
    .max(200, "备注最多 200 个字符")
    .nullish()
    .transform((value) => value || null),
});
export type ScheduleCreateInput = z.input<typeof scheduleCreateInputSchema>;
export type ScheduleCreateData = z.output<typeof scheduleCreateInputSchema>;

export const scheduleDeleteInputSchema = z.object({ id: z.string().min(1) });
export type ScheduleDeleteInput = z.infer<typeof scheduleDeleteInputSchema>;
