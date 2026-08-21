import {
  policyNumbersError,
  splitPolicyNumbers,
  TICKET_FIELD_DESCRIPTORS,
  TICKET_IMPORT_HEADERS,
  TICKET_IMPORT_ROW_LIMIT,
  type TicketCatalogKind,
  type TicketCreateData,
  type TicketFieldDescriptor,
  type TicketImportRowError,
  TicketStatus,
} from "@insuredesk/shared";
import ExcelJS from "exceljs";
import type { AuthenticatedUser } from "./auth.service.ts";
import {
  buildCatalogNameIndex,
  type CatalogNameIndex,
  resolveCatalogNameRef,
} from "./dictionary-catalog.service.ts";
import { computeSlaStamp, type TicketServiceDeps, toDateOrNull } from "./ticket.service.ts";
import { resolveTimeZone } from "./time-zone.ts";

/**
 * 批量导入 upload: workbook → per-row 手工建单 payloads → one all-or-nothing
 * transaction. Any error anywhere (file shape, any row) rejects the WHOLE
 * batch with a per-row error list — partial imports never happen, so the user
 * fixes the original file and re-uploads instead of diffing what landed.
 */

export class TicketImportValidationError extends Error {
  readonly rowErrors: TicketImportRowError[];

  constructor(rowErrors: TicketImportRowError[]) {
    super(`导入校验未通过，共 ${rowErrors.length} 个错误`);
    this.name = "TicketImportValidationError";
    this.rowErrors = rowErrors;
  }
}

function fileError(message: string): TicketImportValidationError {
  return new TicketImportValidationError([{ row: null, column: null, message }]);
}

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
    // Hyperlink cells can carry rich text; exceljs then returns the richText
    // model object from cell.text instead of a string.
    const text = cell.text;
    if (typeof text === "string") {
      return text.trim();
    }
    const richText = (value as { text?: { richText?: { text: string }[] } }).text?.richText;
    if (richText) {
      return richText
        .map((run) => run.text)
        .join("")
        .trim();
    }
    return String(text ?? "").trim();
  }
  return String(value).trim();
}

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

/** Catalog name indexes (the file carries names, not ids); the module owns the missing/disabled 判定. */
export interface TicketImportCatalogs {
  channels: CatalogNameIndex;
  categories: CatalogNameIndex;
  completionStatuses: CatalogNameIndex;
  slaPolicies: CatalogNameIndex;
  userComplaintChannels: CatalogNameIndex;
  complaintReceiveChannels: CatalogNameIndex;
}

/**
 * Row payload = the 手工建单 fields plus the 完结迁移 pair; the pair is
 * both-or-neither (validated cross-field), non-null ⇒ the row lands already
 * completed.
 */
export type TicketImportRowData = TicketCreateData & {
  completionStatusId: string | null;
  completionRemark: string | null;
};

type WallClock = { year: number; month: number; day: number; hour: number; minute: number };

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
const WALL_CLOCK_PATTERN = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/;

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
  const match = WALL_CLOCK_PATTERN.exec(raw);
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

type ParseOutcome = { ok: TicketImportRowData[keyof TicketImportRowData] } | { fail: string };

interface ImportColumnSpec {
  header: string;
  field: keyof TicketImportRowData;
  parse: (
    raw: ImportCellValue,
    ctx: { catalogs: TicketImportCatalogs; timeZone: string },
  ) => ParseOutcome;
}

const notText = (raw: Date): ParseOutcome => ({
  fail: `应为文本，实际是日期单元格（${raw.toISOString()}）`,
});

function textColumn(
  descriptor: Extract<TicketFieldDescriptor, { type: "text" }>,
): ImportColumnSpec {
  const limit = descriptor.maxLength;
  return {
    header: descriptor.label,
    field: descriptor.key,
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

function textListColumn(
  descriptor: Extract<TicketFieldDescriptor, { type: "textList" }>,
): ImportColumnSpec {
  return {
    header: descriptor.label,
    field: descriptor.key,
    parse: (raw) => {
      if (raw instanceof Date) {
        return notText(raw);
      }
      // 空白单元格 split 后即空数组（未填写），与其他列的「留空」同义
      const values = splitPolicyNumbers(raw);
      const error = policyNumbersError(values);
      if (error) {
        return { fail: error };
      }
      return { ok: values };
    },
  };
}

function enumColumn(
  descriptor: Extract<TicketFieldDescriptor, { type: "enum" }>,
): ImportColumnSpec {
  const labels = descriptor.options.map((option) => option.label);
  return {
    header: descriptor.label,
    field: descriptor.key,
    parse: (raw) => {
      if (raw instanceof Date) {
        return notText(raw);
      }
      if (raw === "") {
        return { ok: null };
      }
      const option = descriptor.options.find((candidate) => candidate.label === raw);
      if (!option) {
        return { fail: `无效取值「${raw}」，可选：${labels.join(" / ")}` };
      }
      return { ok: option.value };
    },
  };
}

const CATALOG_INDEXES: Record<
  TicketCatalogKind,
  (catalogs: TicketImportCatalogs) => CatalogNameIndex
> = {
  channel: (catalogs) => catalogs.channels,
  category: (catalogs) => catalogs.categories,
  completionStatus: (catalogs) => catalogs.completionStatuses,
  slaPolicy: (catalogs) => catalogs.slaPolicies,
  userComplaintChannel: (catalogs) => catalogs.userComplaintChannels,
  complaintReceiveChannel: (catalogs) => catalogs.complaintReceiveChannels,
};

function catalogColumn(
  descriptor: Extract<TicketFieldDescriptor, { type: "catalog" }>,
): ImportColumnSpec {
  const pick = CATALOG_INDEXES[descriptor.catalog];
  return {
    header: descriptor.label,
    field: descriptor.key,
    parse: (raw, { catalogs }) => {
      if (raw instanceof Date) {
        return notText(raw);
      }
      if (raw === "") {
        return { ok: null };
      }
      const ref = resolveCatalogNameRef(pick(catalogs), raw);
      if (ref.status === "missing") {
        return { fail: `「${raw}」不存在，请重新下载模板并从下拉中选择` };
      }
      if (ref.status === "disabled") {
        return { fail: `「${raw}」已停用` };
      }
      return { ok: ref.id };
    },
  };
}

function wallClockColumn(
  descriptor: Extract<TicketFieldDescriptor, { type: "date" }>,
): ImportColumnSpec {
  return {
    header: descriptor.label,
    field: descriptor.key,
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
  };
}

/**
 * Template order. Semantics = 手工建单契约: every column may be blank (null,
 * never "" or a default), catalog names must be 存在且启用, enum columns take
 * the template's Chinese literals. The trailing 完结 pair additionally binds
 * cross-field: both filled or both blank (checked on the raw cells in
 * validateTicketImportRows).
 */
function toColumnSpec(descriptor: TicketFieldDescriptor): ImportColumnSpec {
  switch (descriptor.type) {
    case "text":
      return textColumn(descriptor);
    case "textList":
      return textListColumn(descriptor);
    case "date":
      return wallClockColumn(descriptor);
    case "enum":
      return enumColumn(descriptor);
    case "catalog":
      return catalogColumn(descriptor);
  }
}

const IMPORT_COLUMNS: readonly ImportColumnSpec[] = TICKET_FIELD_DESCRIPTORS.map(toColumnSpec);

const COMPLETION_STATUS_INDEX = IMPORT_COLUMNS.findIndex(
  (column) => column.field === "completionStatusId",
);
const COMPLETION_REMARK_INDEX = IMPORT_COLUMNS.findIndex(
  (column) => column.field === "completionRemark",
);

/**
 * In-file duplicate key: all cells, joined with a separator no cell text
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
      const asWall = WALL_CLOCK_PATTERN.exec(cell) ? toWallClock(cell) : null;
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
): { tickets: TicketImportRowData[]; errors: TicketImportRowError[] } {
  const ctx = { catalogs, timeZone: resolveTimeZone(timeZone) };
  const errors: TicketImportRowError[] = [];
  const tickets: TicketImportRowData[] = [];
  const seenContent = new Map<string, number>();

  for (const row of rows) {
    const ticket = {} as Record<
      keyof TicketImportRowData,
      TicketImportRowData[keyof TicketImportRowData]
    >;
    ticket.noPolicyNumber = false;
    for (const [index, column] of IMPORT_COLUMNS.entries()) {
      const outcome = column.parse(row.cells[index] ?? "", ctx);
      if ("fail" in outcome) {
        errors.push({ row: row.rowNumber, column: column.header, message: outcome.fail });
        ticket[column.field] = null;
      } else {
        ticket[column.field] = outcome.ok;
      }
    }

    // 同填同空 is checked on the RAW cells: an invalid 完结状态 name still
    // counts as "filled", so it gets its catalog error alone, not a bogus
    // half-filled error on top.
    const rawFilled = (index: number) => (row.cells[index] ?? "") !== "";
    if (rawFilled(COMPLETION_STATUS_INDEX) !== rawFilled(COMPLETION_REMARK_INDEX)) {
      errors.push({
        row: row.rowNumber,
        column: null,
        message: "「完结状态」与「完结备注」须同时填写或同时留空（该行只填写了其中一列）",
      });
    }

    const key = rowContentKey(row.cells);
    const firstRow = seenContent.get(key);
    if (firstRow === undefined) {
      seenContent.set(key, row.rowNumber);
    } else {
      errors.push({
        row: row.rowNumber,
        column: null,
        message: `与第 ${firstRow} 行完全重复（${IMPORT_COLUMNS.length} 个字段全部相同）`,
      });
    }

    tickets.push(ticket as TicketImportRowData);
  }

  return { tickets, errors };
}

export interface TicketImportInput {
  body: Buffer;
  filename: string;
  /** IANA zone the file's wall-clock dates are written in (symmetric with export). */
  timeZone?: string;
}

/**
 * Parse, validate, and create the whole batch in ONE transaction — or throw
 * TicketImportValidationError with the full 行号/列名/原因 list and write
 * nothing. Construction mirrors createTicket, deliberately:
 *
 * - createdAt = the import instant; SLA snapshot (dueAt/跟进/首响) counts from
 *   it per row's 时效策略引用; 未指定 rows stamp all-null
 * - source=file_import with creatorId = the importer, so the non-view_all
 *   data scope and "由谁创建" behave exactly like manual tickets
 * - the importer role's requiredTicketFields do NOT apply — the file contract
 *   is "全字段可空", independent of who uploads
 * - every ticket gets its `create` ProcessLog (remark 导入创建) and a
 *   reference to the batch row recording 导入人/时刻/行数/文件名
 * - rows with the 完结 pair land directly in the 终态: status=completed,
 *   completionTime=the import instant, no assignee, SLA stamped as usual, plus
 *   a `resolve` ProcessLog (remark = the file's 完结备注, operator = the
 *   importer, same instant). No status_change log — the row never transitioned;
 *   and no ticket.process required — migrating history is still just
 *   ticket.import. Same-instant logs keep the batch 整批可撤销.
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
      const [
        channels,
        categories,
        completionStatuses,
        slaPolicies,
        userComplaintChannels,
        complaintReceiveChannels,
      ] = await Promise.all([
        tx.channel.findMany(),
        tx.ticketCategory.findMany(),
        tx.completionStatus.findMany(),
        tx.slaPolicy.findMany(),
        tx.userComplaintChannel.findMany(),
        tx.complaintReceiveChannel.findMany(),
      ]);
      const { tickets, errors } = validateTicketImportRows(
        rows,
        {
          channels: buildCatalogNameIndex(channels),
          categories: buildCatalogNameIndex(categories),
          completionStatuses: buildCatalogNameIndex(completionStatuses),
          slaPolicies: buildCatalogNameIndex(slaPolicies),
          userComplaintChannels: buildCatalogNameIndex(userComplaintChannels),
          complaintReceiveChannels: buildCatalogNameIndex(complaintReceiveChannels),
        },
        input.timeZone,
      );
      if (errors.length > 0) {
        throw new TicketImportValidationError(errors);
      }

      // One SLA snapshot per distinct 策略引用, all counted from the same instant
      const slaStamps = new Map<string | null, Awaited<ReturnType<typeof computeSlaStamp>>>();
      for (const ticket of tickets) {
        if (!slaStamps.has(ticket.slaPolicyId)) {
          slaStamps.set(ticket.slaPolicyId, await computeSlaStamp(tx, ticket.slaPolicyId, now));
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
        data: tickets.map(({ completionStatusId, completionRemark: _, ...ticket }) => ({
          ...ticket,
          feedbackTime: toDateOrNull(ticket.feedbackTime),
          contactTime: toDateOrNull(ticket.contactTime),
          createdAt: now,
          source: "file_import",
          creatorId: importer.id,
          importBatchId: batch.id,
          ...(completionStatusId === null
            ? { status: TicketStatus.Unassigned }
            : { status: TicketStatus.Completed, completionTime: now, completionStatusId }),
          ...slaStamps.get(ticket.slaPolicyId),
        })),
        select: { id: true },
      });

      const operator = { operatorId: importer.id, operatorName: importer.name, at: now };
      await tx.processLog.createMany({
        data: created.map(({ id }) => ({
          ticketId: id,
          ...operator,
          action: "create",
          remark: "导入创建",
        })),
      });

      // Postgres returns INSERT … RETURNING rows in insertion order, so
      // created[i] is tickets[i] — the per-row 完结备注 rides on that pairing.
      // Written after the create logs so the timeline reads 创建 → 完结.
      const resolveLogs = created.flatMap(({ id }, index) => {
        const remark = tickets[index]?.completionRemark;
        return remark == null ? [] : [{ ticketId: id, ...operator, action: "resolve", remark }];
      });
      if (resolveLogs.length > 0) {
        await tx.processLog.createMany({ data: resolveLogs });
      }

      return { imported: created.length };
    },
    // 2000 rows in one transaction comfortably exceeds the 5s default
    { timeout: 30_000 },
  );
}
