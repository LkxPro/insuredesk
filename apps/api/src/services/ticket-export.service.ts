import {
  deriveDisplayStatus,
  joinPolicyNumbers,
  PRIORITY_LABELS,
  prioritySchema,
  TICKET_SOURCE_LABELS,
  TICKET_STATUS_LABELS,
  type TicketExportQuery,
  TicketKindKey,
  ticketExportHeader,
  ticketSourceSchema,
  ticketStatusSchema,
} from "@insuredesk/shared";
import type { Prisma } from "../generated/prisma/client.ts";
import type { AuthenticatedUser } from "./auth.service.ts";
import {
  type ExportColumn,
  type ExportFile,
  type ExportSheet,
  renderExportFile,
  renderSplitExportFile,
} from "./export-file.ts";
import {
  buildTicketListOrderBy,
  buildTicketListWhere,
  type TicketServiceDeps,
} from "./ticket.service.ts";
import { TicketKindNotConfiguredError } from "./ticket-kind.service.ts";

/** 导出不写 ProcessLog：列表级批量读，不是单票时间线事件。 */

const exportInclude = {
  // Current follow-up owner is derived via JOIN, never stored
  assignee: { select: { name: true } },
  completionStatus: { select: { name: true } },
  slaPolicy: { select: { name: true } },
  kind: { select: { key: true } },
  complaintDetail: {
    include: {
      // Catalog references render their CURRENT names — a rename shows through
      category: { select: { name: true } },
      channel: { select: { name: true } },
      userFeedbackChannel: { select: { name: true } },
      feedbackReceiveChannel: { select: { name: true } },
    },
  },
  refundDetail: { select: { failureReason: true, expectedAmount: true, compensationAmount: true } },
  // internalOnly 不过滤：内部导出照常包含
  processLogs: {
    where: { action: "comment" },
    orderBy: [{ at: "asc" }, { id: "asc" }],
    select: { at: true, operatorName: true, remark: true },
  },
} satisfies Prisma.TicketInclude;

type TicketExportRow = Prisma.TicketGetPayload<{ include: typeof exportInclude }>;

/** 共有列集：列序与系统列表头是对外契约，手写维持现状。 */
const COMMON_EXPORT_COLUMNS: ReadonlyArray<ExportColumn<TicketExportRow>> = [
  { header: "工单号", value: (t) => t.workOrderNumber },
  {
    header: "状态",
    value: (t, { now }) =>
      TICKET_STATUS_LABELS[deriveDisplayStatus(ticketStatusSchema.parse(t.status), t.dueAt, now)],
  },
  {
    header: ticketExportHeader("customerName"),
    value: (t) => t.complaintDetail?.customerName ?? "",
  },
  { header: ticketExportHeader("phone"), value: (t) => t.complaintDetail?.phone ?? "" },
  { header: ticketExportHeader("contactPhone"), value: (t) => t.contactPhone ?? "" },
  {
    header: ticketExportHeader("policyNumbers"),
    value: (t) =>
      t.complaintDetail?.noPolicyNumber
        ? "无"
        : joinPolicyNumbers(t.complaintDetail?.policyNumbers ?? []),
  },
  {
    header: ticketExportHeader("channelId"),
    value: (t) => t.complaintDetail?.channel?.name ?? "",
  },
  { header: ticketExportHeader("slaPolicyId"), value: (t) => t.slaPolicy?.name ?? "" },
  {
    header: ticketExportHeader("categoryId"),
    value: (t) => t.complaintDetail?.category?.name ?? "",
  },
  {
    header: ticketExportHeader("priority"),
    value: (t) => {
      const priority = t.complaintDetail?.priority ?? null;
      return priority === null ? "" : PRIORITY_LABELS[prioritySchema.parse(priority)];
    },
  },
  { header: "来源", value: (t) => TICKET_SOURCE_LABELS[ticketSourceSchema.parse(t.source)] },
  { header: ticketExportHeader("project"), value: (t) => t.complaintDetail?.project ?? "" },
  {
    header: ticketExportHeader("brokerageEntity"),
    value: (t) => t.complaintDetail?.brokerageEntity ?? "",
  },
  {
    header: ticketExportHeader("paymentChannel"),
    value: (t) => t.complaintDetail?.paymentChannel ?? "",
  },
  {
    header: ticketExportHeader("internalOrderNumber"),
    value: (t) => t.complaintDetail?.internalOrderNumber ?? "",
  },
  {
    header: ticketExportHeader("userFeedbackChannelId"),
    value: (t) => t.complaintDetail?.userFeedbackChannel?.name ?? "",
  },
  {
    header: ticketExportHeader("feedbackReceiveChannelId"),
    value: (t) => t.complaintDetail?.feedbackReceiveChannel?.name ?? "",
  },
  {
    header: ticketExportHeader("customerRequest"),
    value: (t) => t.complaintDetail?.customerRequest ?? "",
  },
  {
    header: ticketExportHeader("nuclearBodyStatus"),
    value: (t) => t.complaintDetail?.nuclearBodyStatus ?? "",
  },
  {
    header: ticketExportHeader("hasContacted"),
    value: (t) => {
      const hasContacted = t.complaintDetail?.hasContacted ?? null;
      return hasContacted === null ? "" : hasContacted ? "是" : "否";
    },
  },
  {
    header: ticketExportHeader("contactTime"),
    value: (t, { formatDate }) => formatDate(t.complaintDetail?.contactTime ?? null),
  },
  { header: ticketExportHeader("contactId"), value: (t) => t.complaintDetail?.contactId ?? "" },
  { header: "责任人", value: (t) => t.assignee?.name ?? "" },
  {
    header: ticketExportHeader("feedbackTime"),
    value: (t, { formatDate }) => formatDate(t.complaintDetail?.feedbackTime ?? null),
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

const REFUND_ONLY_COLUMNS: ReadonlyArray<ExportColumn<TicketExportRow>> = [
  { header: "退费异常原因", value: (t) => t.refundDetail?.failureReason ?? "" },
  { header: "应退金额", value: (t) => t.refundDetail?.expectedAmount ?? "" },
  { header: "补偿金", value: (t) => t.refundDetail?.compensationAmount ?? "" },
];

/**
 * One `clock.now()` serves the WHERE predicates *and* the 状态 column, so a
 * row selected as overdue can never serialize as anything else (导出时刻口径).
 */
export async function exportTickets(
  { prisma, clock }: TicketServiceDeps,
  viewer: AuthenticatedUser,
  query: TicketExportQuery,
): Promise<ExportFile> {
  const now = clock.now();
  const where = await buildTicketListWhere(prisma, viewer, query, now);
  const [rows, complaintKind, refundKind] = await Promise.all([
    prisma.ticket.findMany({
      where,
      include: exportInclude,
      orderBy: buildTicketListOrderBy(query),
    }),
    prisma.ticketKind.findUnique({ where: { key: TicketKindKey.Complaint } }),
    prisma.ticketKind.findUnique({ where: { key: TicketKindKey.RefundException } }),
  ]);
  if (!complaintKind) {
    throw new TicketKindNotConfiguredError(TicketKindKey.Complaint);
  }
  if (!refundKind) {
    throw new TicketKindNotConfiguredError(TicketKindKey.RefundException);
  }

  const complaintSheet: ExportSheet<TicketExportRow> = {
    name: complaintKind.name,
    columns: COMMON_EXPORT_COLUMNS,
    rows: rows.filter((row) => row.kind.key !== TicketKindKey.RefundException),
  };
  const refundSheet: ExportSheet<TicketExportRow> = {
    name: refundKind.name,
    columns: [...COMMON_EXPORT_COLUMNS, ...REFUND_ONLY_COLUMNS],
    rows: rows.filter((row) => row.kind.key === TicketKindKey.RefundException),
  };

  const lockedKindId = query.kindId?.length === 1 ? query.kindId[0] : undefined;
  if (lockedKindId !== undefined) {
    const lockedKind = await prisma.ticketKind.findUnique({ where: { id: lockedKindId } });
    const sheet = lockedKind?.key === TicketKindKey.RefundException ? refundSheet : complaintSheet;
    return renderExportFile({
      baseName: "tickets",
      format: query.format,
      timeZone: query.timeZone,
      now,
      columns: sheet.columns,
      rows: sheet.rows,
      sheetName: sheet.name,
    });
  }

  return renderSplitExportFile({
    baseName: "tickets",
    format: query.format,
    timeZone: query.timeZone,
    now,
    sheets: [complaintSheet, refundSheet],
  });
}
