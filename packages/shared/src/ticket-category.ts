import { z } from "zod";

/**
 * 客诉类别目录 contracts (issue #68). Tickets reference catalog rows by id, so
 * a rename propagates everywhere at read time; only the ProcessLog remark
 * keeps the literal name snapshot of the moment.
 */

const ticketCategoryFields = {
  name: z.string().trim().min(1, "请填写类别名称").max(50, "类别名称最多 50 个字符"),
  displayOrder: z.number().int("显示顺序必须为整数"),
};

export const ticketCategoryCreateInputSchema = z.object(ticketCategoryFields);
export type TicketCategoryCreateInput = z.infer<typeof ticketCategoryCreateInputSchema>;

export const ticketCategoryUpdateInputSchema = z.object({
  id: z.string().min(1),
  ...ticketCategoryFields,
});
export type TicketCategoryUpdateInput = z.infer<typeof ticketCategoryUpdateInputSchema>;

export const ticketCategorySetActiveInputSchema = z.object({
  id: z.string().min(1),
  active: z.boolean(),
});
export type TicketCategorySetActiveInput = z.infer<typeof ticketCategorySetActiveInputSchema>;

export const ticketCategoryDeleteInputSchema = z.object({ id: z.string().min(1) });
export type TicketCategoryDeleteInput = z.infer<typeof ticketCategoryDeleteInputSchema>;
