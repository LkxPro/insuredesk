import { describe, expect, it } from "vitest";
import { externalTicketSubmitInputSchema } from "./external-ticket.ts";

describe("外部工单投保人手机号", () => {
  it.each([undefined, null, "", "   ", "1380000", "1380000111x", "138000011111"])(
    "手机号 %j 不能提交",
    (phone) => {
      expect(
        externalTicketSubmitInputSchema.safeParse({ submissionText: "反馈原文", phone }).success,
      ).toBe(false);
    },
  );
  it("去掉首尾空格", () => {
    expect(
      externalTicketSubmitInputSchema.parse({ submissionText: " 原文 ", phone: " 13800001111 " }),
    ).toEqual({ submissionText: "原文", phone: "13800001111" });
  });
});
