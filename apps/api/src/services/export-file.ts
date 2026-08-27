import type { TicketExportFormat } from "@insuredesk/shared";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { resolveTimeZone } from "./time-zone.ts";

export interface ExportFile {
  /** ASCII-safe filename for the Content-Disposition fallback. */
  filename: string;
  contentType: string;
  body: Buffer;
}

/** 列声明：表头是对外契约；value 取导出时刻的展示口径。 */
export interface ExportColumn<Row> {
  header: string;
  value: (row: Row, ctx: ExportContext) => string | number;
}

export interface ExportContext {
  now: Date;
  formatDate: (date: Date | null) => string;
}

export interface ExportSheet<Row> {
  name: string;
  columns: ReadonlyArray<ExportColumn<Row>>;
  rows: readonly Row[];
}

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

function csvField(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(cells: ReadonlyArray<ReadonlyArray<string | number>>): Buffer {
  const lines = cells.map((row) => row.map(csvField).join(","));
  // UTF-8 BOM so Excel (the file's actual audience) decodes Chinese correctly
  return Buffer.from(`\uFEFF${lines.join("\r\n")}\r\n`, "utf8");
}

/**
 * Excel 工作表名硬性规则（ExcelJS 4.4 逐条 throw）：非法字符 \ / ? * [ ] :、
 * 首尾单引号、保留名 History、31 字符上限、非空唯一（唯一性比较大小写不敏感）。
 * sheet 名源自管理员可改的 kind 目录名，须在此统一消毒分配；csv zip 条目复用
 * 同一分配结果——JSZip 把 / 当目录分隔符、重名静默覆盖。
 */
export function allocateSheetNames(names: readonly string[]): string[] {
  const used = new Set<string>();
  return names.map((name, index) => {
    const stripped = name
      .replace(/[\\/?*[\]:]/g, "")
      .replace(/^'+|'+$/g, "")
      .slice(0, 31);
    const base =
      stripped === "" || stripped.toLowerCase() === "history" ? `Sheet${index + 1}` : stripped;
    let candidate = base;
    for (let suffix = 2; used.has(candidate.toLowerCase()); suffix += 1) {
      const tail = ` (${suffix})`;
      candidate = `${base.slice(0, 31 - tail.length)}${tail}`;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

async function toXlsx(
  sheets: ReadonlyArray<{ name: string; cells: ReadonlyArray<ReadonlyArray<string | number>> }>,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  for (const { name, cells } of sheets) {
    const sheet = workbook.addWorksheet(name);
    for (const row of cells) {
      sheet.addRow([...row]);
    }
    sheet.getRow(1).font = { bold: true };
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

const CONTENT_TYPES: Record<TicketExportFormat, string> = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

function makeStampedName(baseName: string, ctx: ExportContext): string {
  const stamp = ctx.formatDate(ctx.now).replace(/[-:]/g, "").replace(" ", "-");
  return `${baseName}-${stamp}`;
}

function buildCells<Row>(
  columns: ReadonlyArray<ExportColumn<Row>>,
  rows: readonly Row[],
  ctx: ExportContext,
): Array<Array<string | number>> {
  return [
    columns.map((column) => column.header),
    ...rows.map((row) => columns.map((column) => column.value(row, ctx))),
  ];
}

export async function renderExportFile<Row>(options: {
  baseName: string;
  format: TicketExportFormat;
  timeZone: string | undefined;
  now: Date;
  columns: ReadonlyArray<ExportColumn<Row>>;
  rows: readonly Row[];
  /** 缺省「工单」（外部口子的既有契约）。 */
  sheetName?: string;
}): Promise<ExportFile> {
  const ctx: ExportContext = { now: options.now, formatDate: makeDateFormatter(options.timeZone) };
  const cells = buildCells(options.columns, options.rows, ctx);

  const filename = `${makeStampedName(options.baseName, ctx)}.${options.format}`;
  if (options.format === "csv") {
    return { filename, contentType: CONTENT_TYPES.csv, body: toCsv(cells) };
  }
  const [sheetName] = allocateSheetNames([options.sheetName ?? "工单"]);
  return {
    filename,
    contentType: CONTENT_TYPES.xlsx,
    body: await toXlsx([{ name: sheetName ?? "工单", cells }]),
  };
}

/** csv 没有多表容器：拆分只能套 zip。 */
export async function renderSplitExportFile<Row>(options: {
  baseName: string;
  format: TicketExportFormat;
  timeZone: string | undefined;
  now: Date;
  sheets: ReadonlyArray<ExportSheet<Row>>;
}): Promise<ExportFile> {
  const ctx: ExportContext = { now: options.now, formatDate: makeDateFormatter(options.timeZone) };
  const stamped = makeStampedName(options.baseName, ctx);
  const names = allocateSheetNames(options.sheets.map((sheet) => sheet.name));

  if (options.format === "csv") {
    const zip = new JSZip();
    for (const [index, sheet] of options.sheets.entries()) {
      zip.file(
        `${names[index] ?? sheet.name}.csv`,
        toCsv(buildCells(sheet.columns, sheet.rows, ctx)),
      );
    }
    return {
      filename: `${stamped}.zip`,
      contentType: "application/zip",
      body: await zip.generateAsync({ type: "nodebuffer" }),
    };
  }
  return {
    filename: `${stamped}.xlsx`,
    contentType: CONTENT_TYPES.xlsx,
    body: await toXlsx(
      options.sheets.map((sheet, index) => ({
        name: names[index] ?? sheet.name,
        cells: buildCells(sheet.columns, sheet.rows, ctx),
      })),
    ),
  };
}
