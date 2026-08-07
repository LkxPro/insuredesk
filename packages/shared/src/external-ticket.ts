import { z } from "zod";
import { ticketStatusSchema } from "./enums";
import { ticketExportFormatSchema } from "./ticket";

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
 * 外部工单列表输入：支持按状态、完结状态、反馈时间范围、授权字段搜索、
 * 排序和分页。默认覆盖全部状态与全部反馈时间，按反馈时间倒序。
 */
export const EXTERNAL_TICKET_SORT_FIELDS = [
  "feedbackTime",
  "status",
  "completionStatus",
  "latestActivityAt",
] as const;
export const externalTicketSortFieldSchema = z.enum(EXTERNAL_TICKET_SORT_FIELDS);
export type ExternalTicketSortField = (typeof EXTERNAL_TICKET_SORT_FIELDS)[number];

const optionalDateTime = z
  .string()
  .datetime({ offset: true, message: "反馈时间格式不正确" })
  .optional();

export const externalTicketListInputSchema = z.object({
  status: z.array(ticketStatusSchema).optional(),
  search: z.string().trim().optional(),
  completionStatusId: z.array(z.string().min(1)).optional(),
  feedbackFrom: optionalDateTime,
  feedbackTo: optionalDateTime,
  sortBy: externalTicketSortFieldSchema.default("feedbackTime"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  /** Legacy compatibility; false remains an explicit exclude-completed filter. */
  includeCompleted: z.boolean().default(true),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(100).default(20),
});

export type ExternalTicketListInput = z.infer<typeof externalTicketListInputSchema>;

export const externalTicketUpdatePreferencesInputSchema = z.object({
  surface: z.enum(["list", "export"]),
  fields: z.array(z.string().min(1)).max(100),
});

export type ExternalTicketUpdatePreferencesInput = z.infer<
  typeof externalTicketUpdatePreferencesInputSchema
>;

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
