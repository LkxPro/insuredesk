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

async function toXlsx(
  sheets: ReadonlyArray<{ name: string; cells: ReadonlyArray<ReadonlyArray<string | number>> }>,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const usedNames = new Set<string>();
  for (const [index, { name, cells }] of sheets.entries()) {
    // Excel 工作表名硬性命名规则（非法字符/31 字符上限/非空唯一）；sheet 名源自管理员可改的目录名，须消毒
    let sheetName = name.replace(/[\\/?*[\]:]/g, "").slice(0, 31);
    if (sheetName === "" || usedNames.has(sheetName)) {
      sheetName = `Sheet${index + 1}`;
    }
    usedNames.add(sheetName);
    const sheet = workbook.addWorksheet(sheetName);
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
  /** xlsx sheet 名；缺省「工单」（外部口子的既有契约）。 */
  sheetName?: string;
}): Promise<ExportFile> {
  const ctx: ExportContext = { now: options.now, formatDate: makeDateFormatter(options.timeZone) };
  const cells = buildCells(options.columns, options.rows, ctx);

  const filename = `${makeStampedName(options.baseName, ctx)}.${options.format}`;
  if (options.format === "csv") {
    return { filename, contentType: CONTENT_TYPES.csv, body: toCsv(cells) };
  }
  return {
    filename,
    contentType: CONTENT_TYPES.xlsx,
    body: await toXlsx([{ name: options.sheetName ?? "工单", cells }]),
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

  if (options.format === "csv") {
    const zip = new JSZip();
    for (const sheet of options.sheets) {
      zip.file(`${sheet.name}.csv`, toCsv(buildCells(sheet.columns, sheet.rows, ctx)));
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
      options.sheets.map((sheet) => ({
        name: sheet.name,
        cells: buildCells(sheet.columns, sheet.rows, ctx),
      })),
    ),
  };
}
