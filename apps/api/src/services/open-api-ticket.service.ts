import { createHash } from "node:crypto";
import {
  decodeCursor,
  deriveDisplayStatus,
  encodeCursor,
  isCreatorBackedSource,
  OPEN_API_TICKET_FIELD_KEYS,
  type OpenApiTicket,
  type OpenApiTicketCursor,
  type OpenApiTicketCursorMode,
  type OpenApiTicketsQuery,
  type OpenApiTicketTombstone,
  openApiTicketCursorSchema,
  TICKET_SOURCE_LABELS,
  TicketKindKey,
  type TicketSource,
  type TicketStatus,
} from "@insuredesk/shared";
import type { Prisma } from "../generated/prisma/client.ts";
import type { AuthenticatedUser } from "./auth.service.ts";
import { buildTicketListWhere, type TicketServiceDeps } from "./ticket.service.ts";

export class OpenApiInvalidCursorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenApiInvalidCursorError";
  }
}

const SORT_BY_MODE = {
  adhoc: "createdAt_desc_id_desc",
  incremental: "updatedAt_asc_id_asc",
} as const satisfies Record<OpenApiTicketCursorMode, OpenApiTicketCursor["sort"]>;

const openApiTicketInclude = {
  kind: { select: { key: true } },
  slaPolicy: { select: { name: true } },
  assignee: { select: { name: true } },
  creator: { select: { name: true } },
  completionStatus: { select: { name: true } },
  complaintDetail: {
    include: {
      channel: { select: { id: true, name: true } },
      category: { select: { id: true, name: true } },
      userFeedbackChannel: { select: { id: true, name: true } },
      feedbackReceiveChannel: { select: { id: true, name: true } },
    },
  },
  refundDetail: true,
  // 与既有 Excel 导出同口径：internalOnly 不过滤（开放 API 面向内部数据消费方）
  processLogs: {
    where: { action: "comment" },
    orderBy: [{ at: "asc" }, { id: "asc" }],
    select: { at: true, operatorName: true, remark: true },
  },
} satisfies Prisma.TicketInclude;

type OpenApiTicketRow = Prisma.TicketGetPayload<{ include: typeof openApiTicketInclude }>;

export interface OpenApiTicketListResult {
  data: Array<Partial<OpenApiTicket> | OpenApiTicketTombstone>;
  hasMore: boolean;
  nextCursor: string | null;
}

function sorted(values: readonly string[] | undefined): string[] {
  return [...(values ?? [])].sort();
}

/** 多值数组排序后哈希：同一筛选集的不同传参顺序命中同一游标。 */
function computeFiltersHash(query: OpenApiTicketsQuery): string {
  const canonical = {
    status: sorted(query.status),
    channelId: sorted(query.channelId),
    categoryId: sorted(query.categoryId),
    completionStatusId: sorted(query.completionStatusId),
    slaPolicyId: sorted(query.slaPolicyId),
    kindId: sorted(query.kindId),
    policyNumberState: sorted(query.policyNumberState),
    source: sorted(query.source),
    search: query.search ?? null,
    createdFrom: query.createdFrom ?? null,
    createdTo: query.createdTo ?? null,
    updatedSince: query.updatedSince ?? null,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function decodeTicketCursor(raw: string): OpenApiTicketCursor {
  const parsed = openApiTicketCursorSchema.safeParse(decodeCursor(raw));
  if (!parsed.success) {
    throw new OpenApiInvalidCursorError("Cursor is malformed");
  }
  return parsed.data;
}

function cursorWhere(
  mode: OpenApiTicketCursorMode,
  last: OpenApiTicketCursor["last"],
): Prisma.TicketWhereInput {
  const primary = new Date(last.primary);
  return mode === "incremental"
    ? { OR: [{ updatedAt: { gt: primary } }, { updatedAt: primary, id: { gt: last.id } }] }
    : { OR: [{ createdAt: { lt: primary } }, { createdAt: primary, id: { lt: last.id } }] };
}

function appendAnd(
  where: Prisma.TicketWhereInput,
  extra: Prisma.TicketWhereInput[],
): Prisma.TicketWhereInput {
  const existing = where.AND;
  const list = Array.isArray(existing) ? existing : existing ? [existing] : [];
  return { ...where, AND: [...list, ...extra] };
}

function iso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

function serializeTicket(row: OpenApiTicketRow, now: Date): OpenApiTicket {
  const source = row.source;
  const isRefund = row.kind.key === TicketKindKey.RefundException;
  // 侧表归属按 kind 判定而非行存在性：kind 不匹配的侧表字段恒 null
  const detail = isRefund ? null : row.complaintDetail;
  const refund = isRefund ? row.refundDetail : null;

  return {
    id: row.id,
    workOrderNumber: row.workOrderNumber,
    source,
    status: row.status,
    displayStatus: deriveDisplayStatus(row.status as TicketStatus, row.dueAt, now),
    kindId: row.kindId,
    kindKey: row.kind.key,
    contactPhone: row.contactPhone,
    slaPolicyId: row.slaPolicyId,
    slaPolicyName: row.slaPolicy?.name ?? null,
    assigneeId: row.assigneeId,
    assigneeName: row.assignee?.name ?? null,
    creatorId: row.creatorId,
    createdBy: isCreatorBackedSource(source as TicketSource)
      ? (row.creator?.name ?? null)
      : (TICKET_SOURCE_LABELS[source as TicketSource] ?? null),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    assignedAt: iso(row.assignedAt),
    dueAt: iso(row.dueAt),
    nextContactTime: iso(row.nextContactTime),
    contactCount: row.contactCount,
    followUpFrequency: row.followUpFrequency,
    firstResponseRequirement: row.firstResponseRequirement,
    completionTime: iso(row.completionTime),
    completionStatusId: row.completionStatusId,
    completionStatusName: row.completionStatus?.name ?? null,
    processLogsText: row.processLogs
      .map((log) => `[${log.at.toISOString()}] ${log.operatorName ?? ""}：${log.remark}`)
      .join("\n"),
    complaint_feedbackTime: detail ? iso(detail.feedbackTime) : null,
    complaint_channelId: detail?.channelId ?? null,
    complaint_channelName: detail?.channel?.name ?? null,
    complaint_project: detail?.project ?? null,
    complaint_brokerageEntity: detail?.brokerageEntity ?? null,
    complaint_paymentChannel: detail?.paymentChannel ?? null,
    complaint_internalOrderNumber: detail?.internalOrderNumber ?? null,
    complaint_policyNumbers: detail?.policyNumbers ?? null,
    complaint_noPolicyNumber: detail?.noPolicyNumber ?? null,
    complaint_userFeedbackChannelId: detail?.userFeedbackChannelId ?? null,
    complaint_userFeedbackChannelName: detail?.userFeedbackChannel?.name ?? null,
    complaint_feedbackReceiveChannelId: detail?.feedbackReceiveChannelId ?? null,
    complaint_feedbackReceiveChannelName: detail?.feedbackReceiveChannel?.name ?? null,
    complaint_customerName: detail?.customerName ?? null,
    complaint_phone: detail?.phone ?? null,
    complaint_customerRequest: detail?.customerRequest ?? null,
    complaint_nuclearBodyStatus: detail?.nuclearBodyStatus ?? null,
    complaint_hasContacted: detail?.hasContacted ?? null,
    complaint_contactTime: detail ? iso(detail.contactTime) : null,
    complaint_contactId: detail?.contactId ?? null,
    complaint_categoryId: detail?.categoryId ?? null,
    complaint_categoryName: detail?.category?.name ?? null,
    complaint_priority: detail?.priority ?? null,
    refund_platform: refund?.platform ?? null,
    refund_endorNo: refund?.endorNo ?? null,
    refund_sysOrderId: refund?.sysOrderId ?? null,
    refund_workOrderType: refund?.workOrderType ?? null,
    refund_expectedAmount: refund?.expectedAmount ?? null,
    refund_refundCreateTime: refund ? iso(refund.refundCreateTime) : null,
    refund_refundTrades: Array.isArray(refund?.refundTrades)
      ? (refund.refundTrades as unknown[])
      : null,
    refund_holderName: refund?.holderName ?? null,
    refund_holderPhone: refund?.holderPhone ?? null,
    refund_companyName: refund?.companyName ?? null,
    refund_productId: refund?.productId ?? null,
    refund_productName: refund?.productName ?? null,
    refund_policyNo: refund?.policyNo ?? null,
    refund_failureReason: refund?.failureReason ?? null,
    refund_pushedFields: refund?.pushedFields ?? null,
    refund_compensationAmount: refund?.compensationAmount ?? null,
  };
}

function serializeTombstone(row: OpenApiTicketRow): OpenApiTicketTombstone {
  return {
    id: row.id,
    workOrderNumber: row.workOrderNumber,
    deletedAt: (row.deletedAt as Date).toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    tombstone: true,
  };
}

function projectFields(
  ticket: OpenApiTicket,
  fields: readonly string[] | undefined,
): Partial<OpenApiTicket> {
  if (!fields) {
    return ticket;
  }
  const wanted = new Set(fields);
  const projected: Record<string, unknown> = {};
  for (const key of OPEN_API_TICKET_FIELD_KEYS) {
    if (wanted.has(key)) {
      projected[key] = ticket[key as keyof OpenApiTicket];
    }
  }
  return projected;
}

/** 同步流必须看见软删行并转成 tombstone。 */
export async function listOpenApiTickets(
  { prisma, clock }: TicketServiceDeps,
  viewer: AuthenticatedUser,
  query: OpenApiTicketsQuery,
): Promise<OpenApiTicketListResult> {
  const now = clock.now();
  const mode: OpenApiTicketCursorMode = query.updatedSince !== undefined ? "incremental" : "adhoc";
  const sort = SORT_BY_MODE[mode];
  const filtersHash = computeFiltersHash(query);

  let cursor: OpenApiTicketCursor | null = null;
  if (query.cursor !== undefined) {
    cursor = decodeTicketCursor(query.cursor);
    if (cursor.mode !== mode || cursor.sort !== sort || cursor.filtersHash !== filtersHash) {
      throw new OpenApiInvalidCursorError("Cursor does not match the request's mode or filter set");
    }
  }

  const baseWhere = await buildTicketListWhere(
    prisma,
    viewer,
    { ...query, source: query.source ?? [] },
    now,
  );
  let where: Prisma.TicketWhereInput;
  if (mode === "incremental") {
    const { deletedAt: _adHocOnly, ...rest } = baseWhere;
    where = appendAnd(rest, [{ updatedAt: { gte: new Date(query.updatedSince as string) } }]);
  } else {
    where = baseWhere;
  }
  if (cursor) {
    where = appendAnd(where, [cursorWhere(mode, cursor.last)]);
  }

  const rows = await prisma.ticket.findMany({
    where,
    include: openApiTicketInclude,
    orderBy:
      mode === "incremental"
        ? [{ updatedAt: "asc" }, { id: "asc" }]
        : [{ createdAt: "desc" }, { id: "desc" }],
    take: query.limit + 1,
  });

  const hasMore = rows.length > query.limit;
  const pageRows = hasMore ? rows.slice(0, query.limit) : rows;
  const data = pageRows.map((row) =>
    row.deletedAt !== null
      ? serializeTombstone(row)
      : projectFields(serializeTicket(row, now), query.fields),
  );

  const lastRow = pageRows.at(-1);
  const nextCursor =
    hasMore && lastRow
      ? encodeCursor({
          v: 1,
          mode,
          sort,
          filtersHash,
          last: {
            primary: (mode === "incremental" ? lastRow.updatedAt : lastRow.createdAt).toISOString(),
            id: lastRow.id,
          },
        } satisfies OpenApiTicketCursor)
      : null;

  return { data, hasMore, nextCursor };
}
