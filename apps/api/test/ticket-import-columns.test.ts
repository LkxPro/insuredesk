import {
  TICKET_FIELD_DESCRIPTORS,
  TICKET_FIELDS,
  TICKET_IMPORT_HEADERS,
  type TicketCatalogKind,
  type TicketFieldKey,
} from "@insuredesk/shared";
import { describe, expect, it } from "vitest";
import { TICKET_IMPORT_TEMPLATE_COLUMNS } from "../src/services/ticket-import-template.service.ts";

/**
 * 模板列的派生行为：表头/填写说明/下拉全部由描述表生成。字段材料
 * （标准名、长度、枚举取值、说明素材）从描述表取用，字面量金样收在
 * ticket-field-descriptors.test.ts；这里钉的是派生"胶水"——说明句式
 * 与下拉接线。导入模板是对用户的既成契约，句式变化必须在这里显式改
 * 预期才能通过。
 */

function columnOf(key: TicketFieldKey) {
  const importDescriptors = TICKET_FIELD_DESCRIPTORS.filter(
    (descriptor) => !("formOnly" in descriptor && descriptor.formOnly === true),
  );
  const index = importDescriptors.findIndex((descriptor) => descriptor.key === key);
  const column = TICKET_IMPORT_TEMPLATE_COLUMNS[index];
  if (!column) {
    throw new Error(`模板缺少「${key}」列`);
  }
  return column;
}

describe("ticket import template columns", () => {
  it("模板列头＝描述表导入表头，列序即表序", () => {
    expect(TICKET_IMPORT_TEMPLATE_COLUMNS.map((column) => column.header)).toEqual(
      TICKET_IMPORT_HEADERS,
    );
  });

  it("文本列句式：「文本，最长 N 字」，登记了素材的接「；素材」", () => {
    const { maxLength } = TICKET_FIELDS.internalOrderNumber;
    expect(columnOf("internalOrderNumber").note).toBe(`文本，最长 ${maxLength} 字`);

    const { maxLength: projectMax, importNoteSuffix } = TICKET_FIELDS.project;
    expect(columnOf("project").note).toBe(`文本，最长 ${projectMax} 字；${importNoteSuffix}`);
  });

  it("多值文本列句式：分隔符说明与单个长度/数量上限", () => {
    const { maxItemLength, maxItems } = TICKET_FIELDS.policyNumbers;
    expect(columnOf("policyNumbers").note).toBe(
      `文本，可填多个（空格/逗号/顿号等分隔，重复自动去重）；单个最长 ${maxItemLength} 字，最多 ${maxItems} 个`,
    );
  });

  it("日期列句式：固定格式示例与留空含义", () => {
    expect(columnOf("feedbackTime").note).toBe(
      "格式 yyyy-MM-dd HH:mm（如 2026-07-09 14:30）；留空=未填写",
    );
    expect(columnOf("contactTime").note).toBe(columnOf("feedbackTime").note);
  });

  it("枚举列句式：「从下拉选择：A / B；留空=空值含义」", () => {
    const { options, emptyMeaning } = TICKET_FIELDS.priority;
    expect(columnOf("priority").note).toBe(
      `从下拉选择：${options.map((option) => option.label).join(" / ")}；留空=${emptyMeaning}`,
    );
  });

  it("目录列句式：「从下拉选择（下载模板时启用的◯◯目录）」，默认尾注可被完结对规则覆盖", () => {
    expect(columnOf("channelId").note).toBe("从下拉选择（下载模板时启用的渠道目录）；留空=未填写");
    expect(columnOf("categoryId").note).toBe("从下拉选择（下载模板时启用的类别目录）；留空=未填写");
    expect(columnOf("slaPolicyId").note).toBe(
      `从下拉选择（下载模板时启用的时效策略目录）；${TICKET_FIELDS.slaPolicyId.importNoteTail}`,
    );
    expect(columnOf("completionStatusId").note).toBe(
      `从下拉选择（下载模板时启用的完结状态目录）；${TICKET_FIELDS.completionStatusId.importNoteTail}`,
    );
  });

  /** formOnly 行（旧投诉等级文本轨）不进导入列。 */
  it("投诉等级为 formOnly：不占导入列，时效策略引用列占据其表序位置", () => {
    expect(TICKET_IMPORT_HEADERS).not.toContain("投诉等级");
    expect(TICKET_IMPORT_HEADERS.indexOf("时效策略")).toBe(
      TICKET_IMPORT_HEADERS.indexOf("客诉类别") + 1,
    );
  });

  /** 每个目录列一个可识别的独立取值集，验证接的是自己那份目录。 */
  const catalogFixture = {
    channels: ["渠道甲"],
    categories: ["类别乙"],
    completionStatuses: ["完结丙"],
    slaPolicies: ["策略丁"],
  };

  const CATALOG_DROPDOWNS: Record<TicketCatalogKind, readonly string[]> = {
    channel: catalogFixture.channels,
    category: catalogFixture.categories,
    completionStatus: catalogFixture.completionStatuses,
    slaPolicy: catalogFixture.slaPolicies,
  };

  it("下拉来源：枚举列取自己的选项 label，目录列接各自目录，其余列无下拉", () => {
    for (const descriptor of TICKET_FIELD_DESCRIPTORS) {
      if ("formOnly" in descriptor && descriptor.formOnly === true) {
        continue;
      }
      const column = columnOf(descriptor.key);
      if (descriptor.type === "enum") {
        expect(column.options?.(catalogFixture), descriptor.key).toEqual(
          descriptor.options.map((option) => option.label),
        );
      } else if (descriptor.type === "catalog") {
        expect(column.options?.(catalogFixture), descriptor.key).toEqual(
          CATALOG_DROPDOWNS[descriptor.catalog],
        );
      } else {
        expect(column.options, descriptor.key).toBeUndefined();
      }
    }
  });
});
