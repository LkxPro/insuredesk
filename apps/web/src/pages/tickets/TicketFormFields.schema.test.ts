import { TICKET_CREATE_FIELD_KEYS, TICKET_FIELDS, TICKET_TEXT_LIMITS } from "@insuredesk/shared";
import { describe, expect, it } from "vitest";
import { buildTicketFormSchema } from "./TicketFormFields";

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

  it("保单号必填时，勾选「无保单号」算明确表态（空文本通过）", () => {
    const schema = buildTicketFormSchema(["policyNumbers"]);
    expect(schema.safeParse({ ...BLANK_FORM, noPolicyNumber: true }).success).toBe(true);
    expect(schema.safeParse({ ...BLANK_FORM, noPolicyNumber: false }).success).toBe(false);
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

  it(`分隔符拆分多值，单个限长 ${maxItemLength}`, () => {
    const atLimit = { ...BLANK_FORM, policyNumbers: `${"A".repeat(maxItemLength)} P2` };
    const overLimit = { ...BLANK_FORM, policyNumbers: `${"A".repeat(maxItemLength + 1)} P2` };
    expect(schema.safeParse(atLimit).success).toBe(true);
    expect(schema.safeParse(overLimit).success).toBe(false);
  });

  it(`数量上限 ${maxItems} 按去重后计数`, () => {
    const full = Array.from({ length: maxItems }, (_, i) => `P${i}`).join(" ");
    expect(schema.safeParse({ ...BLANK_FORM, policyNumbers: full }).success).toBe(true);
    expect(schema.safeParse({ ...BLANK_FORM, policyNumbers: `${full} P-extra` }).success).toBe(
      false,
    );
    expect(schema.safeParse({ ...BLANK_FORM, policyNumbers: `${full} P0 P1` }).success).toBe(true);
  });

  it("必填时空白串被拒，正常多值放行", () => {
    const required = buildTicketFormSchema(["policyNumbers"]);
    expect(required.safeParse(BLANK_FORM).success).toBe(false);
    expect(required.safeParse({ ...BLANK_FORM, policyNumbers: "P2026001，P2026002" }).success).toBe(
      true,
    );
  });
});

describe("buildTicketFormSchema 日期时间成对校验", () => {
  const optional = buildTicketFormSchema([]);

  it("空值和完整到分钟的本地时间合法", () => {
    expect(optional.safeParse(BLANK_FORM).success).toBe(true);
    expect(optional.safeParse({ ...BLANK_FORM, feedbackTime: "2026-07-15T09:30" }).success).toBe(
      true,
    );
  });

  it("只填日期或只填时间都会在提交校验中被拒绝", () => {
    for (const feedbackTime of ["2026-07-15T", "T09:30"]) {
      const result = optional.safeParse({ ...BLANK_FORM, feedbackTime });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.find((issue) => issue.path[0] === "feedbackTime")?.message).toBe(
          "反馈时间需同时选择日期和时间",
        );
      }
    }
  });

  it("键盘输入不存在的日期时给出日期格式提示", () => {
    const result = optional.safeParse({
      ...BLANK_FORM,
      feedbackTime: "2026-02-31T09:30",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.find((issue) => issue.path[0] === "feedbackTime")?.message).toBe(
        "反馈时间日期格式不正确，请按 YY-MM-DD 输入",
      );
    }
  });

  it("必填日期时间为空时仍使用标准必填文案", () => {
    expect(requiredMessage("feedbackTime")).toBe("反馈时间为必填项");
  });
});
