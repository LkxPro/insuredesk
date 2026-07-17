import { z } from "zod";

/**
 * 完结状态目录 contracts (issue #86). Tickets reference catalog rows by id, so
 * a rename propagates everywhere at read time; only the ProcessLog remark
 * keeps the literal name snapshot of the moment.
 */

const completionStatusFields = {
  name: z.string().trim().min(1, "请填写状态名称").max(50, "状态名称最多 50 个字符"),
  displayOrder: z.number().int("显示顺序必须为整数"),
};

export const completionStatusCreateInputSchema = z.object(completionStatusFields);
export type CompletionStatusCreateInput = z.infer<typeof completionStatusCreateInputSchema>;

export const completionStatusUpdateInputSchema = z.object({
  id: z.string().min(1),
  ...completionStatusFields,
});
export type CompletionStatusUpdateInput = z.infer<typeof completionStatusUpdateInputSchema>;

export const completionStatusSetActiveInputSchema = z.object({
  id: z.string().min(1),
  active: z.boolean(),
});
export type CompletionStatusSetActiveInput = z.infer<typeof completionStatusSetActiveInputSchema>;

export const completionStatusDeleteInputSchema = z.object({ id: z.string().min(1) });
export type CompletionStatusDeleteInput = z.infer<typeof completionStatusDeleteInputSchema>;
