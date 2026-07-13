import { z } from "zod";
import { type Shift, channelSchema, shiftSchema } from "./enums";

/**
 * 排班 contracts, shared by the 排班配置 page and the API — one schema, both
 * ends. A schedule entry is a wall-clock roster fact (date + shift window in
 * the server's local timezone), so date and times travel as plain strings,
 * never as instants.
 */

/** Shift windows — the single source for stamped times. */
export const SHIFT_TIMES: Record<Shift, { startTime: string; endTime: string }> = {
  day: { startTime: "09:00", endTime: "18:00" },
  night: { startTime: "12:00", endTime: "21:00" },
};

export const SHIFT_LABELS: Record<Shift, string> = {
  day: "早班",
  night: "晚班",
};

/** Duty day as the calendar sees it; rejects well-formed non-dates (2026-02-31). */
export const scheduleDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式应为 YYYY-MM-DD")
  .refine((value) => {
    // Date would silently roll 2026-02-31 over to 2026-03-03 — round-trip the
    // components to reject impossible calendar dates
    const [year = 0, month = 0, day = 0] = value.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return (
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day
    );
  }, "不是有效的日期");

/** 排班日历 reads one day at a time — the grid shows 班次 × 渠道 for a date. */
export const scheduleListInputSchema = z.object({
  date: scheduleDateSchema,
});
export type ScheduleListInput = z.infer<typeof scheduleListInputSchema>;

/**
 * Add one on-duty entry. startTime/endTime are deliberately absent: the window
 * is stamped server-side from the shift type, so a roster row can never
 * disagree with its shift's hours.
 */
export const scheduleCreateInputSchema = z.object({
  date: scheduleDateSchema,
  shift: shiftSchema,
  channel: channelSchema,
  userId: z.string().min(1, "请选择值班人"),
  remark: z
    .string()
    .trim()
    .max(200)
    .nullish()
    .transform((value) => (value ? value : null)),
});
/** Form-side shape (before transforms). */
export type ScheduleCreateInput = z.input<typeof scheduleCreateInputSchema>;
/** Server-side shape (after transforms) — what the service receives. */
export type ScheduleCreateData = z.output<typeof scheduleCreateInputSchema>;

export const scheduleDeleteInputSchema = z.object({
  id: z.string().min(1),
});
export type ScheduleDeleteInput = z.infer<typeof scheduleDeleteInputSchema>;
