import {
  COMPLAINT_LEVELS,
  NUCLEAR_BODY_STATUSES,
  PRIORITIES,
  PRIORITY_LABELS,
  TICKET_IMPORT_ROW_LIMIT,
  TICKET_TEXT_LIMITS,
  type TicketCreateData,
  type TicketImportRowError,
  TicketStatus,
} from "@insuredesk/shared";
import ExcelJS from "exceljs";
import type { AuthenticatedUser } from "./auth.service";
import { computeSlaStamp, type TicketServiceDeps } from "./ticket.service";
import { TICKET_IMPORT_TEMPLATE_HEADERS } from "./ticket-import-template.service";
import { resolveTimeZone } from "./time-zone";

/**
 * 批量导入 upload: workbook → per-row 手工建单 payloads → one all-or-nothing
 * transaction. Any error anywhere (file shape, any row) rejects the WHOLE
 * batch with a per-row error list — partial imports never happen, so the user
 * fixes the original file and re-uploads instead of diffing what landed.
 */

/** Carrier for the 行号/列名/原因 list; the route serializes it as the 400 body. */
export class TicketImportValidationError extends Error {
  constructor(readonly rowErrors: TicketImportRowError[]) {
    super(`导入校验未通过，共 ${rowErrors.length} 个错误`);
    this.name = "TicketImportValidationError";
  }
}

function fileError(message: string): TicketImportValidationError {
  return new TicketImportValidationError([{ row: null, column: null, message }]);
}

/** A cell is either its trimmed text or a native Excel date. */
type ImportCellValue = string | Date;

export interface TicketImportSheetRow {
  /** Excel row number (header is row 1) — the 行号 users see in errors. */
  rowNumber: number;
  cells: ImportCellValue[];
}

/**
 * Normalize an exceljs cell: native dates stay Date (their UTC fields ARE the
 * wall clock exceljs decoded from the serial), everything else becomes
 * trimmed display text.
 */
function cellToRaw(cell: ExcelJS.Cell): ImportCellValue {
  const value = cell.value;
  if (value === null || value === undefined) {
    return "";
  }
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === "object") {
    return cell.text.trim();
  }
  return String(value).trim();
}

/**
 * Load the 工单 sheet and gate the file shape: template headers verbatim,
 * blank rows skipped, ≥1 and ≤TICKET_IMPORT_ROW_LIMIT data rows.
 */
export async function readTicketImportSheet(body: Buffer): Promise<TicketImportSheetRow[]> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(body as unknown as ArrayBuffer);
  } catch {
    throw fileError("无法解析文件，请上传按模板填写的 .xlsx 文件");
  }
  const sheet = workbook.getWorksheet("工单");
  if (!sheet) {
    throw fileError("未找到「工单」工作表，请重新下载模板并按其填写");
  }

  const headerRow = sheet.getRow(1);
  const headerCount = Math.max(TICKET_IMPORT_HEADERS.length, headerRow.cellCount);
  for (let column = 1; column <= headerCount; column += 1) {
    const expected = TICKET_IMPORT_HEADERS[column - 1] ?? "";
    const actual = cellToRaw(headerRow.getCell(column));
    if (actual !== expected) {
      throw fileError(
        `表头与模板不符（第 ${column} 列应为「${expected}」）：请重新下载模板并按其填写`,
      );
    }
  }

  const rows: TicketImportSheetRow[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      return;
    }
    const cells = TICKET_IMPORT_HEADERS.map((_, index) => cellToRaw(row.getCell(index + 1)));
    if (cells.every((cell) => cell === "")) {
      return;
    }
    rows.push({ rowNumber, cells });
  });

  if (rows.length === 0) {
    throw fileError("文件中没有可导入的数据行");
  }
  if (rows.length > TICKET_IMPORT_ROW_LIMIT) {
    throw fileError(
      `数据行数超过上限 ${TICKET_IMPORT_ROW_LIMIT} 行（实际 ${rows.length} 行），请分批导入`,
    );
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Per-row validation — same semantics as the manual creation contract
// ---------------------------------------------------------------------------

/** Catalog rows by NAME (the file carries names, not ids), 停用 included so 不存在/已停用 stay distinguishable. */
export interface TicketImportCatalogs {
  channels: Map<string, { id: string; active: boolean }>;
  categories: Map<string, { id: string; active: boolean }>;
}

type WallClock = { year: number; month: number; day: number; hour: number; minute: number };

/** The zone's UTC offset (ms) at the given timestamp, via Intl — no tz library. */
function zoneOffsetMs(timestamp: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(timestamp));
  const field = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  // hourCycle quirk: midnight can format as "24"
  const hour = field("hour") % 24;
  const asUtc = Date.UTC(
    field("year"),
    field("month") - 1,
    field("day"),
    hour,
    field("minute"),
    field("second"),
  );
  return asUtc - timestamp;
}

/**
 * Wall clock in an IANA zone → absolute instant. Two offset probes converge
 * across DST boundaries (a nonexistent wall time resolves to the shifted
 * instant rather than failing).
 */
export function wallClockToInstant(wall: WallClock, timeZone: string): Date {
  const utcGuess = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  const first = utcGuess - zoneOffsetMs(utcGuess, timeZone);
  const second = utcGuess - zoneOffsetMs(first, timeZone);
  return new Date(second);
}

// 与模板填写说明一字不差的格式契约；宽松变体（单位数月份、T 分隔、带秒）
// 一律拒绝，避免静默丢弃秒数等歧义。
const FEEDBACK_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/;

/** "yyyy-MM-dd HH:mm" (or a native date cell's UTC fields) → wall clock; null = unparseable. */
function toWallClock(raw: ImportCellValue): WallClock | null {
  if (raw instanceof Date) {
    return {
      year: raw.getUTCFullYear(),
      month: raw.getUTCMonth() + 1,
      day: raw.getUTCDate(),
      hour: raw.getUTCHours(),
      minute: raw.getUTCMinutes(),
    };
  }
  const match = FEEDBACK_TIME_PATTERN.exec(raw);
  if (!match) {
    return null;
  }
  // The regex guarantees the 5 capture groups
  const [year, month, day, hour, minute] = match.slice(1, 6).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  // Round-trip through Date.UTC rejects impossible values (2月30日, 25:00)
  const probe = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const valid =
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day &&
    probe.getUTCHours() === hour &&
    probe.getUTCMinutes() === minute;
  return valid ? { year, month, day, hour, minute } : null;
}

type ParseOutcome = { ok: TicketCreateData[keyof TicketCreateData] } | { fail: string };

interface ImportColumnSpec {
  header: string;
  field: keyof TicketCreateData;
  parse: (
    raw: ImportCellValue,
    ctx: { catalogs: TicketImportCatalogs; timeZone: string },
  ) => ParseOutcome;
}

const notText = (raw: Date): ParseOutcome => ({
  fail: `应为文本，实际是日期单元格（${raw.toISOString()}）`,
});

function textColumn(header: string, field: keyof typeof TICKET_TEXT_LIMITS): ImportColumnSpec {
  const limit = TICKET_TEXT_LIMITS[field];
  return {
    header,
    field,
    parse: (raw) => {
      if (raw instanceof Date) {
        return notText(raw);
      }
      if (raw === "") {
        return { ok: null };
      }
      if (raw.length > limit) {
        return { fail: `超出最大长度 ${limit} 字（实际 ${raw.length} 字）` };
      }
      return { ok: raw };
    },
  };
}

function enumColumn(
  header: string,
  field: keyof TicketCreateData,
  options: readonly string[],
  toValue: (label: string) => TicketCreateData[keyof TicketCreateData] = (label) => label,
): ImportColumnSpec {
  return {
    header,
    field,
    parse: (raw) => {
      if (raw instanceof Date) {
        return notText(raw);
      }
      if (raw === "") {
        return { ok: null };
      }
      if (!options.includes(raw)) {
        return { fail: `无效取值「${raw}」，可选：${options.join(" / ")}` };
      }
      return { ok: toValue(raw) };
    },
  };
}

/** Catalog rows keyed by NAME (the file carries names, not ids). */
type CatalogNameMap = Map<string, { id: string; active: boolean }>;

function catalogColumn(
  header: string,
  field: "channelId" | "categoryId",
  pick: (catalogs: TicketImportCatalogs) => CatalogNameMap,
): ImportColumnSpec {
  return {
    header,
    field,
    parse: (raw, { catalogs }) => {
      if (raw instanceof Date) {
        return notText(raw);
      }
      if (raw === "") {
        return { ok: null };
      }
      const entry = pick(catalogs).get(raw);
      if (!entry) {
        return { fail: `「${raw}」不存在，请重新下载模板并从下拉中选择` };
      }
      if (!entry.active) {
        return { fail: `「${raw}」已停用` };
      }
      return { ok: entry.id };
    },
  };
}

const PRIORITY_BY_LABEL = new Map(
  PRIORITIES.map((priority) => [PRIORITY_LABELS[priority], priority]),
);

/**
 * The 18 columns, template order. Semantics = 手工建单契约: every column may
 * be blank (null, never "" or a default), catalog names must be 存在且启用,
 * enum columns take the template's Chinese literals.
 */
const IMPORT_COLUMNS: readonly ImportColumnSpec[] = [
  {
    header: "反馈时间",
    field: "feedbackTime",
    parse: (raw, { timeZone }) => {
      if (raw === "") {
        return { ok: null };
      }
      const wall = toWallClock(raw);
      if (wall === null) {
        return { fail: "格式应为 yyyy-MM-dd HH:mm（如 2026-07-09 14:30）" };
      }
      return { ok: wallClockToInstant(wall, timeZone).toISOString() };
    },
  },
  catalogColumn("反馈渠道", "channelId", (catalogs) => catalogs.channels),
  textColumn("项目（保司）", "project"),
  textColumn("经纪主体", "brokerageEntity"),
  textColumn("支付渠道", "paymentChannel"),
  textColumn("内部订单号", "internalOrderNumber"),
  textColumn("保单号", "policyNumber"),
  textColumn("用户投诉渠道", "userComplaintChannel"),
  textColumn("客户姓名", "customerName"),
  textColumn("客户电话（投保人）", "phone"),
  textColumn("联系人电话", "contactPhone"),
  enumColumn("保司侧是否核身", "nuclearBodyStatus", NUCLEAR_BODY_STATUSES),
  textColumn("客户诉求", "customerRequest"),
  enumColumn("客户曾进线", "hasContacted", ["是", "否"], (label) => label === "是"),
  textColumn("进线ID", "contactId"),
  catalogColumn("客诉类别", "categoryId", (catalogs) => catalogs.categories),
  enumColumn("投诉等级", "complaintLevel", COMPLAINT_LEVELS),
  enumColumn(
    "优先级",
    "priority",
    PRIORITIES.map((priority) => PRIORITY_LABELS[priority]),
    (label) => PRIORITY_BY_LABEL.get(label) ?? null,
  ),
];

/** Column order IS the header contract; drift here is a programming error. */
export const TICKET_IMPORT_HEADERS: readonly string[] = IMPORT_COLUMNS.map(
  (column) => column.header,
);
if (TICKET_IMPORT_HEADERS.join("\u0000") !== TICKET_IMPORT_TEMPLATE_HEADERS.join("\u0000")) {
  throw new Error("ticket import columns out of sync with the template headers");
}

/**
 * In-file duplicate key: all 18 cells, joined with a separator no cell text
 * can contain (cells are trimmed display text). Dates — native cells and
 * template-format text alike — normalize to their wall clock, so the same
 * moment written two ways still counts as the same content.
 */
function rowContentKey(cells: ImportCellValue[]): string {
  return cells
    .map((cell) => {
      if (cell instanceof Date) {
        const wall = toWallClock(cell) as WallClock;
        return `${wall.year}-${wall.month}-${wall.day} ${wall.hour}:${wall.minute}`;
      }
      const asWall = FEEDBACK_TIME_PATTERN.exec(cell) ? toWallClock(cell) : null;
      return asWall
        ? `${asWall.year}-${asWall.month}-${asWall.day} ${asWall.hour}:${asWall.minute}`
        : cell;
    })
    .join("\u0000");
}

/**
 * Validate every row, accumulating ALL errors (the user fixes the file in one
 * pass). Returns creation payloads aligned with `rows`; only meaningful when
 * `errors` is empty.
 */
export function validateTicketImportRows(
  rows: TicketImportSheetRow[],
  catalogs: TicketImportCatalogs,
  timeZone: string | undefined,
): { tickets: TicketCreateData[]; errors: TicketImportRowError[] } {
  const ctx = { catalogs, timeZone: resolveTimeZone(timeZone) };
  const errors: TicketImportRowError[] = [];
  const tickets: TicketCreateData[] = [];
  const seenContent = new Map<string, number>();

  for (const row of rows) {
    const ticket = {} as Record<keyof TicketCreateData, TicketCreateData[keyof TicketCreateData]>;
    for (const [index, column] of IMPORT_COLUMNS.entries()) {
      const outcome = column.parse(row.cells[index] ?? "", ctx);
      if ("fail" in outcome) {
        errors.push({ row: row.rowNumber, column: column.header, message: outcome.fail });
        ticket[column.field] = null;
      } else {
        ticket[column.field] = outcome.ok;
      }
    }

    const key = rowContentKey(row.cells);
    const firstRow = seenContent.get(key);
    if (firstRow === undefined) {
      seenContent.set(key, row.rowNumber);
    } else {
      errors.push({
        row: row.rowNumber,
        column: null,
        message: `与第 ${firstRow} 行完全重复（18 个字段全部相同）`,
      });
    }

    tickets.push(ticket as TicketCreateData);
  }

  return { tickets, errors };
}

// ---------------------------------------------------------------------------
// Transactional creation — same construction as manual creation
// ---------------------------------------------------------------------------

export interface TicketImportInput {
  body: Buffer;
  /** Uploaded filename, kept on the batch for human recognition. */
  filename: string;
  /** IANA zone the file's wall-clock dates are written in (symmetric with export). */
  timeZone?: string;
}

function toNameMap(rows: Array<{ id: string; name: string; active: boolean }>) {
  return new Map(rows.map((row) => [row.name, { id: row.id, active: row.active }]));
}

/**
 * Parse, validate, and create the whole batch in ONE transaction — or throw
 * TicketImportValidationError with the full 行号/列名/原因 list and write
 * nothing. Construction mirrors createTicket, deliberately:
 *
 * - createdAt = the import instant; SLA snapshot (dueAt/跟进/首响) counts from
 *   it per row's level; 未定级 rows stamp all-null
 * - source=file_import with creatorId = the importer, so the non-view_all
 *   data scope and "由谁创建" behave exactly like manual tickets
 * - the importer role's requiredTicketFields do NOT apply — the file contract
 *   is "全字段可空", independent of who uploads
 * - every ticket gets its `create` ProcessLog (remark 导入创建) and a
 *   reference to the batch row recording 导入人/时刻/行数/文件名
 */
export async function importTickets(
  { prisma, clock }: TicketServiceDeps,
  importer: AuthenticatedUser,
  input: TicketImportInput,
): Promise<{ imported: number }> {
  const rows = await readTicketImportSheet(input.body);
  const now = clock.now();

  return prisma.$transaction(
    async (tx) => {
      const [channels, categories] = await Promise.all([
        tx.channel.findMany(),
        tx.ticketCategory.findMany(),
      ]);
      const { tickets, errors } = validateTicketImportRows(
        rows,
        { channels: toNameMap(channels), categories: toNameMap(categories) },
        input.timeZone,
      );
      if (errors.length > 0) {
        throw new TicketImportValidationError(errors);
      }

      // One SLA snapshot per distinct level, all counted from the same instant
      const slaStamps = new Map<string | null, Awaited<ReturnType<typeof computeSlaStamp>>>();
      for (const ticket of tickets) {
        if (!slaStamps.has(ticket.complaintLevel)) {
          slaStamps.set(
            ticket.complaintLevel,
            await computeSlaStamp(tx, ticket.complaintLevel, now),
          );
        }
      }

      const batch = await tx.ticketImportBatch.create({
        data: {
          importerId: importer.id,
          importedAt: now,
          rowCount: tickets.length,
          filename: input.filename,
        },
      });

      const created = await tx.ticket.createManyAndReturn({
        data: tickets.map((ticket) => ({
          ...ticket,
          feedbackTime: ticket.feedbackTime === null ? null : new Date(ticket.feedbackTime),
          createdAt: now,
          source: "file_import",
          creatorId: importer.id,
          importBatchId: batch.id,
          status: TicketStatus.Unassigned,
          ...slaStamps.get(ticket.complaintLevel),
        })),
        select: { id: true },
      });

      await tx.processLog.createMany({
        data: created.map(({ id }) => ({
          ticketId: id,
          operatorId: importer.id,
          operatorName: importer.name,
          action: "create",
          remark: "导入创建",
          at: now,
        })),
      });

      return { imported: created.length };
    },
    // 2000 rows in one transaction comfortably exceeds the 5s default
    { timeout: 30_000 },
  );
}
