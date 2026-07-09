import { z } from "zod";
import {
  channelSchema,
  complaintLevelSchema,
  nuclearBodyStatusSchema,
  prioritySchema,
  ticketCategorySchema,
  ticketSourceSchema,
} from "./enums";
import { ticketDisplayStatusSchema } from "./ticket-status";

/**
 * Manual ticket-creation contract (PRD §3.1), shared by the web form
 * (react-hook-form resolver) and the API mutation input — one schema, both
 * ends (ADR 0006). System-derived fields (workOrderNumber, source, creatorId,
 * dueAt, followUpFrequency, firstResponseRequirement, status…) are stamped
 * server-side and deliberately absent here.
 */

/** Optional free-text field: empty/whitespace form input becomes NULL, not "". */
const optionalText = z
  .string()
  .trim()
  .max(200)
  .nullish()
  .transform((value) => (value ? value : null));

export const ticketCreateInputSchema = z.object({
  /** 客户实际反馈时间；ISO-8601 绝对时刻（客户端已按本地时区换算）。 */
  feedbackTime: z.string().datetime({ offset: true, message: "请填写反馈时间" }),
  channel: channelSchema,
  project: z.string().trim().min(1, "请填写项目").max(100),
  brokerageEntity: z.string().trim().min(1, "请填写经纪主体").max(100),
  paymentChannel: z.string().trim().min(1, "请填写支付渠道").max(100),
  internalOrderNumber: optionalText,
  policyNumber: z.string().trim().min(1, "请填写保单号").max(100),
  userComplaintChannel: z.string().trim().min(1, "请填写用户投诉渠道").max(100),
  customerName: z.string().trim().min(1, "请填写客户姓名").max(100),
  phone: z.string().trim().min(1, "请填写客户电话").max(50),
  contactPhone: optionalText,
  customerRequest: z.string().trim().min(1, "请填写客户诉求").max(2000),
  nuclearBodyStatus: nuclearBodyStatusSchema,
  hasContacted: z.boolean(),
  contactId: optionalText,
  category: ticketCategorySchema,
  complaintLevel: complaintLevelSchema,
  /** 独立自由标签，默认空（PRD §3.1.5）；"" 来自未选择的下拉框。 */
  priority: prioritySchema
    .or(z.literal(""))
    .nullish()
    .transform((value) => (value ? value : null)),
});

/** Form-side shape (before transforms) — what react-hook-form holds. */
export type TicketCreateInput = z.input<typeof ticketCreateInputSchema>;
/** Server-side shape (after transforms) — what the service receives. */
export type TicketCreateData = z.output<typeof ticketCreateInputSchema>;

/**
 * Assignment contracts (issue #24, PRD §4.3). Only the target is caller-chosen:
 * assignedAt / status / the ProcessLog entries are derived server-side, and
 * dueAt is never touched (ADR 0002). status is deliberately absent everywhere —
 * it moves only through lifecycle actions.
 */
export const ticketAssignInputSchema = z.object({
  ticketId: z.string().min(1),
  assigneeId: z.string().min(1, "请选择责任人"),
});
export type TicketAssignInput = z.infer<typeof ticketAssignInputSchema>;

/** 批量分配单次上限（即列表单页上限）；列表多选与 API 校验共用这一个数。 */
export const BATCH_ASSIGN_LIMIT = 100;

/** 批量分配：多选工单统一分配给同一责任人。 */
export const ticketBatchAssignInputSchema = z.object({
  ticketIds: z
    .array(z.string().min(1))
    .min(1, "请选择工单")
    .max(BATCH_ASSIGN_LIMIT, `一次最多分配 ${BATCH_ASSIGN_LIMIT} 个工单`),
  assigneeId: z.string().min(1, "请选择责任人"),
});
export type TicketBatchAssignInput = z.infer<typeof ticketBatchAssignInputSchema>;

/**
 * 添加跟进 contract (issue #26, PRD §4.4): one remark per actual customer
 * contact, with an optional next-contact plan. contactCount / processingResult
 * / nextContactTime and the assigned → processing transition are all derived
 * server-side from this single action (PRD §3.1.6 单点维护).
 */
export const ticketAddCommentInputSchema = z.object({
  ticketId: z.string().min(1),
  remark: z.string().trim().min(1, "请填写跟进备注").max(2000),
  /**
   * 下次联系时间；ISO-8601 绝对时刻（客户端已按本地时区换算）。每次跟进整体
   * 重写该字段：省略 = 清空上一条跟进留下的计划，而不是保留过期时间。
   */
  nextContactTime: z
    .string()
    .datetime({ offset: true, message: "下次联系时间格式不正确" })
    .nullish()
    .transform((value) => (value ? value : null)),
});

/** Form-side shape (before transforms) — what the follow-up form holds. */
export type TicketAddCommentInput = z.input<typeof ticketAddCommentInputSchema>;
/** Server-side shape (after transforms) — what the service receives. */
export type TicketAddCommentData = z.output<typeof ticketAddCommentInputSchema>;

/** List sort keys (PRD §2.1): 创建时间 / 处理时限. */
export const TICKET_SORT_FIELDS = ["createdAt", "dueAt"] as const;
export const ticketSortFieldSchema = z.enum(TICKET_SORT_FIELDS);
export type TicketSortField = (typeof TICKET_SORT_FIELDS)[number];

/**
 * Ticket-list query contract (issue #23), shared by the list page's filter
 * state and the API input — one schema, both ends (ADR 0006). The 状态 filter
 * accepts all 6 display statuses: computed ones are resolved to SQL predicates
 * server-side (ADR 0001), never stored.
 */
export const ticketListInputSchema = z.object({
  status: ticketDisplayStatusSchema.optional(),
  channel: channelSchema.optional(),
  complaintLevel: complaintLevelSchema.optional(),
  source: ticketSourceSchema.optional(),
  /** 工单号 / 客户姓名 / 保单号；空白输入等同未搜索。 */
  search: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((value) => (value ? value : undefined)),
  sortBy: ticketSortFieldSchema.default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

/** Client-side shape (before defaults/transforms). */
export type TicketListInput = z.input<typeof ticketListInputSchema>;
/** Server-side shape (after defaults/transforms) — what the service receives. */
export type TicketListQuery = z.output<typeof ticketListInputSchema>;
