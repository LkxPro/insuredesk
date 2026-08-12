import {
  type ExternalTicketExportQuery,
  joinPolicyNumbers,
  ticketExportHeader,
} from "@insuredesk/shared";
import { Prisma, type Ticket } from "../generated/prisma/client";
import type { AuthenticatedUser } from "./auth.service";
import { buildExternalTicketConditions } from "./external-ticket-query";
import type { TicketServiceDeps } from "./ticket.service";
import {
  filenameStamp,
  makeDateFormatter,
  type TicketExportFile,
  toCsv,
  toXlsx,
} from "./ticket-export.service";

/**
 * 外部导出工单: the external viewer's *filtered list*, as a file. 与列表吃
 * 同一份 WHERE 构造器（buildExternalTicketConditions），数据范围恒为本人
 * 提交的单；无翻页参数，导出当前筛选结果全集。列集与外部详情同口径——
 * 保单号/客户/两个电话/工单原文 5 列，空值导空字符串（「—」只是页面展示
 * 层的兜底，进 Excel 会污染筛选）。只读：导出不写 ProcessLog。
 */

type ExternalExportRow = Ticket;

/** 列序与详情信息栏同向：身份（保单号/客户/电话）在前，长文本原文收尾。 */
const EXPORT_COLUMNS: ReadonlyArray<{
  header: string;
  value: (ticket: ExternalExportRow) => string;
}> = [
  { header: ticketExportHeader("policyNumbers"), value: (t) => joinPolicyNumbers(t.policyNumbers) },
  { header: ticketExportHeader("customerName"), value: (t) => t.customerName ?? "" },
  { header: ticketExportHeader("phone"), value: (t) => t.phone ?? "" },
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
): Promise<TicketExportFile> {
  const whereSql = Prisma.join(buildExternalTicketConditions(viewer.id, query), " AND ");
  const idRows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT t.id FROM tickets t
    WHERE ${whereSql}
    ORDER BY t."createdAt" DESC, t.id DESC
  `;
  const rows = await prisma.ticket.findMany({
    where: { id: { in: idRows.map((row) => row.id) } },
  });
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const ordered = idRows
    .map((row) => rowById.get(row.id))
    .filter((row): row is ExternalExportRow => row !== undefined);

  const cells: string[][] = [
    EXPORT_COLUMNS.map((column) => column.header),
    ...ordered.map((ticket) => EXPORT_COLUMNS.map((column) => column.value(ticket))),
  ];

  const stamp = filenameStamp(makeDateFormatter(query.timeZone), clock.now());
  if (query.format === "csv") {
    return {
      filename: `external-tickets-${stamp}.csv`,
      contentType: "text/csv; charset=utf-8",
      body: toCsv(cells),
    };
  }
  return {
    filename: `external-tickets-${stamp}.xlsx`,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    body: await toXlsx(cells),
  };
}
