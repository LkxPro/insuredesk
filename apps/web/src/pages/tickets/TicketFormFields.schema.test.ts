import { TICKET_CREATE_FIELD_KEYS, TICKET_FIELDS, TICKET_TEXT_LIMITS } from "@insuredesk/shared";
import { describe, expect, it } from "vitest";
import { buildTicketFormSchema } from "./TicketFormFields";

/**
 * Issue #99: 必填红字与输入框可见 label 逐字一致。红字文案由描述表标准名
 * 派生；此处用字面量金样钉住曾经错位的八个改名残留（业务渠道/项目名称/
 * 手机号/联系电话/是否已联系/联系人ID/分类/内部工单号 → 标准名）。
 */

/** A wholly untouched form: text/select fields "", datetime "", tri-state null. */
const BLANK_FORM = {
  feedbackTime: "",
  contactTime: "",
  hasContacted: null,
  priority: "",
};

function requiredMessage(field: string): string | undefined {
  const schema = buildTicketFormSchema([field]);
  const result = schema.safeParse(BLANK_FORM);
  if (result.success) {
    return undefined;
  }
  return result.error.issues.find((issue) => issue.path[0] === field)?.message;
}

describe("buildTicketFormSchema 必填消息（描述表派生）", () => {
  // 独立金样：标准名来自 #97 已定口径，不从描述表转抄
  const RENAMED_FIELD_MESSAGES: Record<string, string> = {
    channelId: "反馈渠道为必填项",
    project: "项目（保司）为必填项",
    internalOrderNumber: "内部订单号为必填项",
    phone: "客户电话（投保人）为必填项",
    contactPhone: "联系人电话为必填项",
    hasContacted: "客户曾进线为必填项",
    contactId: "进线ID为必填项",
    categoryId: "客诉类别为必填项",
  };

  for (const [field, message] of Object.entries(RENAMED_FIELD_MESSAGES)) {
    it(`${field} 缺失时红字为「${message}」`, () => {
      expect(requiredMessage(field)).toBe(message);
    });
  }

  it("每个建单字段的红字都是「标准名为必填项」", () => {
    for (const key of TICKET_CREATE_FIELD_KEYS) {
      expect(requiredMessage(key)).toBe(`${TICKET_FIELDS[key].label}为必填项`);
    }
  });

  it("不在建单清单里的 key 被忽略（防御字段改名）", () => {
    const schema = buildTicketFormSchema(["completionStatusId", "nonexistent"]);
    expect(schema.safeParse(BLANK_FORM).success).toBe(true);
  });
});

describe("buildTicketFormSchema 长度上限（描述表派生）", () => {
  for (const [field, limit] of Object.entries(TICKET_TEXT_LIMITS)) {
    if (!TICKET_CREATE_FIELD_KEYS.includes(field as (typeof TICKET_CREATE_FIELD_KEYS)[number])) {
      continue;
    }
    it(`${field} 必填时仍限长 ${limit}`, () => {
      const schema = buildTicketFormSchema([field]);
      const atLimit = schema.safeParse({ ...BLANK_FORM, [field]: "字".repeat(limit) });
      const overLimit = schema.safeParse({ ...BLANK_FORM, [field]: "字".repeat(limit + 1) });
      expect(atLimit.success).toBe(true);
      expect(overLimit.success).toBe(false);
    });
  }
});
