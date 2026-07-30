import { z } from "zod";
import { ticketStatusSchema } from "./enums";

/**
 * 外部工单提交输入：外部用户提交工单原文的唯一必填字段。
 */
export const externalTicketSubmitInputSchema = z.object({
  submissionText: z
    .string()
    .trim()
    .min(1, "提交内容不能为空")
    .max(2000, "提交内容不能超过 2000 字符"),
});

export type ExternalTicketSubmitInput = z.infer<typeof externalTicketSubmitInputSchema>;

/**
 * 外部工单列表输入：支持按状态筛选、搜索、分页。已完结默认不进列表
 * （收件箱只放在途），includeCompleted 或显式 status 筛选可查出——
 * 显式 status 优先于 includeCompleted 缺省。
 */
export const externalTicketListInputSchema = z.object({
  status: z.array(ticketStatusSchema).optional(),
  search: z.string().trim().optional(),
  includeCompleted: z.boolean().default(false),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(100).default(20),
});

export type ExternalTicketListInput = z.infer<typeof externalTicketListInputSchema>;

/**
 * 外部工单详情输入：仅需工单 ID。
 */
export const externalTicketDetailInputSchema = z.object({
  ticketId: z.string().min(1),
});

export type ExternalTicketDetailInput = z.infer<typeof externalTicketDetailInputSchema>;

/**
 * 外部留言输入：外部用户在工单里添加留言。
 */
export const externalTicketAddNoteInputSchema = z.object({
  ticketId: z.string().min(1),
  content: z.string().trim().min(1, "留言内容不能为空").max(2000, "留言内容不能超过 2000 字符"),
});

export type ExternalTicketAddNoteInput = z.infer<typeof externalTicketAddNoteInputSchema>;
