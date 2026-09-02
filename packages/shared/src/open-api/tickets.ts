import { z } from "zod";
import { ticketSourceSchema } from "../enums.ts";
import { policyNumberStateFilterSchema } from "../ticket.ts";
import { ticketDisplayStatusSchema } from "../ticket-status.ts";

export const OPEN_API_TICKETS_LIMIT_MAX = 200;

/**
 * 枚举列一律 z.string() raw 透传（存量脏值或未来新增取值不得让数据端点 500）；
 * 金额保持 String 原样（系统不做数值运算）；kind 不匹配的侧表字段恒 null。
 */
export const openApiTicketSchema = z
  .object({
    id: z.string(),
    workOrderNumber: z.string(),
    source: z.string(),
    status: z.string(),
    displayStatus: z.string(),
    kindId: z.string(),
    kindKey: z.string(),
    contactPhone: z.string().nullable(),
    slaPolicyId: z.string().nullable(),
    slaPolicyName: z.string().nullable(),
    assigneeId: z.string().nullable(),
    assigneeName: z.string().nullable(),
    creatorId: z.string().nullable(),
    createdBy: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    assignedAt: z.string().nullable(),
    dueAt: z.string().nullable(),
    nextContactTime: z.string().nullable(),
    contactCount: z.number().int(),
    followUpFrequency: z.string().nullable(),
    firstResponseRequirement: z.string().nullable(),
    completionTime: z.string().nullable(),
    completionStatusId: z.string().nullable(),
    completionStatusName: z.string().nullable(),
    processLogsText: z.string(),
    complaint_feedbackTime: z.string().nullable(),
    complaint_channelId: z.string().nullable(),
    complaint_channelName: z.string().nullable(),
    complaint_project: z.string().nullable(),
    complaint_brokerageEntity: z.string().nullable(),
    complaint_paymentChannel: z.string().nullable(),
    complaint_internalOrderNumber: z.string().nullable(),
    complaint_policyNumbers: z.array(z.string()).nullable(),
    complaint_noPolicyNumber: z.boolean().nullable(),
    complaint_userFeedbackChannelId: z.string().nullable(),
    complaint_userFeedbackChannelName: z.string().nullable(),
    complaint_feedbackReceiveChannelId: z.string().nullable(),
    complaint_feedbackReceiveChannelName: z.string().nullable(),
    complaint_customerName: z.string().nullable(),
    complaint_phone: z.string().nullable(),
    complaint_customerRequest: z.string().nullable(),
    complaint_nuclearBodyStatus: z.string().nullable(),
    complaint_hasContacted: z.boolean().nullable(),
    complaint_contactTime: z.string().nullable(),
    complaint_contactId: z.string().nullable(),
    complaint_categoryId: z.string().nullable(),
    complaint_categoryName: z.string().nullable(),
    complaint_priority: z.string().nullable(),
    refund_platform: z.string().nullable(),
    refund_endorNo: z.string().nullable(),
    refund_sysOrderId: z.string().nullable(),
    refund_workOrderType: z.string().nullable(),
    refund_expectedAmount: z.string().nullable(),
    refund_refundCreateTime: z.string().nullable(),
    refund_refundTrades: z.array(z.unknown()).nullable(),
    refund_holderName: z.string().nullable(),
    refund_holderPhone: z.string().nullable(),
    refund_companyName: z.string().nullable(),
    refund_productId: z.string().nullable(),
    refund_productName: z.string().nullable(),
    refund_policyNo: z.string().nullable(),
    refund_failureReason: z.string().nullable(),
    refund_pushedFields: z.array(z.string()).nullable(),
    refund_compensationAmount: z.string().nullable(),
  })
  .strict();

export type OpenApiTicket = z.infer<typeof openApiTicketSchema>;

export const OPEN_API_TICKET_FIELD_KEYS = Object.keys(openApiTicketSchema.shape);

/** 增量模式下软删行的最小形状；不受 fields 投影影响。 */
export const openApiTicketTombstoneSchema = z
  .object({
    id: z.string(),
    workOrderNumber: z.string(),
    deletedAt: z.string(),
    updatedAt: z.string(),
    tombstone: z.literal(true),
  })
  .strict();

export type OpenApiTicketTombstone = z.infer<typeof openApiTicketTombstoneSchema>;

export const openApiTicketListResponseSchema = z.object({
  data: z.array(z.union([openApiTicketTombstoneSchema, openApiTicketSchema])),
  hasMore: z.boolean(),
  nextCursor: z.string().nullable(),
  nextUrl: z.string().nullable(),
});
export type OpenApiTicketListResponse = z.infer<typeof openApiTicketListResponseSchema>;

export const OPEN_API_TICKET_CURSOR_MODES = ["adhoc", "incremental"] as const;
export type OpenApiTicketCursorMode = (typeof OPEN_API_TICKET_CURSOR_MODES)[number];

/**
 * 游标载荷：mode/sort/filtersHash 把游标钉死在签发它的参数集上——换模式或
 * 换筛选后继续翻页会静默漏数，必须报 invalid_cursor 而不是照跑。last 是上一页
 * 末行的排序键位置（ad-hoc 存 createdAt、incremental 存 updatedAt）。
 */
export const openApiTicketCursorSchema = z.object({
  v: z.literal(1),
  mode: z.enum(OPEN_API_TICKET_CURSOR_MODES),
  sort: z.enum(["createdAt_desc_id_desc", "updatedAt_asc_id_asc"]),
  filtersHash: z.string().min(1),
  last: z.object({
    primary: z.string().datetime({ offset: true }),
    id: z.string().min(1),
  }),
});
export type OpenApiTicketCursor = z.infer<typeof openApiTicketCursorSchema>;

const multiValue = <T extends z.ZodTypeAny>(item: T) => z.array(item).min(1).optional();

const datetimeParam = z.string().datetime({ offset: true });

/**
 * 独立输入 schema：不得继承 ticketListInputSchema 的任何 default——尤其来源筛选
 * 缺省排除 file_import 那条；这里缺省 = 不过滤 = 全来源可见（有意偏离 UI 默认）。
 */
export const openApiTicketsInputSchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(OPEN_API_TICKETS_LIMIT_MAX)
      .default(OPEN_API_TICKETS_LIMIT_MAX),
    cursor: z.string().min(1).optional(),
    updatedSince: datetimeParam.optional(),
    status: multiValue(ticketDisplayStatusSchema),
    channelId: multiValue(z.string().min(1)),
    categoryId: multiValue(z.string().min(1)),
    completionStatusId: multiValue(z.string().min(1)),
    slaPolicyId: multiValue(z.string().min(1)),
    kindId: multiValue(z.string().min(1)),
    policyNumberState: multiValue(policyNumberStateFilterSchema),
    source: multiValue(ticketSourceSchema),
    search: z
      .string()
      .trim()
      .max(100)
      .transform((value) => (value ? value : undefined))
      .optional(),
    createdFrom: datetimeParam.optional(),
    createdTo: datetimeParam.optional(),
    fields: multiValue(z.string().min(1)),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.fields) {
      return;
    }
    const allowed = new Set(OPEN_API_TICKET_FIELD_KEYS);
    const unknown = value.fields.filter((field) => !allowed.has(field));
    if (unknown.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["fields"],
        message: `Unknown fields: ${unknown.join(", ")}. Allowed fields: ${OPEN_API_TICKET_FIELD_KEYS.join(", ")}`,
      });
    }
  });

export type OpenApiTicketsInput = z.input<typeof openApiTicketsInputSchema>;
export type OpenApiTicketsQuery = z.output<typeof openApiTicketsInputSchema>;
