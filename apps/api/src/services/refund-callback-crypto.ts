import { createCipheriv, createDecipheriv, createHash } from "node:crypto";

// 骏伯平台契约：固定 IV；密钥 = MD5(secret) 32 位小写 Hex 字符串的前 16 字节（ASCII）。
const FIXED_IV = Buffer.from("8765432112345678", "ascii");

function deriveKey(secret: string): Buffer {
  const md5Hex = createHash("md5").update(secret, "utf8").digest("hex");
  return Buffer.from(md5Hex, "ascii").subarray(0, 16);
}

/** Java 的 PKCS5Padding 即 16 字节块下的 PKCS#7 —— node:crypto 的 CBC 默认填充，无需配置。 */
export function encryptRefundCallback(secret: string, plaintext: string): string {
  const cipher = createCipheriv("aes-128-cbc", deriveKey(secret), FIXED_IV);
  return Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]).toString("hex");
}

export function decryptRefundCallback(secret: string, ciphertextHex: string): string {
  const decipher = createDecipheriv("aes-128-cbc", deriveKey(secret), FIXED_IV);
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, "hex")),
    decipher.final(),
  ]).toString("utf8");
}
