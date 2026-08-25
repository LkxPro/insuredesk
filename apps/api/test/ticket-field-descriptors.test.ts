import {
  TICKET_COMPLETION_REMARK_LIMIT,
  TICKET_CREATE_FIELD_KEYS,
  TICKET_FIELD_DESCRIPTORS,
  TICKET_FIELDS,
  TICKET_IMPORT_HEADERS,
  TICKET_TEXT_LIMITS,
  ticketExportHeader,
  ticketProcessLogLabel,
} from "@insuredesk/shared";
import { describe, expect, it } from "vitest";

/**
 * 全仓唯一的字段清单字面量金样：逐字钉住描述表整体（key、标准名、行序、
 * 类型约束、枚举取值、导入说明素材、override 槽位）。其余测试的字段清单/
 * 表头/label 断言一律参数化取自描述表——描述表被误改时只有这里报警，
 * 加字段时也只有这里和新字段自身的行为测试需要改动。
 *
 * override 值是既成契约（导出列头下游按名取数、留痕短名已写入历史日志），
 * 改动必须显式过这里。
 */

const GOLDEN_DESCRIPTORS = [
  { type: "date", key: "feedbackTime", label: "反馈时间" },
  {
    type: "catalog",
    key: "channelId",
    label: "反馈渠道",
    catalog: "channel",
    maxLength: 100,
    overrides: { exportHeader: "渠道", listLabel: "渠道" },
  },
  {
    type: "text",
    key: "project",
    label: "项目（保司）",
    maxLength: 100,
    importNoteSuffix: "如：融盛、泰康（填写简称即可）",
    overrides: { exportHeader: "项目" },
  },
  {
    type: "text",
    key: "brokerageEntity",
    label: "经纪主体",
    maxLength: 100,
    importNoteSuffix: "如：凯森、东方大地（填写简称即可）",
  },
  {
    type: "text",
    key: "paymentChannel",
    label: "支付渠道",
    maxLength: 100,
    importNoteSuffix: "如：连连、银商、易宝、京东",
  },
  { type: "text", key: "internalOrderNumber", label: "内部订单号", maxLength: 200 },
  { type: "textList", key: "policyNumbers", label: "保单号", maxItemLength: 100, maxItems: 50 },
  {
    type: "catalog",
    key: "userFeedbackChannelId",
    label: "用户反馈渠道",
    catalog: "userFeedbackChannel",
    maxLength: 100,
  },
  {
    type: "catalog",
    key: "feedbackReceiveChannelId",
    label: "反馈信息接收渠道",
    catalog: "feedbackReceiveChannel",
    maxLength: 100,
  },
  { type: "text", key: "customerName", label: "客户姓名", maxLength: 100 },
  {
    type: "text",
    key: "phone",
    label: "客户电话（投保人）",
    maxLength: 50,
    overrides: { exportHeader: "客户电话", processLogLabel: "客户电话" },
  },
  {
    type: "text",
    key: "contactPhone",
    label: "联系人电话",
    maxLength: 200,
    overrides: { exportHeader: "联系电话", detailLabel: "联系人电话（备用）" },
  },
  {
    type: "enum",
    key: "nuclearBodyStatus",
    label: "保司侧是否核身",
    options: [
      { label: "是", value: "是" },
      { label: "否", value: "否" },
      { label: "待核实", value: "待核实" },
    ],
    emptyMeaning: "未填写",
    overrides: { exportHeader: "核体状态" },
  },
  { type: "text", key: "customerRequest", label: "客户诉求", maxLength: 2000 },
  {
    type: "enum",
    key: "hasContacted",
    label: "客户曾进线",
    options: [
      { label: "是", value: true },
      { label: "否", value: false },
    ],
    emptyMeaning: "未知",
    overrides: { exportHeader: "是否已联系" },
  },
  { type: "date", key: "contactTime", label: "进线时间" },
  {
    type: "text",
    key: "contactId",
    label: "进线ID",
    maxLength: 200,
    overrides: { exportHeader: "联系ID" },
  },
  {
    type: "catalog",
    key: "categoryId",
    label: "客诉类别",
    catalog: "category",
    maxLength: 100,
    overrides: { exportHeader: "分类", listLabel: "类别" },
  },
  {
    type: "catalog",
    key: "slaPolicyId",
    label: "时效策略",
    catalog: "slaPolicy",
    maxLength: 100,
    importNoteTail: "留空=未定级（无处理时限与 SLA 告警）",
  },
  {
    type: "enum",
    key: "priority",
    label: "优先级",
    options: [
      { label: "低", value: "low" },
      { label: "中", value: "medium" },
      { label: "高", value: "high" },
      { label: "紧急", value: "urgent" },
    ],
    emptyMeaning: "未设置",
  },
  {
    type: "catalog",
    key: "completionStatusId",
    label: "完结状态",
    catalog: "completionStatus",
    maxLength: 100,
    importOnly: true,
    importNoteTail: "须与「完结备注」同时填写或同时留空",
  },
  {
    type: "text",
    key: "completionRemark",
    label: "完结备注",
    maxLength: 2000,
    importOnly: true,
    importNoteSuffix: "须与「完结状态」同时填写或同时留空",
  },
] as const;

describe("ticket field descriptors (golden)", () => {
  it("描述表逐行逐字对齐金样", () => {
    expect(TICKET_FIELD_DESCRIPTORS).toEqual(GOLDEN_DESCRIPTORS);
  });

  it("建单字段 key 清单＝金样去掉导入专属列，保持表单呈现顺序", () => {
    expect(TICKET_CREATE_FIELD_KEYS).toEqual(
      GOLDEN_DESCRIPTORS.filter((row) => !("importOnly" in row)).map((row) => row.key),
    );
  });

  it("导入表头＝金样各行的标准名（列序即表序），完结迁移对固定收尾", () => {
    expect(TICKET_IMPORT_HEADERS).toEqual(GOLDEN_DESCRIPTORS.map((row) => row.label));
    expect(GOLDEN_DESCRIPTORS.filter((row) => "importOnly" in row).map((row) => row.key)).toEqual([
      "completionStatusId",
      "completionRemark",
    ]);
    expect(TICKET_IMPORT_HEADERS.slice(-2)).toEqual(["完结状态", "完结备注"]);
  });

  it("文本长度上限＝金样建单文本行的 maxLength；完结备注上限单独出口", () => {
    expect(TICKET_TEXT_LIMITS).toEqual(
      Object.fromEntries(
        GOLDEN_DESCRIPTORS.flatMap((row) =>
          row.type === "text" && !("importOnly" in row) ? [[row.key, row.maxLength]] : [],
        ),
      ),
    );
    expect(TICKET_COMPLETION_REMARK_LIMIT).toBe(TICKET_FIELDS.completionRemark.maxLength);
  });

  it("表面用词派生：登记了 override 槽位用登记值，缺省回落标准名", () => {
    expect(ticketExportHeader("channelId")).toBe(TICKET_FIELDS.channelId.overrides.exportHeader);
    expect(ticketExportHeader("customerName")).toBe(TICKET_FIELDS.customerName.label);
    expect(ticketProcessLogLabel("phone")).toBe(TICKET_FIELDS.phone.overrides.processLogLabel);
    expect(ticketProcessLogLabel("channelId")).toBe(TICKET_FIELDS.channelId.label);
  });
});
