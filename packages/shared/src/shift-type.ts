import { z } from "zod";

/** Wall-clock time used by shift segments. Overnight segments are valid. */
export const shiftTimeSchema = z
  .string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "时间格式应为 HH:mm");

export const shiftSegmentSchema = z.object({
  start: shiftTimeSchema,
  end: shiftTimeSchema,
});
export type ShiftSegment = z.infer<typeof shiftSegmentSchema>;

const shiftTypeFields = {
  name: z.string().trim().min(1, "请填写班次名称").max(50, "班次名称最多 50 个字符"),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "请选择有效的十六进制颜色"),
  segments: z.array(shiftSegmentSchema),
  displayOrder: z.number().int("显示顺序必须为整数"),
};

export const shiftTypeCreateInputSchema = z.object(shiftTypeFields);
export type ShiftTypeCreateInput = z.infer<typeof shiftTypeCreateInputSchema>;

export const shiftTypeUpdateInputSchema = z.object({
  id: z.string().min(1),
  ...shiftTypeFields,
});
export type ShiftTypeUpdateInput = z.infer<typeof shiftTypeUpdateInputSchema>;

export const shiftTypeDeleteInputSchema = z.object({ id: z.string().min(1) });
export type ShiftTypeDeleteInput = z.infer<typeof shiftTypeDeleteInputSchema>;

export const shiftTypeSegmentsSchema = z.array(shiftSegmentSchema);
