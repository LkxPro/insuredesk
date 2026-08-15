import {
  deriveDisplayStatus,
  joinPolicyNumbers,
  PRIORITY_LABELS,
  prioritySchema,
  TICKET_SOURCE_LABELS,
  TICKET_STATUS_LABELS,
  type TicketExportQuery,
  ticketExportHeader,
  ticketSourceSchema,
  ticketStatusSchema,
} from "@insuredesk/shared";
import type { Prisma } from "../generated/prisma/client.ts";
import type { AuthenticatedUser } from "./auth.service.ts";
import { type ExportColumn, type ExportFile, renderExportFile } from "./export-file.ts";
import {
  buildTicketListOrderBy,
  buildTicketListWhere,
  type TicketServiceDeps,
} from "./ticket.service.ts";

/**
 * 导出工单: the viewer's *filtered list*, as a file. Reuses the list's
 * WHERE/ORDER builders verbatim, so filters, soft-delete exclusion, and the
 * RBAC data scope (个人档只能导出指派给我或我创建的单) can never drift from
 * what the list page shows. Read-only by design: an export writes no
 * ProcessLog — it is a list-level batch read, not a per-ticket timeline
 * event.
 */

const exportInclude = {
  // Current follow-up owner is derived via JOIN, never stored
  assignee: { select: { name: true } },
  // Catalog references render their CURRENT names — a rename shows through
  category: { select: { name: true } },
  channel: { select: { name: true } },
  completionStatus: { select: { name: true } },
  // internalOnly 不过滤：内部导出照常包含
  processLogs: {
    where: { action: "comment" },
    orderBy: [{ at: "asc" }, { id: "asc" }],
    select: { at: true, operatorName: true, remark: true },
  },
} satisfies Prisma.TicketInclude;

type TicketExportRow = Prisma.TicketGetPayload<{ include: typeof exportInclude }>;

/**
 * 导出列：工单关键字段, in the detail page's reading order — 列序与系统列
 * 表头是对外契约，手写维持现状；用户字段列头从描述表取词。状态 is the
 * computed display status at export time (导出时刻口径) — same derivation as
 * the list, labelled in Chinese like every other enum column.
 */
const EXPORT_COLUMNS: ReadonlyArray<ExportColumn<TicketExportRow>> = [
  { header: "工单号", value: (t) => t.workOrderNumber },
  {
    header: "状态",
    value: (t, { now }) =>
      TICKET_STATUS_LABELS[deriveDisplayStatus(ticketStatusSchema.parse(t.status), t.dueAt, now)],
  },
  { header: ticketExportHeader("customerName"), value: (t) => t.customerName ?? "" },
  { header: ticketExportHeader("phone"), value: (t) => t.phone ?? "" },
  { header: ticketExportHeader("contactPhone"), value: (t) => t.contactPhone ?? "" },
  { header: ticketExportHeader("policyNumbers"), value: (t) => joinPolicyNumbers(t.policyNumbers) },
  { header: ticketExportHeader("channelId"), value: (t) => t.channel?.name ?? "" },
  { header: ticketExportHeader("complaintLevel"), value: (t) => t.complaintLevel ?? "" },
  { header: ticketExportHeader("categoryId"), value: (t) => t.category?.name ?? "" },
  {
    header: ticketExportHeader("priority"),
    value: (t) => (t.priority === null ? "" : PRIORITY_LABELS[prioritySchema.parse(t.priority)]),
  },
  { header: "来源", value: (t) => TICKET_SOURCE_LABELS[ticketSourceSchema.parse(t.source)] },
  { header: ticketExportHeader("project"), value: (t) => t.project ?? "" },
  { header: ticketExportHeader("brokerageEntity"), value: (t) => t.brokerageEntity ?? "" },
  { header: ticketExportHeader("paymentChannel"), value: (t) => t.paymentChannel ?? "" },
  { header: ticketExportHeader("internalOrderNumber"), value: (t) => t.internalOrderNumber ?? "" },
  {
    header: ticketExportHeader("userComplaintChannel"),
    value: (t) => t.userComplaintChannel ?? "",
  },
  {
    header: ticketExportHeader("complaintReceiveChannel"),
    value: (t) => t.complaintReceiveChannel ?? "",
  },
  { header: ticketExportHeader("customerRequest"), value: (t) => t.customerRequest ?? "" },
  { header: ticketExportHeader("nuclearBodyStatus"), value: (t) => t.nuclearBodyStatus ?? "" },
  {
    header: ticketExportHeader("hasContacted"),
    value: (t) => (t.hasContacted === null ? "" : t.hasContacted ? "是" : "否"),
  },
  {
    header: ticketExportHeader("contactTime"),
    value: (t, { formatDate }) => formatDate(t.contactTime),
  },
  { header: ticketExportHeader("contactId"), value: (t) => t.contactId ?? "" },
  { header: "责任人", value: (t) => t.assignee?.name ?? "" },
  {
    header: ticketExportHeader("feedbackTime"),
    value: (t, { formatDate }) => formatDate(t.feedbackTime),
  },
  { header: "创建时间", value: (t, { formatDate }) => formatDate(t.createdAt) },
  { header: "分配时间", value: (t, { formatDate }) => formatDate(t.assignedAt) },
  { header: "处理时限", value: (t, { formatDate }) => formatDate(t.dueAt) },
  { header: "下次联系时间", value: (t, { formatDate }) => formatDate(t.nextContactTime) },
  { header: "联系次数", value: (t) => t.contactCount },
  { header: "跟进频次", value: (t) => t.followUpFrequency ?? "" },
  { header: "首响要求", value: (t) => t.firstResponseRequirement ?? "" },
  {
    header: "跟进记录",
    value: (t, { formatDate }) =>
      t.processLogs
        .map((log) => `[${formatDate(log.at)}] ${log.operatorName ?? ""}：${log.remark}`)
        .join("\n"),
  },
  { header: "完结时间", value: (t, { formatDate }) => formatDate(t.completionTime) },
  { header: "完结状态", value: (t) => t.completionStatus?.name ?? "" },
];

/**
 * Export every ticket the viewer's current filters match. One `clock.now()`
 * serves the WHERE predicates *and* the 状态 column, so a row selected as
 * overdue can never serialize as anything else (导出时刻口径).
 */
export async function exportTickets(
  { prisma, clock }: TicketServiceDeps,
  viewer: AuthenticatedUser,
  query: TicketExportQuery,
): Promise<ExportFile> {
  const now = clock.now();
  const rows = await prisma.ticket.findMany({
    where: await buildTicketListWhere(prisma, viewer, query, now),
    include: exportInclude,
    orderBy: buildTicketListOrderBy(query),
  });

  return renderExportFile({
    baseName: "tickets",
    format: query.format,
    timeZone: query.timeZone,
    now,
    columns: EXPORT_COLUMNS,
    rows,
  });
}
