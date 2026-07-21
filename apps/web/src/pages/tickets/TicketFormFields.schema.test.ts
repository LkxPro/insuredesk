import { TICKET_CREATE_FIELD_KEYS, TICKET_FIELDS, TICKET_TEXT_LIMITS } from "@insuredesk/shared";
import { describe, expect, it } from "vitest";
import { buildTicketFormSchema } from "./TicketFormFields";

/**
 * Issue #99: 必填红字与输入框可见 label 逐字一致，文本限长与描述表同源。
 */

/** A wholly untouched form: text/select fields "", datetime "", tri-state null. */
const BLANK_FORM = {
  feedbackTime: "",
  contactTime: "",
  policyNumbers: "",
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

describe("buildTicketFormSchema 保单号多值上限（描述表派生）", () => {
  const { maxItemLength, maxItems } = TICKET_FIELDS.policyNumbers;
  const schema = buildTicketFormSchema([]);

  it(`空格分隔多值，单个限长 ${maxItemLength}`, () => {
    const atLimit = { ...BLANK_FORM, policyNumbers: `${"字".repeat(maxItemLength)} P2` };
    const overLimit = { ...BLANK_FORM, policyNumbers: `${"字".repeat(maxItemLength + 1)} P2` };
    expect(schema.safeParse(atLimit).success).toBe(true);
    expect(schema.safeParse(overLimit).success).toBe(false);
  });

  it(`数量上限 ${maxItems} 按去重后计数`, () => {
    const full = Array.from({ length: maxItems }, (_, i) => `P${i}`).join(" ");
    expect(schema.safeParse({ ...BLANK_FORM, policyNumbers: full }).success).toBe(true);
    expect(schema.safeParse({ ...BLANK_FORM, policyNumbers: `${full} P-extra` }).success).toBe(
      false,
    );
    // 重复值静默去重，不算超量
    expect(schema.safeParse({ ...BLANK_FORM, policyNumbers: `${full} P0 P1` }).success).toBe(true);
  });

  it("必填时空白串被拒，正常多值放行", () => {
    const required = buildTicketFormSchema(["policyNumbers"]);
    expect(required.safeParse(BLANK_FORM).success).toBe(false);
    expect(
      required.safeParse({ ...BLANK_FORM, policyNumbers: "P2026-001 P2026-002" }).success,
    ).toBe(true);
  });
});
