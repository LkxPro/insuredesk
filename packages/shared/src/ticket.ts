import { z } from "zod";
import {
  complaintLevelSchema,
  completionStatusSchema,
  nuclearBodyStatusSchema,
  prioritySchema,
  ticketSourceSchema,
} from "./enums";
import { ticketDisplayStatusSchema } from "./ticket-status";

/**
 * Manual ticket-creation contract, shared by the web form (react-hook-form
 * resolver) and the API mutation input — one schema, both ends.
 * System-derived fields (workOrderNumber, source, creatorId, dueAt,
 * followUpFrequency, firstResponseRequirement, status…) are stamped
 * server-side and deliberately absent here.
 *
 * Every user-entered field is optional: a fully blank form is a valid
 * submission, and anything unfilled persists as NULL — "unknown", never
 * "" or an assumed value. hasContacted unfilled means 未知, not false.
 */

/** Optional free-text field: empty/whitespace form input becomes NULL, not "". */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));

/** Optional enum select: "" (nothing chosen) and absence both become NULL. */
const optionalEnum = <T extends z.ZodTypeAny>(schema: T) =>
  schema
    .or(z.literal(""))
    .nullish()
    .transform((value): z.output<T> | null => (value ? value : null));

/**
 * 建单表单字段清单，从建单 schema 派生——合法字段域，前后端共用。
 * 顺序与表单呈现一致；角色可配置必填集时，校验每个 key 属于此清单。
 */
export const TICKET_CREATE_FIELD_KEYS = [
  "feedbackTime",
  "channelId",
  "project",
  "brokerageEntity",
  "paymentChannel",
  "internalOrderNumber",
  "policyNumber",
  "userComplaintChannel",
  "customerName",
  "phone",
  "contactPhone",
  "customerRequest",
  "nuclearBodyStatus",
  "hasContacted",
  "contactId",
  "categoryId",
  "complaintLevel",
  "priority",
] as const;

export type TicketCreateFieldKey = (typeof TICKET_CREATE_FIELD_KEYS)[number];

export const ticketCreateInputSchema = z.object({
  /** 客户实际反馈时间；ISO-8601 绝对时刻（客户端已按本地时区换算）。 */
  feedbackTime: optionalEnum(z.string().datetime({ offset: true, message: "反馈时间格式不正确" })),
  /** 反馈渠道目录引用；null = 未填写。目录项须存在且启用（编辑保持原值除外）。 */
  channelId: optionalText(100),
  project: optionalText(100),
  brokerageEntity: optionalText(100),
  paymentChannel: optionalText(100),
  internalOrderNumber: optionalText(200),
  policyNumber: optionalText(100),
  userComplaintChannel: optionalText(100),
  customerName: optionalText(100),
  phone: optionalText(50),
  contactPhone: optionalText(200),
  customerRequest: optionalText(2000),
  nuclearBodyStatus: optionalEnum(nuclearBodyStatusSchema),
  /** 三态：true/false/未知（null）。 */
  hasContacted: z
    .boolean()
    .nullish()
    .transform((value) => value ?? null),
  contactId: optionalText(200),
  /** 客诉类别目录引用；null = 未填写。目录项须存在且启用（编辑保持原值除外）。 */
  categoryId: optionalText(100),
  complaintLevel: optionalEnum(complaintLevelSchema),
  /** 独立自由标签，默认空；"" 来自未选择的下拉框。 */
  priority: optionalEnum(prioritySchema),
});

/** Form-side shape (before transforms) — what react-hook-form holds. */
export type TicketCreateInput = z.input<typeof ticketCreateInputSchema>;
/** Server-side shape (after transforms) — what the service receives. */
export type TicketCreateData = z.output<typeof ticketCreateInputSchema>;

/**
 * 编辑工单 contract: every basic-info field — the same set the creation form
 * collects — editable in any status, 已完结 included. status is deliberately
 * absent: it moves only through lifecycle actions, and editing can never
 * reopen a completed ticket. System-derived fields (dueAt, followUpFrequency,
 * firstResponseRequirement…) stay server-stamped — a complaintLevel change
 * recomputes them from the new level's SLA policy.
 */
export const ticketEditInputSchema = ticketCreateInputSchema.extend({
  ticketId: z.string().min(1),
});

/** Form-side shape (before transforms) — what the edit form holds. */
export type TicketEditInput = z.input<typeof ticketEditInputSchema>;
/** Server-side shape (after transforms) — what the service receives. */
export type TicketEditData = z.output<typeof ticketEditInputSchema>;

/**
 * 删除工单 contract: a dangerous, UI-double-confirmed soft delete — the
 * server stamps deletedAt, nothing is physically removed, and this phase
 * offers no restore.
 */
export const ticketDeleteInputSchema = z.object({
  ticketId: z.string().min(1),
});
export type TicketDeleteInput = z.infer<typeof ticketDeleteInputSchema>;

/**
 * Assignment contracts. Only the target is caller-chosen: assignedAt / status
 * / the ProcessLog entries are derived server-side, and dueAt is never
 * touched. status is deliberately absent everywhere — it moves only through
 * lifecycle actions.
 */
export const ticketAssignInputSchema = z.object({
  ticketId: z.string().min(1),
  assigneeId: z.string().min(1, "请选择责任人"),
});
export type TicketAssignInput = z.infer<typeof ticketAssignInputSchema>;

/** 批量分配单次上限（即列表单页上限）；列表多选与 API 校验共用这一个数。 */
export const BATCH_ASSIGN_LIMIT = 100;

const ticketIdsSchema = z
  .array(z.string().min(1))
  .min(1, "请选择工单")
  .max(BATCH_ASSIGN_LIMIT, `一次最多分配 ${BATCH_ASSIGN_LIMIT} 个工单`);

export const ticketBatchAssignInputSchema = z.object({
  ticketIds: ticketIdsSchema,
  assigneeId: z.string().min(1, "请选择责任人"),
});
export type TicketBatchAssignInput = z.infer<typeof ticketBatchAssignInputSchema>;

/**
 * Supervisor-triggered assignment from the current on-duty schedule. The
 * candidate set is global (not channel-specific); the system chooses the
 * least-loaded person for each unassigned ticket.
 */
export const ticketAutoAssignInputSchema = z.object({
  ticketIds: ticketIdsSchema,
});
export type TicketAutoAssignInput = z.infer<typeof ticketAutoAssignInputSchema>;

/**
 * 添加跟进 contract: one remark per actual customer contact, with an optional
 * next-contact plan. contactCount / processingResult / nextContactTime and
 * the assigned → processing transition are all derived server-side from this
 * single action.
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

/**
 * 完结工单 contract: the mandatory completion reason — one of the 12 封闭枚举,
 * no "其他" — plus the 完结备注 that becomes the resolve log's remark.
 * completionTime / the → completed transition and its ProcessLog pair are
 * derived server-side; completed is a 终态.
 */
export const ticketResolveInputSchema = z.object({
  ticketId: z.string().min(1),
  completionStatus: completionStatusSchema,
  remark: z.string().trim().min(1, "请填写完结备注").max(2000),
});
export type TicketResolveInput = z.infer<typeof ticketResolveInputSchema>;

/** List sort keys: 创建时间 / 处理时限. */
export const TICKET_SORT_FIELDS = ["createdAt", "dueAt"] as const;
export const ticketSortFieldSchema = z.enum(TICKET_SORT_FIELDS);
export type TicketSortField = (typeof TICKET_SORT_FIELDS)[number];

/**
 * Ticket-list query contract, shared by the list page's filter state and the
 * API input — one schema, both ends. The 状态 filter accepts all 6 display
 * statuses: computed ones are resolved to SQL predicates server-side, never
 * stored.
 */
export const ticketListInputSchema = z.object({
  status: ticketDisplayStatusSchema.optional(),
  /** 渠道目录引用筛选；停用渠道也可选，仍能查到其存量工单。 */
  channelId: z.string().min(1).optional(),
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

export const TICKET_EXPORT_FORMATS = ["xlsx", "csv"] as const;
export const ticketExportFormatSchema = z.enum(TICKET_EXPORT_FORMATS);
export type TicketExportFormat = (typeof TICKET_EXPORT_FORMATS)[number];

/**
 * 导出工单 contract: the list's filter/sort set — pagination deliberately
 * absent, an export always covers *every* matching row — plus the file
 * format and the viewer's IANA time zone. Date columns are formatted
 * server-side, so the client sends its zone to keep the file consistent with
 * what the list page shows (local-time display convention); absent or invalid
 * zones fall back to UTC rather than failing the download.
 */
export const ticketExportInputSchema = ticketListInputSchema
  .omit({ page: true, pageSize: true })
  .extend({
    format: ticketExportFormatSchema,
    timeZone: z
      .string()
      .trim()
      .max(64)
      .optional()
      .transform((value) => (value ? value : undefined)),
  });

/** Client-side shape (before defaults/transforms). */
export type TicketExportInput = z.input<typeof ticketExportInputSchema>;
/** Server-side shape (after defaults/transforms) — what the service receives. */
export type TicketExportQuery = z.output<typeof ticketExportInputSchema>;
