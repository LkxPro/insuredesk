import { z } from "zod";
import { ticketStatusSchema } from "./enums";
import { ticketExportFormatSchema } from "./ticket";
import { createdRangeFields } from "./time-range";

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
 * 外部工单列表输入：支持按状态筛选、搜索、创建时间区间、分页。
 * 搜索域：工单号 / 工单原文 / 保单号。
 */
export const externalTicketListInputSchema = z.object({
  status: z.array(ticketStatusSchema).optional(),
  search: z.string().trim().optional(),
  ...createdRangeFields,
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(100).default(20),
});

export type ExternalTicketListInput = z.infer<typeof externalTicketListInputSchema>;

/**
 * 外部导出 contract：列表的筛选集 —— 翻页参数刻意缺席，导出一份当前筛选
 * 结果全集 —— 加文件格式与浏览器 IANA 时区（日期列服务端格式化，与列表
 * 本地时刻口径一致；非法时区回落 UTC 而不是让下载失败）。
 * querystring 是扁平字符串：status 逗号分隔（路由层拆分）。
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
