import { huifuWebhookEventSchema } from "@insuredesk/shared";
import { describe, expect, it } from "vitest";
import {
  huifuBrokerageEntity,
  huifuUserFeedbackChannelName,
  verifyHuifuSignature,
} from "./huifu-webhook.service.ts";

const SECRET = "0123456789abcdef0123456789abcdef";
const BODY = '{"namespace":"opps-webhook","event_define_no":"test","value":"中文 0.00"}';
const SIGN = "5C268F44AAD9E91CA5FF8C82DB13D5B8";

describe("汇付用户反馈渠道", () => {
  it.each([
    ["01", "支付400热线"],
    ["04", "黑猫"],
    ["05", "人行专线"],
    ["13", "人行消保"],
    ["14", "人行信访"],
    ["17", "银行"],
    ["18", "消费保"],
    [" 04 ", "黑猫"],
    ["1", null],
    ["10", null],
    ["99", null],
    ["__proto__", null],
    [undefined, null],
  ])("%s 映射为 %s", (code, expected) => {
    expect(huifuUserFeedbackChannelName(code)).toBe(expected);
  });
});

describe("汇付商户主体", () => {
  it.each([
    ["陕西凯森保险代理有限公司", "凯森"],
    ["东方大地保险经纪有限公司", "东方大地"],
    ["中融保险经纪有限公司", "中融"],
    ["其他商户", null],
    [undefined, null],
    ["凯森与东方大地", null],
  ])("%s 映射为 %s", (name, expected) => {
    expect(huifuBrokerageEntity(name)).toBe(expected);
  });
});

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

describe("汇付附件不保留", () => {
  it.each(
    [[], ["https://example.com/a.png"], "[]", '[ "https://example.com/a.png" ]', null, {}].map(
      (attachmentList) => ({ attachmentList }),
    ),
  )("附件值 %j 不进入业务字段", ({ attachmentList }) => {
    const result = huifuWebhookEventSchema.parse({
      namespace: "opps-webhook",
      event_define_no: "hotline.complaint",
      ticketId: "attachment-test",
      merchantNo: "test-merchant",
      complaintTime: "2026-11-06 14:00:00",
      attachmentList,
    });
    expect(result).not.toHaveProperty("attachmentList");
  });
});
