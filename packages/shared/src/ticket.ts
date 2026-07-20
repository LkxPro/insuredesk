import { z } from "zod";
import {
  complaintLevelSchema,
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

/**
 * 建单自由文本字段的长度上限，建单/编辑 schema 与批量导入逐行校验共用 ——
 * 导入的每列长度检查引用这里，不另抄一份。
 */
export const TICKET_TEXT_LIMITS = {
  project: 100,
  brokerageEntity: 100,
  paymentChannel: 100,
  internalOrderNumber: 200,
  policyNumber: 100,
  userComplaintChannel: 100,
  customerName: 100,
  phone: 50,
  contactPhone: 200,
  customerRequest: 2000,
  contactId: 200,
} as const;

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
  project: optionalText(TICKET_TEXT_LIMITS.project),
  brokerageEntity: optionalText(TICKET_TEXT_LIMITS.brokerageEntity),
  paymentChannel: optionalText(TICKET_TEXT_LIMITS.paymentChannel),
  internalOrderNumber: optionalText(TICKET_TEXT_LIMITS.internalOrderNumber),
  policyNumber: optionalText(TICKET_TEXT_LIMITS.policyNumber),
  userComplaintChannel: optionalText(TICKET_TEXT_LIMITS.userComplaintChannel),
  customerName: optionalText(TICKET_TEXT_LIMITS.customerName),
  phone: optionalText(TICKET_TEXT_LIMITS.phone),
  contactPhone: optionalText(TICKET_TEXT_LIMITS.contactPhone),
  customerRequest: optionalText(TICKET_TEXT_LIMITS.customerRequest),
  nuclearBodyStatus: optionalEnum(nuclearBodyStatusSchema),
  /** 三态：true/false/未知（null）。 */
  hasContacted: z
    .boolean()
    .nullish()
    .transform((value) => value ?? null),
  contactId: optionalText(TICKET_TEXT_LIMITS.contactId),
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

/** 批量导入单次行数上限（不含表头）；模板填写说明与上传校验共用这一个数。 */
export const TICKET_IMPORT_ROW_LIMIT = 2000;

/** 批量导入文件大小上限；前端提示与服务端 multipart 限制共用这一个数。 */
export const TICKET_IMPORT_MAX_FILE_BYTES = 2 * 1024 * 1024;

/**
 * 批量导入 REST 响应契约（/api/tickets/import）。全或无：任一行有错则整批
 * 零入库，携带逐行错误清单；行号为文件内 Excel 行号（表头是第 1 行），
 * 文件级错误（表头不符、超行数上限等）row/column 为 null。
 */
export interface TicketImportRowError {
  row: number | null;
  /** 模板中文列名；不属于某一列的错误为 null。 */
  column: string | null;
  message: string;
}

export interface TicketImportSuccess {
  imported: number;
}

export interface TicketImportFailure {
  error: string;
  rowErrors: TicketImportRowError[];
}

/**
 * 导入历史批次状态，读取时派生、从不存储：
 * - revocable 可撤销：批内没有晚于导入瞬间的处理记录且无单被单独删除；与
 *   导入同瞬间的日志属于导入本身，不算处理
 * - locked 已锁定：任一单存在晚于导入瞬间的处理（分配/跟进/编辑/完结/上传）
 *   或已被单独删除 —— 干净判定本身即撤销窗口，无时间窗
 * - revoked 已撤销：整批已软删除，终态（本期无恢复，不可再次撤销）
 */
export const TICKET_IMPORT_BATCH_STATUSES = ["revocable", "locked", "revoked"] as const;
export const ticketImportBatchStatusSchema = z.enum(TICKET_IMPORT_BATCH_STATUSES);
export type TicketImportBatchStatus = (typeof TICKET_IMPORT_BATCH_STATUSES)[number];

export const TICKET_IMPORT_BATCH_STATUS_LABELS: Record<TicketImportBatchStatus, string> = {
  revocable: "可撤销",
  locked: "已锁定",
  revoked: "已撤销",
};

/** 导入历史 list contract; scope is server-side (own batches unless ticket.view_all). */
export const ticketImportBatchListInputSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(50),
});
export type TicketImportBatchListInput = z.input<typeof ticketImportBatchListInputSchema>;
export type TicketImportBatchListQuery = z.output<typeof ticketImportBatchListInputSchema>;

/**
 * 整批撤销 contract: all-or-nothing soft delete of one clean batch — the
 * server re-checks cleanliness inside the same transaction and rejects the
 * whole batch if any ticket has been processed or individually deleted.
 */
export const ticketImportRevokeInputSchema = z.object({
  batchId: z.string().min(1),
});
export type TicketImportRevokeInput = z.infer<typeof ticketImportRevokeInputSchema>;

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
 * 完结工单 contract: the mandatory completion reason — a 完结状态目录 reference,
 * which must exist and be 启用 — plus the 完结备注 that becomes the resolve
 * log's remark. completionTime / the → completed transition and its ProcessLog
 * pair are derived server-side; completed is a 终态.
 */
export const ticketResolveInputSchema = z.object({
  ticketId: z.string().min(1),
  completionStatusId: z.string().min(1, "请选择完结状态"),
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
  /** 完结状态目录引用筛选；停用状态也可选，仍能查到其存量工单。 */
  completionStatusId: z.string().min(1).optional(),
  complaintLevel: complaintLevelSchema.optional(),
  source: ticketSourceSchema.optional(),
  /** 工单号 / 客户姓名 / 保单号；空白输入等同未搜索。 */
  search: z
    .string()
    .trim()
    .max(100)
    .transform((value) => (value ? value : undefined))
    .optional(),
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
      .transform((value) => (value ? value : undefined))
      .optional(),
  });

/** Client-side shape (before defaults/transforms). */
export type TicketExportInput = z.input<typeof ticketExportInputSchema>;
/** Server-side shape (after defaults/transforms) — what the service receives. */
export type TicketExportQuery = z.output<typeof ticketExportInputSchema>;
