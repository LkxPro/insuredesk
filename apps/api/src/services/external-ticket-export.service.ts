import {
  type ExternalTicketExportQuery,
  joinPolicyNumbers,
  PRIORITY_LABELS,
  prioritySchema,
  TICKET_STATUS_LABELS,
  ticketExportHeader,
  ticketStatusSchema,
} from "@insuredesk/shared";
import { Prisma } from "../generated/prisma/client";
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
 * 提交的单；无翻页参数，导出当前筛选结果全集。列集 = 外部表面可见字段
 * （与 serializeExternalTicket 同口径），不含责任人/处理时限等内部运营列。
 * 状态列取存储状态（外部表面不派生已超时），日期列按浏览器时区格式化。
 * 只读：导出不写 ProcessLog。
 */

const exportInclude = {
  channel: { select: { name: true } },
  category: { select: { name: true } },
  completionStatus: { select: { name: true } },
} satisfies Prisma.TicketInclude;

type ExternalExportRow = Prisma.TicketGetPayload<{ include: typeof exportInclude }>;

type ExportContext = { formatDate: (date: Date | null) => string };

/** 列序与外部详情字段顺序同向：身份（工单号/状态）→ 原文与时刻 → 业务字段 → 收尾（处理结果）。 */
const EXPORT_COLUMNS: ReadonlyArray<{
  header: string;
  value: (ticket: ExternalExportRow, ctx: ExportContext) => string | number;
}> = [
  { header: "工单号", value: (t) => t.workOrderNumber },
  { header: "状态", value: (t) => TICKET_STATUS_LABELS[ticketStatusSchema.parse(t.status)] },
  { header: "工单原文", value: (t) => t.submissionText ?? "" },
  { header: "创建时间", value: (t, { formatDate }) => formatDate(t.createdAt) },
  {
    header: ticketExportHeader("feedbackTime"),
    value: (t, { formatDate }) => formatDate(t.feedbackTime),
  },
  { header: ticketExportHeader("channelId"), value: (t) => t.channel?.name ?? "" },
  { header: ticketExportHeader("project"), value: (t) => t.project ?? "" },
  { header: ticketExportHeader("brokerageEntity"), value: (t) => t.brokerageEntity ?? "" },
  { header: ticketExportHeader("paymentChannel"), value: (t) => t.paymentChannel ?? "" },
  { header: ticketExportHeader("internalOrderNumber"), value: (t) => t.internalOrderNumber ?? "" },
  { header: ticketExportHeader("policyNumbers"), value: (t) => joinPolicyNumbers(t.policyNumbers) },
  {
    header: ticketExportHeader("userComplaintChannel"),
    value: (t) => t.userComplaintChannel ?? "",
  },
  {
    header: ticketExportHeader("complaintReceiveChannel"),
    value: (t) => t.complaintReceiveChannel ?? "",
  },
  { header: ticketExportHeader("customerName"), value: (t) => t.customerName ?? "" },
  { header: ticketExportHeader("phone"), value: (t) => t.phone ?? "" },
  { header: ticketExportHeader("contactPhone"), value: (t) => t.contactPhone ?? "" },
  { header: ticketExportHeader("nuclearBodyStatus"), value: (t) => t.nuclearBodyStatus ?? "" },
  { header: ticketExportHeader("customerRequest"), value: (t) => t.customerRequest ?? "" },
  {
    header: ticketExportHeader("hasContacted"),
    value: (t) => (t.hasContacted === null ? "" : t.hasContacted ? "是" : "否"),
  },
  {
    header: ticketExportHeader("contactTime"),
    value: (t, { formatDate }) => formatDate(t.contactTime),
  },
  { header: ticketExportHeader("contactId"), value: (t) => t.contactId ?? "" },
  { header: ticketExportHeader("categoryId"), value: (t) => t.category?.name ?? "" },
  { header: ticketExportHeader("complaintLevel"), value: (t) => t.complaintLevel ?? "" },
  {
    header: ticketExportHeader("priority"),
    value: (t) => (t.priority === null ? "" : PRIORITY_LABELS[prioritySchema.parse(t.priority)]),
  },
  {
    header: ticketExportHeader("completionStatusId"),
    value: (t) => t.completionStatus?.name ?? "",
  },
  { header: "完结时间", value: (t, { formatDate }) => formatDate(t.completionTime) },
  { header: "处理结果", value: (t) => t.processingResult ?? "" },
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
    include: exportInclude,
  });
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const ordered = idRows
    .map((row) => rowById.get(row.id))
    .filter((row): row is ExternalExportRow => row !== undefined);

  const formatDate = makeDateFormatter(query.timeZone);
  const cells: Array<Array<string | number>> = [
    EXPORT_COLUMNS.map((column) => column.header),
    ...ordered.map((ticket) =>
      EXPORT_COLUMNS.map((column) => column.value(ticket, { formatDate })),
    ),
  ];

  const stamp = filenameStamp(formatDate, clock.now());
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
