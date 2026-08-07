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
import type { PrismaClient } from "../generated/prisma/client";
import { Prisma } from "../generated/prisma/client";
import type { AuthenticatedUser } from "./auth.service";
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
): string {
  switch (field) {
    case "workOrderNumber":
      return ticket.workOrderNumber;
    case "status":
      return TICKET_STATUS_LABELS[ticketStatusSchema.parse(ticket.status)];
    case "processingResult":
      return ticket.processingResult;
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

  const conditions: Prisma.Sql[] = [
    Prisma.sql`t."creatorId" = ${viewer.id}`,
    Prisma.sql`t."deletedAt" IS NULL`,
  ];
  if (query.status && query.status.length > 0) {
    conditions.push(Prisma.sql`t.status IN (${Prisma.join(query.status)})`);
  } else if (!query.includeCompleted) {
    conditions.push(Prisma.sql`t.status <> 'completed'`);
  }
  if (query.completionStatusId && query.completionStatusId.length > 0) {
    conditions.push(
      Prisma.sql`t."completionStatusId" IN (${Prisma.join(query.completionStatusId)})`,
    );
  }
  if (query.feedbackFrom) {
    conditions.push(Prisma.sql`t."feedbackTime" >= ${new Date(query.feedbackFrom)}`);
  }
  if (query.feedbackTo) {
    conditions.push(Prisma.sql`t."feedbackTime" <= ${new Date(query.feedbackTo)}`);
  }
  if (query.search) {
    const pattern = `%${query.search}%`;
    const searchExpressions: Record<string, Prisma.Sql> = {
      submissionText: Prisma.sql`t."submissionText" ILIKE ${pattern}`,
      workOrderNumber: Prisma.sql`t."workOrderNumber" ILIKE ${pattern}`,
      project: Prisma.sql`t.project ILIKE ${pattern}`,
      brokerageEntity: Prisma.sql`t."brokerageEntity" ILIKE ${pattern}`,
      paymentChannel: Prisma.sql`t."paymentChannel" ILIKE ${pattern}`,
      policyNumbers: Prisma.sql`array_to_string(t."policyNumbers", ' ') ILIKE ${pattern}`,
      userComplaintChannel: Prisma.sql`t."userComplaintChannel" ILIKE ${pattern}`,
      complaintReceiveChannel: Prisma.sql`t."complaintReceiveChannel" ILIKE ${pattern}`,
      customerName: Prisma.sql`t."customerName" ILIKE ${pattern}`,
      nuclearBodyStatus: Prisma.sql`t."nuclearBodyStatus" ILIKE ${pattern}`,
      customerRequest: Prisma.sql`t."customerRequest" ILIKE ${pattern}`,
      complaintLevel: Prisma.sql`t."complaintLevel" ILIKE ${pattern}`,
      priority: Prisma.sql`t.priority ILIKE ${pattern}`,
      processingResult: Prisma.sql`t."processingResult" ILIKE ${pattern}`,
    };
    const phoneDigits = query.search.replace(/\D/g, "");
    if (phoneDigits) {
      searchExpressions.phone = Prisma.sql`regexp_replace(t.phone, '[^0-9]', '', 'g') ILIKE ${`%${phoneDigits}%`}`;
    }
    const searchTerms = authorizedFields.flatMap((field) => {
      const expression = searchExpressions[field];
      return expression ? [expression] : [];
    });
    conditions.push(
      searchTerms.length > 0
        ? Prisma.sql`(${Prisma.join(searchTerms, " OR ")})`
        : Prisma.sql`false`,
    );
  }

  const sortExpression =
    query.sortBy === "feedbackTime"
      ? Prisma.sql`t."feedbackTime"`
      : query.sortBy === "status"
        ? Prisma.sql`t.status`
        : query.sortBy === "completionStatus"
          ? Prisma.sql`cs."displayOrder"`
          : Prisma.sql`COALESCE(p.at, t."createdAt")`;
  const sortDirection = query.sortOrder === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;
  const ids = await prisma.$queryRaw<{ id: string }[]>`
    SELECT t.id
    FROM tickets t
    LEFT JOIN completion_statuses cs ON cs.id = t."completionStatusId"
    LEFT JOIN LATERAL (
      SELECT p0.at
      FROM process_logs p0
      WHERE p0."ticketId" = t.id
        AND (
          p0.action IN ('create', 'external_note', 'resolve')
          OR (p0.action = 'comment' AND p0."internalOnly" = false)
        )
      ORDER BY p0.at DESC
      LIMIT 1
    ) p ON true
    WHERE ${Prisma.join(conditions, " AND ")}
    ORDER BY ${sortExpression} ${sortDirection} NULLS LAST, t.id DESC
  `;
  const loaded = await prisma.ticket.findMany({
    where: { id: { in: ids.map((row) => row.id) } },
    include: exportInclude,
  });
  const byId = new Map(loaded.map((ticket) => [ticket.id, ticket]));
  const rows = ids.flatMap(({ id }) => {
    const ticket = byId.get(id);
    return ticket ? [ticket] : [];
  });

  const formatDate = makeDateFormatter(query.timeZone);
  const cells = [
    fieldKeys.map(fieldHeader),
    ...rows.map((ticket) => fieldKeys.map((field) => fieldValue(ticket, field, formatDate))),
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
