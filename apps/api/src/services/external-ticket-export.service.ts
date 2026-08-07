import {
  DEFAULT_EXTERNAL_DETAIL_FIELDS,
  type ExternalTicketExportQuery,
  joinPolicyNumbers,
  PRIORITY_LABELS,
  prioritySchema,
  resolveExternalFieldOrder,
  resolveExternalVisibleFields,
  TICKET_STATUS_LABELS,
  type TicketFieldKey,
  ticketExportHeader,
  ticketStatusSchema,
} from "@insuredesk/shared";
import ExcelJS from "exceljs";
import type { Prisma, PrismaClient } from "../generated/prisma/client";
import type { AuthenticatedUser } from "./auth.service";
import {
  buildExternalTicketWhere,
  EXTERNAL_PUBLIC_PROCESSING_RESULT_SQL,
  EXTERNAL_VISIBLE_ACTIVITY_CONDITION,
  externalTicketSortDirection,
  externalTicketSortExpression,
} from "./external-ticket-query";
import { resolveTimeZone } from "./time-zone";

export interface ExternalTicketExportFile {
  filename: string;
  contentType: string;
  body: Buffer;
}

const exportInclude = {
  channel: { select: { name: true } },
  category: { select: { name: true } },
  completionStatus: { select: { name: true } },
} satisfies Prisma.TicketInclude;

type ExportTicket = Prisma.TicketGetPayload<{ include: typeof exportInclude }>;

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
  return (date: Date | null): string =>
    date === null ? "" : formatter.format(date).replace(", ", " ");
}

const SYSTEM_HEADERS: Readonly<Record<string, string>> = {
  workOrderNumber: "工单号",
  status: "状态",
  processingResult: "最新处理",
  completionStatusId: "完结状态",
  submissionText: "工单原文",
};

function fieldHeader(field: string): string {
  return SYSTEM_HEADERS[field] ?? ticketExportHeader(field as TicketFieldKey);
}

function fieldValue(
  ticket: ExportTicket,
  field: string,
  formatDate: (date: Date | null) => string,
  publicProcessingResult: string,
): string {
  switch (field) {
    case "workOrderNumber":
      return ticket.workOrderNumber;
    case "status":
      return TICKET_STATUS_LABELS[ticketStatusSchema.parse(ticket.status)];
    case "processingResult":
      return publicProcessingResult;
    case "completionStatusId":
      return ticket.completionStatus?.name ?? "";
    case "feedbackTime":
      return formatDate(ticket.feedbackTime);
    case "channelId":
      return ticket.channel?.name ?? "";
    case "policyNumbers":
      return joinPolicyNumbers(ticket.policyNumbers);
    case "hasContacted":
      return ticket.hasContacted === null ? "" : ticket.hasContacted ? "是" : "否";
    case "contactTime":
      return formatDate(ticket.contactTime);
    case "categoryId":
      return ticket.category?.name ?? "";
    case "priority":
      return ticket.priority === null ? "" : PRIORITY_LABELS[prioritySchema.parse(ticket.priority)];
    default: {
      const value = ticket[field as keyof ExportTicket];
      return typeof value === "string" ? value : "";
    }
  }
}

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function toCsv(cells: readonly (readonly string[])[]): Buffer {
  return Buffer.from(
    `\uFEFF${cells.map((row) => row.map(csvField).join(",")).join("\r\n")}\r\n`,
    "utf8",
  );
}

async function toXlsx(cells: readonly (readonly string[])[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("工单");
  for (const row of cells) sheet.addRow([...row]);
  sheet.getRow(1).font = { bold: true };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function filenameStamp(formatDate: (date: Date | null) => string, now: Date): string {
  return formatDate(now).replace(/[-:]/g, "").replace(" ", "-");
}

export async function exportExternalTickets(
  prisma: PrismaClient,
  viewer: AuthenticatedUser,
  query: ExternalTicketExportQuery,
  now: Date,
): Promise<ExternalTicketExportFile> {
  const account = await prisma.user.findUniqueOrThrow({
    where: { id: viewer.id },
    select: {
      externalDetailFields: true,
      externalExportOrder: true,
    },
  });
  const authorizedFields = resolveExternalVisibleFields(
    account.externalDetailFields,
    DEFAULT_EXTERNAL_DETAIL_FIELDS,
  );
  const fieldKeys = resolveExternalFieldOrder(account.externalExportOrder, authorizedFields);

  const whereSql = buildExternalTicketWhere(query, viewer.id, authorizedFields);
  const sortExpression = externalTicketSortExpression(query.sortBy);
  const sortDirection = externalTicketSortDirection(query.sortOrder);
  const idRows = await prisma.$queryRaw<{ id: string; public_processing_result: string | null }[]>`
    SELECT t.id, ${EXTERNAL_PUBLIC_PROCESSING_RESULT_SQL} AS public_processing_result
    FROM tickets t
    LEFT JOIN completion_statuses cs ON cs.id = t."completionStatusId"
    LEFT JOIN LATERAL (
      SELECT p0.at
      FROM process_logs p0
      WHERE p0."ticketId" = t.id
        AND ${EXTERNAL_VISIBLE_ACTIVITY_CONDITION}
      ORDER BY p0.at DESC
      LIMIT 1
    ) p ON true
    WHERE ${whereSql}
    ORDER BY ${sortExpression} ${sortDirection} NULLS LAST, t.id DESC
  `;
  const loaded = await prisma.ticket.findMany({
    where: { id: { in: idRows.map((row) => row.id) } },
    include: exportInclude,
  });
  const byId = new Map(loaded.map((ticket) => [ticket.id, ticket]));
  const rows = idRows.flatMap(({ id, public_processing_result }) => {
    const ticket = byId.get(id);
    return ticket ? [{ ticket, publicProcessingResult: public_processing_result ?? "" }] : [];
  });

  const formatDate = makeDateFormatter(query.timeZone);
  const cells = [
    fieldKeys.map(fieldHeader),
    ...rows.map(({ ticket, publicProcessingResult }) =>
      fieldKeys.map((field) => fieldValue(ticket, field, formatDate, publicProcessingResult)),
    ),
  ];
  await prisma.externalTicketExportAudit.create({
    data: {
      userId: viewer.id,
      format: query.format,
      filterSnapshot: JSON.stringify(query),
      fieldKeys,
      rowCount: rows.length,
      at: now,
    },
  });

  const stamp = filenameStamp(formatDate, now);
  return query.format === "csv"
    ? {
        filename: `external-tickets-${stamp}.csv`,
        contentType: "text/csv; charset=utf-8",
        body: toCsv(cells),
      }
    : {
        filename: `external-tickets-${stamp}.xlsx`,
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        body: await toXlsx(cells),
      };
}
