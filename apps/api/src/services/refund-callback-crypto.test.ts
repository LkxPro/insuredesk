import { describe, expect, it } from "vitest";
import { decryptRefundCallback, encryptRefundCallback } from "./refund-callback-crypto.ts";

// 已知答案来自对方文档示例密钥 + openssl 独立计算（非本实现产生），对拍 Java 参考实现语义。
const DOC_SECRET = "28631eafa8d346f68b3c3bbab0fac5ec";
const DOC_PLAINTEXT =
  '{"sysOrderId":"20260818163304040016053","endorNo":"20260818163304040016053_NO1_1787044393123","actualAmount":"100.00","workOrderNumber":"WO100001","compensationAmount":"20","remark":"测试测试测试","operator":"testUser"}';
const DOC_CIPHERTEXT =
  "f1048435751e9d4a036e80c16da9ed74a7498bf1801c6296380710ecd5d00c00525bb5922336567f436e9253ffdeadc23af91e341adeede114ec2ba5a5e7644ad9a9f7ad145ee3ef56f9afb230eb8aecfea413f762a1077c4087866055fcda7acfd58d18f5d8b4fc8b934978b9bff17da51f0dd4784d0783c0c0304fda8451f1f00194991419b97da34fa1f704ad82642440a1bbc1fea9d7dbb85e22455bb0c3bdb6a9e360d02baef2c705e0aaae83f72c1d9a1baf78bd8f4196e61a6a46df79cb94a6f25e50c9e1cf2fbd77418d2555b7fe418b8e36bbbc929f45c8aef69d18528df462742e85d41819c88704561a96";

describe("refund-callback-crypto", () => {
  it("加密与对方文档密钥对拍出已知密文（MD5 派生密钥前 16 字节、固定 IV、小写 Hex）", () => {
    expect(encryptRefundCallback(DOC_SECRET, DOC_PLAINTEXT)).toBe(DOC_CIPHERTEXT);
  });

  it("解已知密文还原明文（固定 IV 下 CBC 确定性，密文不含随机成分）", () => {
    expect(decryptRefundCallback(DOC_SECRET, DOC_CIPHERTEXT)).toBe(DOC_PLAINTEXT);
  });

  it("加解自洽：中文与空载荷边界", () => {
    expect(decryptRefundCallback(DOC_SECRET, encryptRefundCallback(DOC_SECRET, ""))).toBe("");
    const unicode = '{"remark":"退费已完成✓","operator":"客服甲"}';
    expect(decryptRefundCallback(DOC_SECRET, encryptRefundCallback(DOC_SECRET, unicode))).toBe(
      unicode,
    );
  });

  it("密文为小写 Hex", () => {
    expect(encryptRefundCallback(DOC_SECRET, DOC_PLAINTEXT)).toMatch(/^[0-9a-f]+$/);
  });
});
