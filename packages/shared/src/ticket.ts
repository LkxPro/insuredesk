import { z } from "zod";
import {
  DEFAULT_TICKET_SOURCE_FILTER,
  nuclearBodyStatusSchema,
  prioritySchema,
  ticketSourceSchema,
} from "./enums.ts";
import { REFUND_AMOUNT_PATTERN } from "./refund-push.ts";
import {
  normalizePolicyNumbers,
  policyNumbersError,
  TICKET_COMPLETION_REMARK_LIMIT,
  TICKET_FIELDS,
  TICKET_TEXT_LIMITS,
} from "./ticket-fields.ts";
import { ticketDisplayStatusSchema } from "./ticket-status.ts";
import { createdRangeFields } from "./time-range.ts";

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

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));

const optionalEnum = <T extends z.ZodTypeAny>(schema: T) =>
  schema
    .or(z.literal(""))
    .nullish()
    .transform((value): z.output<T> | null => (value ? value : null));

/**
 * 旧投诉等级文本轨的墓碑：zod 默认 strip 会静默吞掉未知键，旧客户端携带
 * complaintLevel 的输入必须明确报错，不能无声通过。
 */
export const legacyComplaintLevelInputSchema = z
  .undefined({ error: "投诉等级文本轨已下线，请改用时效策略（slaPolicyId）" })
  .optional();

const optionalPolicyNumbers = z
  .array(z.string())
  .nullish()
  .transform((values) => normalizePolicyNumbers(values ?? []))
  .superRefine((values, ctx) => {
    const error = policyNumbersError(values);
    if (error) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: error });
    }
  });

export const ticketCreateInputSchema = z.object({
  /** 客户实际反馈时间；ISO-8601 绝对时刻（客户端已按本地时区换算）。 */
  feedbackTime: optionalEnum(z.string().datetime({ offset: true, message: "反馈时间格式不正确" })),
  /** 反馈渠道目录引用；null = 未填写。目录项须存在且启用（编辑保持原值除外）。 */
  channelId: optionalText(TICKET_FIELDS.channelId.maxLength),
  project: optionalText(TICKET_TEXT_LIMITS.project),
  brokerageEntity: optionalText(TICKET_TEXT_LIMITS.brokerageEntity),
  paymentChannel: optionalText(TICKET_TEXT_LIMITS.paymentChannel),
  internalOrderNumber: optionalText(TICKET_TEXT_LIMITS.internalOrderNumber),
  policyNumbers: optionalPolicyNumbers,
  /** true = 明确没有保单号（区别于未填写的 []）; true 时 policyNumbers 必为 [], 由 service 层强制不变量。 */
  noPolicyNumber: z
    .boolean()
    .nullish()
    .transform((value) => value ?? false),
  /** 用户反馈渠道目录引用（客户发起侧）；null = 未填写。目录项须存在且启用（编辑保持原值除外）。 */
  userFeedbackChannelId: optionalText(TICKET_FIELDS.userFeedbackChannelId.maxLength),
  /** 反馈信息接收渠道目录引用（我方收到反馈的途径）；null = 未填写。目录项须存在且启用（编辑保持原值除外）。 */
  feedbackReceiveChannelId: optionalText(TICKET_FIELDS.feedbackReceiveChannelId.maxLength),
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
  /** 客户那次进线发生的时间；ISO-8601 绝对时刻（客户端已按本地时区换算）。 */
  contactTime: optionalEnum(z.string().datetime({ offset: true, message: "进线时间格式不正确" })),
  contactId: optionalText(TICKET_TEXT_LIMITS.contactId),
  /** 客诉类别目录引用；null = 未填写。目录项须存在且启用（编辑保持原值除外）。 */
  categoryId: optionalText(TICKET_FIELDS.categoryId.maxLength),
  complaintLevel: legacyComplaintLevelInputSchema,
  /** 时效策略目录引用；null = 未定级（无处理时限与 SLA 告警）。 */
  slaPolicyId: optionalText(100),
  /** 独立自由标签，默认空；"" 来自未选择的下拉框。 */
  priority: optionalEnum(prioritySchema),
});

export type TicketCreateInput = z.input<typeof ticketCreateInputSchema>;
export type TicketCreateData = z.output<typeof ticketCreateInputSchema>;

/**
 * 编辑工单 contract: every basic-info field — the same set the creation form
 * collects — editable in any status, 已完结 included. status is deliberately
 * absent: it moves only through lifecycle actions, and editing can never
 * reopen a completed ticket. System-derived fields (dueAt, followUpFrequency,
 * firstResponseRequirement…) stay server-stamped — a 时效策略引用 change
 * recomputes them from the new policy.
 */
export const ticketEditInputSchema = ticketCreateInputSchema.extend({
  ticketId: z.string().min(1),
});

export type TicketEditInput = z.input<typeof ticketEditInputSchema>;
export type TicketEditData = z.output<typeof ticketEditInputSchema>;

export const editComplaintInputSchema = ticketEditInputSchema;
export type EditComplaintInput = z.input<typeof editComplaintInputSchema>;
export type EditComplaintData = z.output<typeof editComplaintInputSchema>;

/**
 * 拆表后仍跑旧 bundle 的客户端会携带拆分前全集提交退费编辑；裸 strict 的
 * unrecognized key 文案不引导刷新，故退役键逐个立墓碑替代。
 */
const retiredRefundEditFieldSchema = z
  .undefined({ error: "退费工单仅可编辑联系人电话与时效策略，请刷新客户端后重试" })
  .optional();

export const editRefundInputSchema = z
  .object({
    ticketId: z.string().min(1),
    contactPhone: optionalText(TICKET_TEXT_LIMITS.contactPhone),
    /** 时效策略目录引用；null = 未定级（无处理时限与 SLA 告警）。 */
    slaPolicyId: optionalText(100),
    feedbackTime: retiredRefundEditFieldSchema,
    channelId: retiredRefundEditFieldSchema,
    project: retiredRefundEditFieldSchema,
    brokerageEntity: retiredRefundEditFieldSchema,
    paymentChannel: retiredRefundEditFieldSchema,
    internalOrderNumber: retiredRefundEditFieldSchema,
    policyNumbers: retiredRefundEditFieldSchema,
    noPolicyNumber: retiredRefundEditFieldSchema,
    userFeedbackChannelId: retiredRefundEditFieldSchema,
    feedbackReceiveChannelId: retiredRefundEditFieldSchema,
    customerName: retiredRefundEditFieldSchema,
    phone: retiredRefundEditFieldSchema,
    customerRequest: retiredRefundEditFieldSchema,
    nuclearBodyStatus: retiredRefundEditFieldSchema,
    hasContacted: retiredRefundEditFieldSchema,
    contactTime: retiredRefundEditFieldSchema,
    contactId: retiredRefundEditFieldSchema,
    categoryId: retiredRefundEditFieldSchema,
    complaintLevel: retiredRefundEditFieldSchema,
    priority: retiredRefundEditFieldSchema,
  })
  .strict();

export type EditRefundInput = z.input<typeof editRefundInputSchema>;
export type EditRefundData = z.output<typeof editRefundInputSchema>;

export const ticketUpdateRefundCompensationInputSchema = z.object({
  ticketId: z.string().min(1),
  compensationAmount: z
    .string()
    .trim()
    .nullish()
    .transform((value) => (value ? value : null))
    .refine((value) => value === null || REFUND_AMOUNT_PATTERN.test(value), {
      message: "补偿金须为不小于 0 的金额（最多两位小数）",
    }),
});
export type TicketUpdateRefundCompensationInput = z.input<
  typeof ticketUpdateRefundCompensationInputSchema
>;
export type TicketUpdateRefundCompensationData = z.output<
  typeof ticketUpdateRefundCompensationInputSchema
>;

/** 查重命中字段（按输入侧字段命名）——命中位置决定提示挂在哪个输入框下。 */
export const TICKET_DUPLICATE_MATCH_FIELDS = ["policyNumbers", "phone", "contactPhone"] as const;
export type TicketDuplicateMatchField = (typeof TICKET_DUPLICATE_MATCH_FIELDS)[number];

/** 查重历史范围上限：全部未软删工单按创建时间倒序取前 N 条。 */
export const TICKET_DUPLICATES_LIMIT = 20;

/**
 * 查重 query contract，创建/编辑的即时查与提交兜底共用一套匹配语义：
 * 保单号数组元素精确相等（大小写敏感）；手机号 trim 后精确相等、不做归一化；
 * phone/contactPhone 2×2 交叉命中；保单号或手机号任一命中即判重。
 */
export const ticketFindDuplicatesInputSchema = z.object({
  policyNumbers: z
    .array(z.string())
    .nullish()
    .transform((values) => normalizePolicyNumbers(values ?? [])),
  phone: optionalText(TICKET_TEXT_LIMITS.phone),
  contactPhone: optionalText(TICKET_TEXT_LIMITS.contactPhone),
  excludeTicketId: z.string().min(1).optional(),
});
export type TicketFindDuplicatesInput = z.input<typeof ticketFindDuplicatesInputSchema>;
export type TicketFindDuplicatesQuery = z.output<typeof ticketFindDuplicatesInputSchema>;

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
 * next-contact plan. contactCount / nextContactTime and the assigned →
 * processing transition are all derived server-side from this single action;
 * the remark itself lands solely as a comment ProcessLog.
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
  /**
   * 仅内部可见标记：true = 外部查询时过滤掉该跟进记录。
   */
  internalOnly: z.boolean().optional().default(false),
});

export type TicketAddCommentInput = z.input<typeof ticketAddCommentInputSchema>;
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
  remark: z.string().trim().min(1, "请填写完结备注").max(TICKET_COMPLETION_REMARK_LIMIT),
});
export type TicketResolveInput = z.infer<typeof ticketResolveInputSchema>;

export const TICKET_SORT_FIELDS = ["createdAt", "dueAt"] as const;
export const ticketSortFieldSchema = z.enum(TICKET_SORT_FIELDS);
export type TicketSortField = (typeof TICKET_SORT_FIELDS)[number];

/** 保单号状态筛选取值；none = 无保单号（区别于未填写）。 */
export const POLICY_NUMBER_STATE_FILTERS = ["none"] as const;
export const policyNumberStateFilterSchema = z.enum(POLICY_NUMBER_STATE_FILTERS);
export type PolicyNumberStateFilter = (typeof POLICY_NUMBER_STATE_FILTERS)[number];

export const POLICY_NUMBER_STATE_FILTER_LABELS: Record<PolicyNumberStateFilter, string> = {
  none: "无保单号",
};

/**
 * Ticket-list query contract, shared by the list page's filter state and the
 * API input — one schema, both ends. All filters are multi-select (空数组 =
 * 不过滤) except firstResponse（单值枚举）. The 状态 filter accepts all 6
 * display statuses: computed ones are resolved to SQL predicates server-side,
 * never stored. Each multi filter tolerates a legacy single value (old
 * `?source=manual` links) by wrapping it.
 */

const multiFilter = <T extends z.ZodTypeAny>(schema: T) =>
  z.array(schema).or(schema.transform((value): z.output<T>[] => [value]));

export const ticketListInputSchema = z.object({
  status: multiFilter(ticketDisplayStatusSchema).optional(),
  /** 渠道目录引用筛选；停用渠道也可选，仍能查到其存量工单。 */
  channelId: multiFilter(z.string().min(1)).optional(),
  /** 类别目录引用筛选；停用类别也可选，仍能查到其存量工单。 */
  categoryId: multiFilter(z.string().min(1)).optional(),
  /** 完结状态目录引用筛选；停用状态也可选，仍能查到其存量工单。 */
  completionStatusId: multiFilter(z.string().min(1)).optional(),
  complaintLevel: legacyComplaintLevelInputSchema,
  /** 时效策略目录引用筛选；停用策略也可选，仍能查到其存量工单。字面值 "none" = 未指定策略（契约见 ticket-filter.ts）。 */
  slaPolicyId: multiFilter(z.string().min(1)).optional(),
  kindId: multiFilter(z.string().min(1)).optional(),
  /** 候选项与分配对话框同源（启用 + 非外部 + ticket.view&ticket.process）。 */
  assigneeId: multiFilter(z.string().min(1)).optional(),
  /** 无 "全部" 字面值——缺省即不过滤。 */
  firstResponse: z.enum(["pending"]).optional(),
  policyNumberState: multiFilter(policyNumberStateFilterSchema).optional(),
  /** 缺省排除 file_import（归档单默认隐藏）；显式传 [] = 不过滤、归档单可见。 */
  source: multiFilter(ticketSourceSchema).default([...DEFAULT_TICKET_SOURCE_FILTER]),
  /** 工单号 / 客户姓名 / 保单号；空白输入等同未搜索。 */
  search: z
    .string()
    .trim()
    .max(100)
    .transform((value) => (value ? value : undefined))
    .optional(),
  ...createdRangeFields,
  sortBy: ticketSortFieldSchema.default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

export type TicketListInput = z.input<typeof ticketListInputSchema>;
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

export type TicketExportInput = z.input<typeof ticketExportInputSchema>;
export type TicketExportQuery = z.output<typeof ticketExportInputSchema>;
