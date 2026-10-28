import { z } from "zod";
import { ticketStatusSchema } from "./enums.ts";
import { ticketExportFormatSchema } from "./ticket.ts";
import { createdRangeFields } from "./time-range.ts";

export const externalTicketSubmitInputSchema = z.object({
  phone: z
    .string()
    .trim()
    .min(1, "请填写投保人手机号")
    .regex(/^1\d{10}$/, "请输入有效的 11 位手机号"),
  submissionText: z
    .string()
    .trim()
    .min(1, "提交内容不能为空")
    .max(2000, "提交内容不能超过 2000 字符"),
});

export type ExternalTicketSubmitInput = z.infer<typeof externalTicketSubmitInputSchema>;

export const externalTicketFindRelatedInputSchema = externalTicketSubmitInputSchema.pick({
  phone: true,
});

export const externalTicketListInputSchema = z.object({
  status: z.array(ticketStatusSchema).optional(),
  search: z.string().trim().optional(),
  ...createdRangeFields,
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(100).default(20),
});

export type ExternalTicketListInput = z.infer<typeof externalTicketListInputSchema>;

/**
 * 导出必须覆盖当前筛选全集，不分页；日期与列表本地时刻一致，非法时区回落 UTC。
 */
export const externalTicketExportInputSchema = externalTicketListInputSchema
  .omit({ offset: true, limit: true })
  .extend({
    format: ticketExportFormatSchema,
    timeZone: z
      .string()
      .trim()
      .max(64)
      .transform((value) => (value ? value : undefined))
      .optional(),
  });

export type ExternalTicketExportQuery = z.output<typeof externalTicketExportInputSchema>;

export const externalTicketDetailInputSchema = z.object({
  ticketId: z.string().min(1),
});

export type ExternalTicketDetailInput = z.infer<typeof externalTicketDetailInputSchema>;

export const externalTicketAddNoteInputSchema = z.object({
  ticketId: z.string().min(1),
  content: z.string().trim().min(1, "留言内容不能为空").max(2000, "留言内容不能超过 2000 字符"),
});

export type ExternalTicketAddNoteInput = z.infer<typeof externalTicketAddNoteInputSchema>;
