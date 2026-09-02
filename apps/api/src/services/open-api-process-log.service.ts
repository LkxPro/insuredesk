import { createHash } from "node:crypto";
import {
  decodeCursor,
  encodeCursor,
  type OpenApiProcessLog,
  type OpenApiProcessLogCursor,
  type OpenApiProcessLogCursorMode,
  type OpenApiProcessLogsQuery,
  openApiProcessLogCursorSchema,
} from "@insuredesk/shared";
import type { Prisma, PrismaClient } from "../generated/prisma/client.ts";
import type { AuthenticatedUser } from "./auth.service.ts";
import { applyTicketDataScope } from "./data-scope.service.ts";

export class OpenApiInvalidCursorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenApiInvalidCursorError";
  }
}

const SORT_BY_MODE = {
  adhoc: "at_desc_id_desc",
  incremental: "at_asc_id_asc",
} as const satisfies Record<OpenApiProcessLogCursorMode, OpenApiProcessLogCursor["sort"]>;

export interface OpenApiProcessLogListResult {
  data: OpenApiProcessLog[];
  hasMore: boolean;
  nextCursor: string | null;
}

function computeFiltersHash(query: OpenApiProcessLogsQuery): string {
  const canonical = {
    ticketId: query.ticketId ?? null,
    updatedSince: query.updatedSince ?? null,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function decodeProcessLogCursor(raw: string): OpenApiProcessLogCursor {
  const parsed = openApiProcessLogCursorSchema.safeParse(decodeCursor(raw));
  if (!parsed.success) {
    throw new OpenApiInvalidCursorError("Cursor is malformed");
  }
  return parsed.data;
}

function cursorWhere(
  mode: OpenApiProcessLogCursorMode,
  last: OpenApiProcessLogCursor["last"],
): Prisma.ProcessLogWhereInput {
  const primary = new Date(last.primary);
  return mode === "incremental"
    ? { OR: [{ at: { gt: primary } }, { at: primary, id: { gt: last.id } }] }
    : { OR: [{ at: { lt: primary } }, { at: primary, id: { lt: last.id } }] };
}

type OpenApiProcessLogRow = Prisma.ProcessLogGetPayload<{
  include: { ticket: { select: { workOrderNumber: true } } };
}>;

function serializeProcessLog(row: OpenApiProcessLogRow): OpenApiProcessLog {
  return {
    id: row.id,
    ticketId: row.ticketId,
    workOrderNumber: row.ticket.workOrderNumber,
    action: row.action,
    operatorId: row.operatorId,
    operatorName: row.operatorName,
    from: row.from,
    to: row.to,
    remark: row.remark,
    internalOnly: row.internalOnly,
    at: row.at.toISOString(),
  };
}

// 负空间：父单软删不过滤（父单 tombstone 后 logs 照常流出）、internalOnly 不过滤
// （对齐内部导出口径）——两处都是故意缺省，不是遗漏。
export async function listOpenApiProcessLogs(
  { prisma }: { prisma: PrismaClient },
  viewer: AuthenticatedUser,
  query: OpenApiProcessLogsQuery,
): Promise<OpenApiProcessLogListResult> {
  const mode: OpenApiProcessLogCursorMode =
    query.updatedSince !== undefined ? "incremental" : "adhoc";
  const sort = SORT_BY_MODE[mode];
  const filtersHash = computeFiltersHash(query);

  let cursor: OpenApiProcessLogCursor | null = null;
  if (query.cursor !== undefined) {
    cursor = decodeProcessLogCursor(query.cursor);
    if (cursor.mode !== mode || cursor.sort !== sort || cursor.filtersHash !== filtersHash) {
      throw new OpenApiInvalidCursorError("Cursor does not match the request's mode or filter set");
    }
  }

  const and: Prisma.ProcessLogWhereInput[] = [];
  if (mode === "incremental") {
    and.push({ at: { gte: new Date(query.updatedSince as string) } });
  }
  if (cursor) {
    and.push(cursorWhere(mode, cursor.last));
  }

  const rows = await prisma.processLog.findMany({
    where: {
      ...(query.ticketId !== undefined ? { ticketId: query.ticketId } : {}),
      ticket: applyTicketDataScope(viewer) as Prisma.TicketWhereInput,
      ...(and.length > 0 ? { AND: and } : {}),
    },
    include: { ticket: { select: { workOrderNumber: true } } },
    orderBy:
      mode === "incremental" ? [{ at: "asc" }, { id: "asc" }] : [{ at: "desc" }, { id: "desc" }],
    take: query.limit + 1,
  });

  const hasMore = rows.length > query.limit;
  const pageRows = hasMore ? rows.slice(0, query.limit) : rows;
  const data = pageRows.map(serializeProcessLog);

  const lastRow = pageRows.at(-1);
  const nextCursor =
    hasMore && lastRow
      ? encodeCursor({
          v: 1,
          mode,
          sort,
          filtersHash,
          last: { primary: lastRow.at.toISOString(), id: lastRow.id },
        } satisfies OpenApiProcessLogCursor)
      : null;

  return { data, hasMore, nextCursor };
}
