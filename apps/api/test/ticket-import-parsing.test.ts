import { TICKET_IMPORT_HEADERS as HEADERS, TICKET_IMPORT_ROW_LIMIT } from "@insuredesk/shared";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  readTicketImportSheet,
  TicketImportValidationError,
  validateTicketImportRows,
} from "../src/services/ticket-import.service.ts";

type RowInput = Partial<Record<string, string | Date>>;

/** First element, asserted present — noUncheckedIndexedAccess-friendly. */
function first<T>(items: readonly T[]): T {
  const item = items[0];
  if (item === undefined) {
    throw new Error("expected at least one element");
  }
  return item;
}

async function buildWorkbook(
  rows: Array<RowInput | null>,
  headers: readonly string[] = HEADERS,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("工单");
  sheet.addRow(headers);
  for (const row of rows) {
    if (row === null) {
      sheet.addRow([]);
      continue;
    }
    sheet.addRow(HEADERS.map((header) => row[header] ?? ""));
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

const catalogs = {
  channels: new Map([
    ["飞书", { id: "ch-feishu", active: true }],
    ["老渠道", { id: "ch-legacy", active: false }],
  ]),
  categories: new Map([
    ["理赔", { id: "cat-claims", active: true }],
    ["旧类别", { id: "cat-old", active: false }],
  ]),
  completionStatuses: new Map([
    ["已解决", { id: "cs-resolved", active: true }],
    ["旧口径", { id: "cs-legacy", active: false }],
  ]),
  slaPolicies: new Map([
    ["一般投诉", { id: "sla-normal", active: true }],
    ["高级投诉", { id: "sla-high", active: true }],
    ["加急投诉", { id: "sla-rush", active: true }],
    ["特急投诉", { id: "sla-urgent", active: true }],
    ["旧策略", { id: "sla-legacy", active: false }],
  ]),
  userFeedbackChannels: new Map([
    ["保司400热线", { id: "ufc-hotline", active: true }],
    ["旧投诉渠道", { id: "ufc-legacy", active: false }],
  ]),
  feedbackReceiveChannels: new Map([
    ["内部客服热线", { id: "frc-hotline", active: true }],
    ["旧接收渠道", { id: "frc-legacy", active: false }],
  ]),
};

async function expectFileError(body: Buffer, messagePart: string) {
  try {
    await readTicketImportSheet(body);
    expect.unreachable("should have thrown");
  } catch (error) {
    expect(error).toBeInstanceOf(TicketImportValidationError);
    const rowErrors = (error as TicketImportValidationError).rowErrors;
    expect(rowErrors).toHaveLength(1);
    expect(rowErrors[0]?.row).toBeNull();
    expect(rowErrors[0]?.message).toContain(messagePart);
  }
}

describe("readTicketImportSheet", () => {
  it("导入列头与模板生成列头是同一契约", async () => {
    const { TICKET_IMPORT_TEMPLATE_COLUMNS } = await import(
      "../src/services/ticket-import-template.service.ts"
    );
    expect(TICKET_IMPORT_TEMPLATE_COLUMNS.map((column) => column.header)).toEqual(HEADERS);
  });

  it("returns data rows with their Excel row numbers, skipping blank rows", async () => {
    const body = await buildWorkbook([
      { 客户姓名: "张三" },
      null,
      { 客户姓名: "  " },
      { 客户姓名: "李四" },
    ]);
    const rows = await readTicketImportSheet(body);
    expect(rows.map((row) => row.rowNumber)).toEqual([2, 5]);
    expect(first(rows).cells).toHaveLength(HEADERS.length);
  });

  it("rejects a workbook whose headers deviate from the template", async () => {
    const renamed = [...HEADERS];
    renamed[2] = "项目";
    await expectFileError(await buildWorkbook([{ 客户姓名: "x" }], renamed), "表头与模板不符");

    const extra = [...HEADERS, "多余列"];
    await expectFileError(await buildWorkbook([{ 客户姓名: "x" }], extra), "表头与模板不符");
  });

  it("rejects zero data rows, over-limit rows, and unparseable files", async () => {
    await expectFileError(await buildWorkbook([]), "没有可导入的数据行");
    await expectFileError(await buildWorkbook([null, null]), "没有可导入的数据行");

    const tooMany = Array.from({ length: TICKET_IMPORT_ROW_LIMIT + 1 }, (_, i) => ({
      客户姓名: `客户${i}`,
    }));
    await expectFileError(await buildWorkbook(tooMany), `${TICKET_IMPORT_ROW_LIMIT}`);

    await expectFileError(Buffer.from("not an xlsx"), "无法解析");
  });
});

describe("validateTicketImportRows", () => {
  async function validate(rows: Array<RowInput | null>, timeZone?: string) {
    const parsed = await readTicketImportSheet(await buildWorkbook(rows));
    return validateTicketImportRows(parsed, catalogs, timeZone);
  }

  it("maps a full row to the manual-creation payload (labels → stored values)", async () => {
    const { tickets, errors } = await validate(
      [
        {
          反馈时间: "2026-07-01 10:00",
          反馈渠道: "飞书",
          "项目（保司）": " 融盛 ",
          用户反馈渠道: "保司400热线",
          反馈信息接收渠道: "内部客服热线",
          客户姓名: "张三",
          保司侧是否核身: "待核实",
          客户曾进线: "是",
          进线时间: "2026-06-30 21:15",
          客诉类别: "理赔",
          时效策略: "高级投诉",
          优先级: "紧急",
        },
      ],
      "Asia/Shanghai",
    );
    expect(errors).toEqual([]);
    expect(tickets).toHaveLength(1);
    const ticket = first(tickets);
    expect(ticket.feedbackTime).toBe("2026-07-01T02:00:00.000Z");
    expect(ticket.channelId).toBe("ch-feishu");
    expect(ticket.project).toBe("融盛");
    expect(ticket.userFeedbackChannelId).toBe("ufc-hotline");
    expect(ticket.feedbackReceiveChannelId).toBe("frc-hotline");
    expect(ticket.customerName).toBe("张三");
    expect(ticket.nuclearBodyStatus).toBe("待核实");
    expect(ticket.hasContacted).toBe(true);
    expect(ticket.contactTime).toBe("2026-06-30T13:15:00.000Z");
    expect(ticket.categoryId).toBe("cat-claims");
    expect(ticket.slaPolicyId).toBe("sla-high");
    expect(ticket.priority).toBe("urgent");
  });

  it("keeps every unfilled field NULL — a single-cell row is valid", async () => {
    const { tickets, errors } = await validate([{ 客户曾进线: "否" }]);
    expect(errors).toEqual([]);
    const ticket = first(tickets);
    expect(ticket.hasContacted).toBe(false);
    expect(ticket.feedbackTime).toBeNull();
    expect(ticket.channelId).toBeNull();
    expect(ticket.categoryId).toBeNull();
    expect(ticket.slaPolicyId).toBeNull();
    expect(ticket.priority).toBeNull();
    expect(ticket.customerName).toBeNull();
    expect(ticket.feedbackReceiveChannelId).toBeNull();
    expect(ticket.contactTime).toBeNull();
    expect(ticket.completionStatusId).toBeNull();
    expect(ticket.completionRemark).toBeNull();
  });

  it("进线时间 follows the 反馈时间 date contract; 投诉渠道列只收启用目录名", async () => {
    const { errors } = await validate([
      { 进线时间: "2026/07/01 10:00" },
      { 进线时间: "2026-02-30 10:00" },
      { 反馈信息接收渠道: "查无此群" },
      { 用户反馈渠道: "旧投诉渠道" },
    ]);
    expect(errors).toHaveLength(4);
    expect(errors[0]).toMatchObject({ row: 2, column: "进线时间" });
    expect(errors[0]?.message).toContain("yyyy-MM-dd HH:mm");
    expect(errors[1]).toMatchObject({ row: 3, column: "进线时间" });
    expect(errors[2]).toMatchObject({ row: 4, column: "反馈信息接收渠道" });
    expect(errors[2]?.message).toContain("「查无此群」不存在");
    expect(errors[3]).toMatchObject({ row: 5, column: "用户反馈渠道" });
    expect(errors[3]?.message).toContain("「旧投诉渠道」已停用");
  });

  it("maps a filled 完结状态/完结备注 pair to the completion payload", async () => {
    const { tickets, errors } = await validate([
      { 客户姓名: "张三", 完结状态: "已解决", 完结备注: " 历史迁移，电话回访已确认 " },
    ]);
    expect(errors).toEqual([]);
    const ticket = first(tickets);
    expect(ticket.completionStatusId).toBe("cs-resolved");
    expect(ticket.completionRemark).toBe("历史迁移，电话回访已确认");
  });

  it("rejects a half-filled 完结状态/完结备注 pair as a row error", async () => {
    const { errors } = await validate([
      { 客户姓名: "只填状态", 完结状态: "已解决" },
      { 客户姓名: "只填备注", 完结备注: "备注" },
    ]);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatchObject({ row: 2, column: null });
    expect(errors[0]?.message).toContain("同时填写或同时留空");
    expect(errors[1]).toMatchObject({ row: 3, column: null });
  });

  it("distinguishes unknown from disabled 完结状态 names, same as channel/category", async () => {
    const { errors } = await validate([
      { 完结状态: "不存在的状态", 完结备注: "x" },
      { 完结状态: "旧口径", 完结备注: "x" },
    ]);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatchObject({ row: 2, column: "完结状态" });
    expect(errors[0]?.message).toContain("不存在");
    expect(errors[1]).toMatchObject({ row: 3, column: "完结状态" });
    expect(errors[1]?.message).toContain("已停用");
  });

  it("rejects a 完结备注 over 2000 chars", async () => {
    const { errors } = await validate([{ 完结状态: "已解决", 完结备注: "字".repeat(2001) }]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ row: 2, column: "完结备注" });
    expect(errors[0]?.message).toContain("2000");
  });

  it("interprets wall-clock feedbackTime in the request zone, falling back to UTC", async () => {
    const winter = { 反馈时间: "2026-01-15 12:00", 客户姓名: "x" };
    const summer = { 反馈时间: "2026-07-15 12:00", 客户姓名: "x" };

    const newYork = await validate([winter, summer], "America/New_York");
    expect(newYork.tickets[0]?.feedbackTime).toBe("2026-01-15T17:00:00.000Z");
    expect(newYork.tickets[1]?.feedbackTime).toBe("2026-07-15T16:00:00.000Z");

    const fallback = await validate([winter], "Not/AZone");
    expect(fallback.tickets[0]?.feedbackTime).toBe("2026-01-15T12:00:00.000Z");
  });

  it("accepts Excel native date cells as the wall clock in the request zone", async () => {
    const { tickets, errors } = await validate(
      [{ 反馈时间: new Date(Date.UTC(2026, 6, 1, 10, 0)), 客户姓名: "x" }],
      "Asia/Shanghai",
    );
    expect(errors).toEqual([]);
    expect(tickets[0]?.feedbackTime).toBe("2026-07-01T02:00:00.000Z");
  });

  it("rejects malformed, lenient-variant, or impossible dates with the column name", async () => {
    const { errors } = await validate([
      { 反馈时间: "2026/07/01 10:00" },
      { 反馈时间: "2026-02-30 10:00" },
      { 反馈时间: "2026-07-01 25:00" },
      { 反馈时间: "2026-7-1 10:00" }, // 单位数月日不在模板契约内
      { 反馈时间: "2026-07-01T10:00" },
      { 反馈时间: "2026-07-01 10:00:30" }, // 带秒会被静默截断，宁拒不收
    ]);
    expect(errors).toHaveLength(6);
    for (const [index, error] of errors.entries()) {
      expect(error.row).toBe(index + 2);
      expect(error.column).toBe("反馈时间");
      expect(error.message).toContain("yyyy-MM-dd HH:mm");
    }
  });

  it("distinguishes unknown from disabled catalog names", async () => {
    const { errors } = await validate([
      { 反馈渠道: "不存在的渠道" },
      { 反馈渠道: "老渠道" },
      { 客诉类别: "不存在的类别" },
      { 客诉类别: "旧类别" },
    ]);
    expect(errors).toHaveLength(4);
    expect(errors[0]).toMatchObject({ row: 2, column: "反馈渠道" });
    expect(errors[0]?.message).toContain("不存在");
    expect(errors[1]?.message).toContain("已停用");
    expect(errors[2]).toMatchObject({ row: 4, column: "客诉类别" });
    expect(errors[2]?.message).toContain("不存在");
    expect(errors[3]?.message).toContain("已停用");
  });

  it("时效策略列：撞停用名或查无此名都是报错行（与目录列同款三分支）", async () => {
    const { errors } = await validate([
      { 时效策略: "不存在的策略" },
      { 时效策略: "旧策略" },
      { 时效策略: "加急投诉" },
    ]);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatchObject({ row: 2, column: "时效策略" });
    expect(errors[0]?.message).toContain("不存在");
    expect(errors[1]).toMatchObject({ row: 3, column: "时效策略" });
    expect(errors[1]?.message).toContain("已停用");
  });

  it("rejects bad enum literals and over-length text, accumulating across rows", async () => {
    const { errors } = await validate([
      { 时效策略: "特级投诉" },
      { 优先级: "特急" },
      { 保司侧是否核身: "未知" },
      { 客户曾进线: "也许" },
      { 客户姓名: "名".repeat(101) },
      { "客户电话（投保人）": "1".repeat(51) },
    ]);
    expect(errors).toHaveLength(6);
    expect(errors.map((error) => error.column)).toEqual([
      "时效策略",
      "优先级",
      "保司侧是否核身",
      "客户曾进线",
      "客户姓名",
      "客户电话（投保人）",
    ]);
    expect(errors[4]?.message).toContain("100");
    expect(errors[5]?.message).toContain("50");
  });

  it("splits a 保单号 cell on non-alphanumeric separators, deduping into the array", async () => {
    const { tickets, errors } = await validate([{ 保单号: "  PA1   PB2，PC3、PA1 " }]);
    expect(errors).toEqual([]);
    expect(first(tickets).policyNumbers).toEqual(["PA1", "PB2", "PC3"]);
  });

  it("names the specific over-length 保单号 among the cell's other valid values", async () => {
    const offending = `BAD${"0".repeat(100)}`;
    const { errors } = await validate([{ 保单号: `Pgood ${offending} Palsogood` }]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ row: 2, column: "保单号" });
    expect(errors[0]?.message).toContain("超出最大长度");
    expect(errors[0]?.message).toContain(offending);
  });

  it("flags fully identical rows as duplicates of the first occurrence", async () => {
    const row: RowInput = { 客户姓名: "张三", 时效策略: "一般投诉" };
    const { errors } = await validate([row, { 客户姓名: "张三" }, { ...row }, { ...row }]);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatchObject({ row: 4, column: null });
    expect(errors[0]?.message).toContain("第 2 行");
    expect(errors[0]?.message).toContain(`${HEADERS.length} 个字段`);
    expect(errors[1]).toMatchObject({ row: 5, column: null });
  });

  it("counts the 完结 columns into the duplicate key — rows differing only there pass", async () => {
    const { errors } = await validate([
      { 客户姓名: "张三", 完结状态: "已解决", 完结备注: "第一单" },
      { 客户姓名: "张三", 完结状态: "已解决", 完结备注: "第二单" },
    ]);
    expect(errors).toEqual([]);
  });

  it("treats a text date and its native-cell equivalent as the same row content", async () => {
    const { errors } = await validate(
      [
        { 反馈时间: "2026-07-01 10:00", 客户姓名: "张三" },
        { 反馈时间: new Date(Date.UTC(2026, 6, 1, 10, 0)), 客户姓名: "张三" },
      ],
      "Asia/Shanghai",
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain("完全重复");
  });
});
