import { huifuWebhookEventSchema } from "@insuredesk/shared";
import { describe, expect, it } from "vitest";
import { verifyHuifuSignature } from "./huifu-webhook.service.ts";

const SECRET = "0123456789abcdef0123456789abcdef";
const BODY = '{"namespace":"opps-webhook","event_define_no":"test","value":"中文 0.00"}';
const SIGN = "5C268F44AAD9E91CA5FF8C82DB13D5B8";

describe("汇付 Webhook 原文验签", () => {
  it("匹配外部计算的 UTF-8 MD5 向量，签名允许大小写", () => {
    expect(verifyHuifuSignature(BODY, SIGN, SECRET)).toBe(true);
    expect(verifyHuifuSignature(BODY, SIGN.toLowerCase(), SECRET)).toBe(true);
  });

  it("字节、密钥或签名变化均拒绝；不能先解析再格式化", () => {
    expect(verifyHuifuSignature(`${BODY}\n`, SIGN, SECRET)).toBe(false);
    expect(verifyHuifuSignature(JSON.stringify(JSON.parse(BODY), null, 2), SIGN, SECRET)).toBe(
      false,
    );
    expect(verifyHuifuSignature(BODY, SIGN, `${SECRET}x`)).toBe(false);
    for (const value of [undefined, "", "bad", "x".repeat(32), "0".repeat(32)]) {
      expect(verifyHuifuSignature(BODY, value, SECRET)).toBe(false);
    }
  });
});

describe("汇付投诉事件时间", () => {
  it("无效墙钟时间拒绝，不接受 Date 自动归一到下个月", () => {
    const payload = {
      namespace: "opps-webhook",
      event_define_no: "wechat.complaint",
      complaint_id: "1",
      mer_id: "2",
      complaint_datetime: "2026-02-30 10:00:00",
    };
    expect(huifuWebhookEventSchema.safeParse(payload).success).toBe(false);
    expect(
      huifuWebhookEventSchema.safeParse({ ...payload, complaint_datetime: "2028-02-29 10:00:00" })
        .success,
    ).toBe(true);
  });
});
