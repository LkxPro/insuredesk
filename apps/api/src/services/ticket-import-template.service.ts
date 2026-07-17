import {
  COMPLAINT_LEVELS,
  NUCLEAR_BODY_STATUSES,
  PRIORITIES,
  PRIORITY_LABELS,
  TICKET_IMPORT_ROW_LIMIT,
} from "@insuredesk/shared";
import ExcelJS from "exceljs";
import type { PrismaClient } from "../generated/prisma/client";
import { listChannelOptions } from "./channel.service";
import { listTicketCategoryOptions } from "./ticket-category.service";

/**
 * 批量导入 template: a dynamically generated workbook, never a static asset —
 * the 渠道/客诉类别 dropdowns are the ACTIVE catalog rows at download time, so
 * a stale file is fixed by re-downloading, not by re-deploying.
 *
 * Column set = the 18 建单表单 fields, Chinese headers in the form's visual
 * order — the headers are the contract upload parsing resolves columns by.
 */

export interface TicketImportTemplateFile {
  /** ASCII-safe filename for the Content-Disposition fallback. */
  filename: string;
  contentType: string;
  body: Buffer;
}

const HAS_CONTACTED_OPTIONS = ["是", "否"] as const;

/** The active-catalog names resolved once per download, fed to every dropdown. */
type CatalogOptions = { channels: string[]; categories: string[] };

type ImportColumn = {
  header: string;
  /** 填写说明 sheet entry for this column. */
  note: string;
  /** Dropdown feed; static lists inline, catalog lists resolved per download. */
  options?: (catalogs: CatalogOptions) => readonly string[];
};

const TICKET_IMPORT_COLUMNS: readonly ImportColumn[] = [
  {
    header: "反馈时间",
    note: "格式 yyyy-MM-dd HH:mm（如 2026-07-09 14:30）；留空=未填写",
  },
  {
    header: "反馈渠道",
    note: "从下拉选择（下载模板时启用的渠道目录）；留空=未填写",
    options: ({ channels }) => channels,
  },
  { header: "项目（保司）", note: "文本，最长 100 字；如：融盛、泰康" },
  { header: "经纪主体", note: "文本，最长 100 字；如：东方大地" },
  { header: "支付渠道", note: "文本，最长 100 字；如：连连支付" },
  { header: "内部订单号", note: "文本，最长 200 字" },
  { header: "保单号", note: "文本，最长 100 字" },
  { header: "用户投诉渠道", note: "文本，最长 100 字；如：飞书投诉、400热线" },
  { header: "客户姓名", note: "文本，最长 100 字" },
  { header: "客户电话（投保人）", note: "文本，最长 50 字" },
  { header: "联系人电话", note: "文本，最长 200 字" },
  {
    header: "保司侧是否核身",
    note: "从下拉选择：是 / 否 / 待核实；留空=未填写",
    options: () => NUCLEAR_BODY_STATUSES,
  },
  { header: "客户诉求", note: "文本，最长 2000 字" },
  {
    header: "客户曾进线",
    note: "从下拉选择：是 / 否；留空=未知",
    options: () => HAS_CONTACTED_OPTIONS,
  },
  { header: "进线ID", note: "文本，最长 200 字" },
  {
    header: "客诉类别",
    note: "从下拉选择（下载模板时启用的类别目录）；留空=未填写",
    options: ({ categories }) => categories,
  },
  {
    header: "投诉等级",
    note: `从下拉选择：${COMPLAINT_LEVELS.join(" / ")}；留空=未定级（无处理时限与 SLA 告警）`,
    options: () => COMPLAINT_LEVELS,
  },
  {
    header: "优先级",
    note: `从下拉选择：${PRIORITIES.map((priority) => PRIORITY_LABELS[priority]).join(" / ")}；留空=未设置`,
    options: () => PRIORITIES.map((priority) => PRIORITY_LABELS[priority]),
  },
];

/**
 * The header contract in column order — upload parsing must resolve columns
 * by exactly these names (ticket-import.service.ts asserts alignment).
 */
export const TICKET_IMPORT_TEMPLATE_HEADERS: readonly string[] = TICKET_IMPORT_COLUMNS.map(
  (column) => column.header,
);

/**
 * exceljs implements worksheet.dataValidations (range-level validations,
 * written as one sqref) at runtime but omits it from its typings — the
 * per-cell `cell.dataValidation` alternative would materialize 2000 cells
 * per dropdown column.
 */
type WorksheetWithValidations = ExcelJS.Worksheet & {
  dataValidations: { add(range: string, validation: ExcelJS.DataValidation): void };
};

/** A1-style column letter; the 18-column sheet never leaves A–Z. */
function columnLetter(column: number): string {
  return String.fromCharCode(64 + column);
}

export async function buildTicketImportTemplate(
  prisma: PrismaClient,
): Promise<TicketImportTemplateFile> {
  const [channels, categories] = await Promise.all([
    listChannelOptions(prisma),
    listTicketCategoryOptions(prisma),
  ]);
  const catalogs: CatalogOptions = {
    channels: channels.map((channel) => channel.name),
    categories: categories.map((category) => category.name),
  };

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("工单", { views: [{ state: "frozen", ySplit: 1 }] });
  const notes = workbook.addWorksheet("填写说明");
  // Option feeds live on their own sheet because inline validation lists cap
  // at 255 characters — a grown catalog would silently truncate. Hidden, not
  // veryHidden: inspecting the feed is harmless.
  const options = workbook.addWorksheet("选项");
  options.state = "hidden";

  sheet.addRow(TICKET_IMPORT_COLUMNS.map((column) => column.header));
  sheet.getRow(1).font = { bold: true };
  for (const [index, column] of TICKET_IMPORT_COLUMNS.entries()) {
    sheet.getColumn(index + 1).width = Math.max(14, column.header.length * 2 + 4);
  }

  for (const [index, column] of TICKET_IMPORT_COLUMNS.entries()) {
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
  notes.addRow(["下拉选项按下载时刻的启用目录生成；目录调整后请重新下载模板。"]);
  notes.addRow([]);
  const notesHeader = notes.addRow(["列名", "取值规则"]);
  notesHeader.font = { bold: true };
  for (const column of TICKET_IMPORT_COLUMNS) {
    notes.addRow([column.header, column.note]);
  }

  return {
    filename: "ticket-import-template.xlsx",
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    body: Buffer.from(await workbook.xlsx.writeBuffer()),
  };
}
