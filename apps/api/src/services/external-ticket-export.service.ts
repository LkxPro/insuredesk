import {
  type ExternalTicketExportQuery,
  joinPolicyNumbers,
  ticketExportHeader,
} from "@insuredesk/shared";
import { Prisma } from "../generated/prisma/client.ts";
import type { AuthenticatedUser } from "./auth.service.ts";
import { type ExportColumn, type ExportFile, renderExportFile } from "./export-file.ts";
import { buildExternalTicketConditions } from "./external-ticket-query.ts";
import type { TicketServiceDeps } from "./ticket.service.ts";

/**
 * 列集与外部详情同口径；空值导空字符串（「—」只是页面展示层的兜底，进
 * Excel 会污染筛选）。只读：导出不写 ProcessLog。
 */

type ExternalExportRow = Prisma.TicketGetPayload<{
  include: { complaintDetail: true };
}>;

const EXPORT_COLUMNS: ReadonlyArray<ExportColumn<ExternalExportRow>> = [
  {
    header: ticketExportHeader("policyNumbers"),
    value: (t) => joinPolicyNumbers(t.complaintDetail?.policyNumbers ?? []),
  },
  {
    header: ticketExportHeader("customerName"),
    value: (t) => t.complaintDetail?.customerName ?? "",
  },
  { header: ticketExportHeader("phone"), value: (t) => t.complaintDetail?.phone ?? "" },
  { header: ticketExportHeader("contactPhone"), value: (t) => t.contactPhone ?? "" },
  { header: "工单原文", value: (t) => t.submissionText ?? "" },
];

/**
 * Export every ticket the external viewer's current filters match. 行序 =
 * 创建时间倒序（外部列表的智能排序依赖最新跟进联查，导出只承诺筛选一致、
 * 不承诺与列表逐行同序）。
 */
export async function exportExternalTickets(
  { prisma, clock }: TicketServiceDeps,
  viewer: AuthenticatedUser,
  query: ExternalTicketExportQuery,
): Promise<ExportFile> {
  const whereSql = Prisma.join(buildExternalTicketConditions(viewer.id, query), " AND ");
  const idRows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT t.id FROM tickets t
    WHERE ${whereSql}
    ORDER BY t."createdAt" DESC, t.id DESC
  `;
  const rows = await prisma.ticket.findMany({
    where: { id: { in: idRows.map((row) => row.id) } },
    include: { complaintDetail: true },
  });
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const ordered = idRows
    .map((row) => rowById.get(row.id))
    .filter((row): row is ExternalExportRow => row !== undefined);

  return renderExportFile({
    baseName: "external-tickets",
    format: query.format,
    timeZone: query.timeZone,
    now: clock.now(),
    columns: EXPORT_COLUMNS,
    rows: ordered,
  });
}
