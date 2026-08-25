import type { TicketExportFormat } from "@insuredesk/shared";
import ExcelJS from "exceljs";
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

async function toXlsx(cells: ReadonlyArray<ReadonlyArray<string | number>>): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("工单");
  for (const row of cells) {
    sheet.addRow([...row]);
  }
  sheet.getRow(1).font = { bold: true };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

const CONTENT_TYPES: Record<TicketExportFormat, string> = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export async function renderExportFile<Row>(options: {
  baseName: string;
  format: TicketExportFormat;
  timeZone: string | undefined;
  now: Date;
  columns: ReadonlyArray<ExportColumn<Row>>;
  rows: readonly Row[];
}): Promise<ExportFile> {
  const ctx: ExportContext = { now: options.now, formatDate: makeDateFormatter(options.timeZone) };
  const cells: Array<Array<string | number>> = [
    options.columns.map((column) => column.header),
    ...options.rows.map((row) => options.columns.map((column) => column.value(row, ctx))),
  ];

  const stamp = ctx.formatDate(options.now).replace(/[-:]/g, "").replace(" ", "-");
  const filename = `${options.baseName}-${stamp}.${options.format}`;
  if (options.format === "csv") {
    return { filename, contentType: CONTENT_TYPES.csv, body: toCsv(cells) };
  }
  return { filename, contentType: CONTENT_TYPES.xlsx, body: await toXlsx(cells) };
}
