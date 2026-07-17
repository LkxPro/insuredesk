import {
  deriveDisplayStatus,
  PRIORITY_LABELS,
  prioritySchema,
  TICKET_SOURCE_LABELS,
  TICKET_STATUS_LABELS,
  type TicketExportQuery,
  ticketSourceSchema,
  ticketStatusSchema,
} from "@insuredesk/shared";
import ExcelJS from "exceljs";
import type { Prisma } from "../generated/prisma/client";
import type { AuthenticatedUser } from "./auth.service";
import {
  buildTicketListOrderBy,
  buildTicketListWhere,
  type TicketServiceDeps,
} from "./ticket.service";
import { resolveTimeZone } from "./time-zone";

/**
 * 导出工单: the viewer's *filtered list*, as a file. Reuses the list's
 * WHERE/ORDER builders verbatim, so filters, soft-delete exclusion, and the
 * RBAC data scope (个人档只能导出指派给我或我创建的单) can never drift from
 * what the list page shows. Read-only by design: an export writes no
 * ProcessLog — it is a list-level batch read, not a per-ticket timeline
 * event.
 */

export interface TicketExportFile {
  /** ASCII-safe filename for the Content-Disposition fallback. */
  filename: string;
  contentType: string;
  body: Buffer;
}

const exportInclude = {
  // Current follow-up owner is derived via JOIN, never stored
  assignee: { select: { name: true } },
  // Catalog references render their CURRENT names — a rename shows through
  category: { select: { name: true } },
  channel: { select: { name: true } },
  completionStatus: { select: { name: true } },
} satisfies Prisma.TicketInclude;

type TicketExportRow = Prisma.TicketGetPayload<{ include: typeof exportInclude }>;

/** "yyyy-MM-dd HH:mm" in the requested zone; empty cell for null dates. */
function makeDateFormatter(timeZone: string | undefined) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: resolveTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return (date: Date | null): string => {
    if (date === null) {
      return "";
    }
    // en-CA yields "2026-07-10, 14:30" — normalize to the list page's shape
    return formatter.format(date).replace(", ", " ");
  };
}

type ExportContext = { now: Date; formatDate: (date: Date | null) => string };

/**
 * 导出列：工单关键字段, in the detail page's reading order. 状态 is the
 * computed display status at export time (导出时刻口径) — same derivation as
 * the list, labelled in Chinese like every other enum column.
 */
const EXPORT_COLUMNS: ReadonlyArray<{
  header: string;
  value: (ticket: TicketExportRow, ctx: ExportContext) => string | number;
}> = [
  { header: "工单号", value: (t) => t.workOrderNumber },
  {
    header: "状态",
    value: (t, { now }) =>
      TICKET_STATUS_LABELS[deriveDisplayStatus(ticketStatusSchema.parse(t.status), t.dueAt, now)],
  },
  { header: "客户姓名", value: (t) => t.customerName ?? "" },
  { header: "客户电话", value: (t) => t.phone ?? "" },
  { header: "联系电话", value: (t) => t.contactPhone ?? "" },
  { header: "保单号", value: (t) => t.policyNumber ?? "" },
  { header: "渠道", value: (t) => t.channel?.name ?? "" },
  { header: "投诉等级", value: (t) => t.complaintLevel ?? "" },
  { header: "分类", value: (t) => t.category?.name ?? "" },
  {
    header: "优先级",
    value: (t) => (t.priority === null ? "" : PRIORITY_LABELS[prioritySchema.parse(t.priority)]),
  },
  { header: "来源", value: (t) => TICKET_SOURCE_LABELS[ticketSourceSchema.parse(t.source)] },
  { header: "项目", value: (t) => t.project ?? "" },
  { header: "经纪主体", value: (t) => t.brokerageEntity ?? "" },
  { header: "支付渠道", value: (t) => t.paymentChannel ?? "" },
  { header: "内部订单号", value: (t) => t.internalOrderNumber ?? "" },
  { header: "用户投诉渠道", value: (t) => t.userComplaintChannel ?? "" },
  { header: "客户诉求", value: (t) => t.customerRequest ?? "" },
  { header: "核体状态", value: (t) => t.nuclearBodyStatus ?? "" },
  {
    header: "是否已联系",
    value: (t) => (t.hasContacted === null ? "" : t.hasContacted ? "是" : "否"),
  },
  { header: "联系ID", value: (t) => t.contactId ?? "" },
  { header: "责任人", value: (t) => t.assignee?.name ?? "" },
  { header: "反馈时间", value: (t, { formatDate }) => formatDate(t.feedbackTime) },
  { header: "创建时间", value: (t, { formatDate }) => formatDate(t.createdAt) },
  { header: "分配时间", value: (t, { formatDate }) => formatDate(t.assignedAt) },
  { header: "处理时限", value: (t, { formatDate }) => formatDate(t.dueAt) },
  { header: "下次联系时间", value: (t, { formatDate }) => formatDate(t.nextContactTime) },
  { header: "联系次数", value: (t) => t.contactCount },
  { header: "跟进频次", value: (t) => t.followUpFrequency ?? "" },
  { header: "首响要求", value: (t) => t.firstResponseRequirement ?? "" },
  { header: "处理结果", value: (t) => t.processingResult ?? "" },
  { header: "完结时间", value: (t, { formatDate }) => formatDate(t.completionTime) },
  { header: "完结状态", value: (t) => t.completionStatus?.name ?? "" },
];

/** RFC 4180 field escaping: quote when the value contains , " or a newline. */
function csvField(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(cells: ReadonlyArray<ReadonlyArray<string | number>>): Buffer {
  const lines = cells.map((row) => row.map(csvField).join(","));
  // UTF-8 BOM so Excel (the file's actual audience) decodes Chinese correctly
  return Buffer.from(`\uFEFF${lines.join("\r\n")}\r\n`, "utf8");
}

async function toXlsx(cells: ReadonlyArray<ReadonlyArray<string | number>>): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("工单");
  for (const row of cells) {
    sheet.addRow([...row]);
  }
  sheet.getRow(1).font = { bold: true };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** Compact export-time stamp for the filename, in the requested zone. */
function filenameStamp(formatDate: (date: Date | null) => string, now: Date): string {
  return formatDate(now).replace(/[-:]/g, "").replace(" ", "-");
}

/**
 * Export every ticket the viewer's current filters match. One `clock.now()`
 * serves the WHERE predicates *and* the 状态 column, so a row selected as
 * overdue can never serialize as anything else (导出时刻口径).
 */
export async function exportTickets(
  { prisma, clock }: TicketServiceDeps,
  viewer: AuthenticatedUser,
  query: TicketExportQuery,
): Promise<TicketExportFile> {
  const now = clock.now();
  const rows = await prisma.ticket.findMany({
    where: buildTicketListWhere(viewer, query, now),
    include: exportInclude,
    orderBy: buildTicketListOrderBy(query),
  });

  const ctx: ExportContext = { now, formatDate: makeDateFormatter(query.timeZone) };
  const cells: Array<Array<string | number>> = [
    EXPORT_COLUMNS.map((column) => column.header),
    ...rows.map((ticket) => EXPORT_COLUMNS.map((column) => column.value(ticket, ctx))),
  ];

  const stamp = filenameStamp(ctx.formatDate, now);
  if (query.format === "csv") {
    return {
      filename: `tickets-${stamp}.csv`,
      contentType: "text/csv; charset=utf-8",
      body: toCsv(cells),
    };
  }
  return {
    filename: `tickets-${stamp}.xlsx`,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    body: await toXlsx(cells),
  };
}
