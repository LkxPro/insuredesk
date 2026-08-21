import {
  TICKET_FIELD_DESCRIPTORS,
  TICKET_IMPORT_ROW_LIMIT,
  type TicketCatalogKind,
  type TicketFieldDescriptor,
  ticketImportFieldNote,
} from "@insuredesk/shared";
import ExcelJS from "exceljs";
import type { PrismaClient } from "../generated/prisma/client.ts";
import { channelCatalog } from "./channel.service.ts";
import { completionStatusCatalog } from "./completion-status.service.ts";
import { feedbackReceiveChannelCatalog } from "./feedback-receive-channel.service.ts";
import { ticketCategoryCatalog } from "./ticket-category.service.ts";
import { userFeedbackChannelCatalog } from "./user-feedback-channel.service.ts";

/**
 * 批量导入 template: a dynamically generated workbook, never a static asset —
 * the 渠道/客诉类别/完结状态/时效策略 dropdowns are the ACTIVE catalog rows at
 * download time, so a stale file is fixed by re-downloading, not by re-deploying.
 *
 * Column set = the 建单表单 fields plus the 完结状态/完结备注 pair (历史工单迁移:
 * both filled ⇒ the row lands already completed), Chinese headers in the form's
 * visual order — the same descriptor rows upload parsing resolves columns by.
 */

export interface TicketImportTemplateFile {
  /** ASCII-safe filename for the Content-Disposition fallback. */
  filename: string;
  contentType: string;
  body: Buffer;
}

type CatalogOptions = {
  channels: string[];
  categories: string[];
  completionStatuses: string[];
  slaPolicies: string[];
  userFeedbackChannels: string[];
  feedbackReceiveChannels: string[];
};

const CATALOG_OPTION_KEYS: Record<TicketCatalogKind, keyof CatalogOptions> = {
  channel: "channels",
  category: "categories",
  completionStatus: "completionStatuses",
  slaPolicy: "slaPolicies",
  userFeedbackChannel: "userFeedbackChannels",
  feedbackReceiveChannel: "feedbackReceiveChannels",
};

type ImportColumn = {
  header: string;
  note: string;
  options?: (catalogs: CatalogOptions) => readonly string[];
};

function toTemplateColumn(descriptor: TicketFieldDescriptor): ImportColumn {
  const column: ImportColumn = {
    header: descriptor.label,
    note: ticketImportFieldNote(descriptor),
  };
  if (descriptor.type === "enum") {
    const labels = descriptor.options.map((option) => option.label);
    column.options = () => labels;
  } else if (descriptor.type === "catalog") {
    const key = CATALOG_OPTION_KEYS[descriptor.catalog];
    column.options = (catalogs) => catalogs[key];
  }
  return column;
}

export const TICKET_IMPORT_TEMPLATE_COLUMNS: readonly ImportColumn[] =
  TICKET_FIELD_DESCRIPTORS.filter(
    (descriptor) => !("formOnly" in descriptor && descriptor.formOnly === true),
  ).map(toTemplateColumn);

/**
 * exceljs implements worksheet.dataValidations (range-level validations,
 * written as one sqref) at runtime but omits it from its typings — the
 * per-cell `cell.dataValidation` alternative would materialize 2000 cells
 * per dropdown column.
 */
type WorksheetWithValidations = ExcelJS.Worksheet & {
  dataValidations: { add(range: string, validation: ExcelJS.DataValidation): void };
};

/** A1-style column letter; the sheet never leaves A–Z. */
function columnLetter(column: number): string {
  return String.fromCharCode(64 + column);
}

export async function buildTicketImportTemplate(
  prisma: PrismaClient,
): Promise<TicketImportTemplateFile> {
  const [
    channels,
    categories,
    completionStatuses,
    slaPolicies,
    userFeedbackChannels,
    feedbackReceiveChannels,
  ] = await Promise.all([
    channelCatalog.listOptions(prisma),
    ticketCategoryCatalog.listOptions(prisma),
    completionStatusCatalog.listOptions(prisma),
    prisma.slaPolicy.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { name: true },
    }),
    userFeedbackChannelCatalog.listOptions(prisma),
    feedbackReceiveChannelCatalog.listOptions(prisma),
  ]);
  const catalogs: CatalogOptions = {
    channels: channels.map((channel) => channel.name),
    categories: categories.map((category) => category.name),
    completionStatuses: completionStatuses.map((status) => status.name),
    slaPolicies: slaPolicies.map((policy) => policy.name),
    userFeedbackChannels: userFeedbackChannels.map((channel) => channel.name),
    feedbackReceiveChannels: feedbackReceiveChannels.map((channel) => channel.name),
  };

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("工单", { views: [{ state: "frozen", ySplit: 1 }] });
  const notes = workbook.addWorksheet("填写说明");
  // Option feeds live on their own sheet because inline validation lists cap
  // at 255 characters — a grown catalog would silently truncate. Hidden, not
  // veryHidden: inspecting the feed is harmless.
  const options = workbook.addWorksheet("选项");
  options.state = "hidden";

  sheet.addRow(TICKET_IMPORT_TEMPLATE_COLUMNS.map((column) => column.header));
  sheet.getRow(1).font = { bold: true };
  for (const [index, column] of TICKET_IMPORT_TEMPLATE_COLUMNS.entries()) {
    sheet.getColumn(index + 1).width = Math.max(14, column.header.length * 2 + 4);
  }

  for (const [index, column] of TICKET_IMPORT_TEMPLATE_COLUMNS.entries()) {
    const values = column.options?.(catalogs);
    if (!values || values.length === 0) {
      continue;
    }
    const optionColumn = options.getColumn(index + 1);
    optionColumn.values = [column.header, ...values];

    const letter = columnLetter(index + 1);
    const feed = `'选项'!$${letter}$2:$${letter}$${values.length + 1}`;
    (sheet as WorksheetWithValidations).dataValidations.add(
      `${letter}2:${letter}${TICKET_IMPORT_ROW_LIMIT + 1}`,
      {
        type: "list",
        allowBlank: true,
        formulae: [feed],
        showErrorMessage: true,
        errorTitle: "无效取值",
        error: `请从下拉列表中选择「${column.header}」的取值，或留空`,
      },
    );
  }

  notes.getColumn(1).width = 22;
  notes.getColumn(2).width = 80;
  notes.addRow([`一次最多导入 ${TICKET_IMPORT_ROW_LIMIT} 行（不含表头），超出请分批。`]);
  notes.addRow(["所有列均可留空：留空=未填写/未知，不会代填任何默认值。"]);
  notes.addRow([
    "「完结状态」「完结备注」两列同填的行导入后直接为已完结（历史工单迁移）；仅填其中一列会整批报错，两列都留空照常落未分配。",
  ]);
  notes.addRow(["下拉选项按下载时刻的启用目录生成；目录调整后请重新下载模板。"]);
  notes.addRow([]);
  const notesHeader = notes.addRow(["列名", "取值规则"]);
  notesHeader.font = { bold: true };
  for (const column of TICKET_IMPORT_TEMPLATE_COLUMNS) {
    notes.addRow([column.header, column.note]);
  }

  return {
    filename: "ticket-import-template.xlsx",
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    body: Buffer.from(await workbook.xlsx.writeBuffer()),
  };
}
