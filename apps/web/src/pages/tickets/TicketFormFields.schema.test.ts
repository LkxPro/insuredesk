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
