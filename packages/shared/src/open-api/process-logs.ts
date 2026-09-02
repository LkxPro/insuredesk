import { z } from "zod";

export const OPEN_API_PROCESS_LOGS_LIMIT_MAX = 200;

/**
 * action 一律 z.string() raw 透传（存量脏值或未来新增取值不得让数据端点 500）；
 * internalOnly 行照常流出（对齐内部导出口径），过滤责任在下游。
 */
export const openApiProcessLogSchema = z
  .object({
    id: z.string(),
    ticketId: z.string(),
    workOrderNumber: z.string(),
    action: z.string(),
    operatorId: z.string(),
    operatorName: z.string().nullable(),
    from: z.string().nullable(),
    to: z.string().nullable(),
    remark: z.string(),
    internalOnly: z.boolean(),
    at: z.string(),
  })
  .strict();

export type OpenApiProcessLog = z.infer<typeof openApiProcessLogSchema>;

export const openApiProcessLogListResponseSchema = z.object({
  data: z.array(openApiProcessLogSchema),
  hasMore: z.boolean(),
  nextCursor: z.string().nullable(),
  nextUrl: z.string().nullable(),
});
export type OpenApiProcessLogListResponse = z.infer<typeof openApiProcessLogListResponseSchema>;

export const OPEN_API_PROCESS_LOG_CURSOR_MODES = ["adhoc", "incremental"] as const;
export type OpenApiProcessLogCursorMode = (typeof OPEN_API_PROCESS_LOG_CURSOR_MODES)[number];

/**
 * 游标载荷：mode/sort/filtersHash 把游标钉死在签发它的参数集上——换模式或
 * 换筛选后继续翻页会静默漏数，必须报 invalid_cursor 而不是照跑。
 */
export const openApiProcessLogCursorSchema = z.object({
  v: z.literal(1),
  mode: z.enum(OPEN_API_PROCESS_LOG_CURSOR_MODES),
  sort: z.enum(["at_desc_id_desc", "at_asc_id_asc"]),
  filtersHash: z.string().min(1),
  last: z.object({
    primary: z.string().datetime({ offset: true }),
    id: z.string().min(1),
  }),
});
export type OpenApiProcessLogCursor = z.infer<typeof openApiProcessLogCursorSchema>;

export const openApiProcessLogsInputSchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(OPEN_API_PROCESS_LOGS_LIMIT_MAX)
      .default(OPEN_API_PROCESS_LOGS_LIMIT_MAX),
    cursor: z.string().min(1).optional(),
    ticketId: z.string().min(1).optional(),
    updatedSince: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export type OpenApiProcessLogsInput = z.input<typeof openApiProcessLogsInputSchema>;
export type OpenApiProcessLogsQuery = z.output<typeof openApiProcessLogsInputSchema>;
