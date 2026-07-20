import { describe, expect, it } from "vitest";
import { TICKET_IMPORT_TEMPLATE_COLUMNS } from "../src/services/ticket-import-template.service";

/**
 * 模板列的逐字 golden：表头、填写说明、下拉来源。导入模板是对用户的既成
 * 契约（上传按表头解析、说明是填写依据），任何字面变化都必须在这里显式
 * 改预期才能通过。
 */

const GOLDEN_COLUMNS: ReadonlyArray<{
  header: string;
  note: string;
  /** 静态下拉的取值；目录列写 "catalog"，无下拉列省略。 */
  dropdown?: readonly string[] | "catalog";
}> = [
  { header: "反馈时间", note: "格式 yyyy-MM-dd HH:mm（如 2026-07-09 14:30）；留空=未填写" },
  {
    header: "反馈渠道",
    note: "从下拉选择（下载模板时启用的渠道目录）；留空=未填写",
    dropdown: "catalog",
  },
  { header: "项目（保司）", note: "文本，最长 100 字；如：融盛、泰康" },
  { header: "经纪主体", note: "文本，最长 100 字；如：东方大地" },
  { header: "支付渠道", note: "文本，最长 100 字；如：连连支付" },
  { header: "内部订单号", note: "文本，最长 200 字" },
  { header: "保单号", note: "文本，最长 100 字" },
  { header: "用户投诉渠道", note: "文本，最长 100 字；如：飞书投诉、400热线" },
  { header: "投诉信息接收渠道", note: "文本，最长 100 字；如：监管转办、邮箱接收" },
  { header: "客户姓名", note: "文本，最长 100 字" },
  { header: "客户电话（投保人）", note: "文本，最长 50 字" },
  { header: "联系人电话", note: "文本，最长 200 字" },
  {
    header: "保司侧是否核身",
    note: "从下拉选择：是 / 否 / 待核实；留空=未填写",
    dropdown: ["是", "否", "待核实"],
  },
  { header: "客户诉求", note: "文本，最长 2000 字" },
  { header: "客户曾进线", note: "从下拉选择：是 / 否；留空=未知", dropdown: ["是", "否"] },
  { header: "进线时间", note: "格式 yyyy-MM-dd HH:mm（如 2026-07-09 14:30）；留空=未填写" },
  { header: "进线ID", note: "文本，最长 200 字" },
  {
    header: "客诉类别",
    note: "从下拉选择（下载模板时启用的类别目录）；留空=未填写",
    dropdown: "catalog",
  },
  {
    header: "投诉等级",
    note: "从下拉选择：一般投诉 / 高级投诉 / 加急投诉 / 特急投诉；留空=未定级（无处理时限与 SLA 告警）",
    dropdown: ["一般投诉", "高级投诉", "加急投诉", "特急投诉"],
  },
  {
    header: "优先级",
    note: "从下拉选择：低 / 中 / 高 / 紧急；留空=未设置",
    dropdown: ["低", "中", "高", "紧急"],
  },
  {
    header: "完结状态",
    note: "从下拉选择（下载模板时启用的完结状态目录）；须与「完结备注」同时填写或同时留空",
    dropdown: "catalog",
  },
  { header: "完结备注", note: "文本，最长 2000 字；须与「完结状态」同时填写或同时留空" },
];

/** 每个目录列一个可识别的独立取值集，验证接的是自己那份目录。 */
const catalogFixture = {
  channels: ["渠道甲"],
  categories: ["类别乙"],
  completionStatuses: ["完结丙"],
};

const CATALOG_DROPDOWNS: Record<string, readonly string[]> = {
  反馈渠道: catalogFixture.channels,
  客诉类别: catalogFixture.categories,
  完结状态: catalogFixture.completionStatuses,
};

describe("ticket import template columns (golden)", () => {
  it("表头与填写说明逐字对齐 golden", () => {
    expect(TICKET_IMPORT_TEMPLATE_COLUMNS.map(({ header, note }) => ({ header, note }))).toEqual(
      GOLDEN_COLUMNS.map(({ header, note }) => ({ header, note })),
    );
  });

  it("下拉来源：静态枚举取字面量表，目录列接各自目录，其余列无下拉", () => {
    for (const [index, golden] of GOLDEN_COLUMNS.entries()) {
      const column = TICKET_IMPORT_TEMPLATE_COLUMNS[index];
      if (golden.dropdown === undefined) {
        expect(column?.options, golden.header).toBeUndefined();
        continue;
      }
      const values = column?.options?.(catalogFixture);
      const expected =
        golden.dropdown === "catalog" ? CATALOG_DROPDOWNS[golden.header] : golden.dropdown;
      expect(values, golden.header).toEqual(expected);
    }
  });
});
