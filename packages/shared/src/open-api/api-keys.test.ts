import { describe, expect, it } from "vitest";
import {
  apiKeyCreateInputSchema,
  apiKeyListInputSchema,
  apiKeyListItemSchema,
} from "./api-keys.ts";

describe("apiKeyCreateInputSchema", () => {
  it("expiresAt 可空：null = 永不过期；带时区 ISO 字符串照收", () => {
    expect(apiKeyCreateInputSchema.parse({ name: "k", expiresAt: null }).expiresAt).toBeNull();
    expect(
      apiKeyCreateInputSchema.parse({ name: "k", expiresAt: "2099-01-01T00:00:00+08:00" })
        .expiresAt,
    ).toBe("2099-01-01T00:00:00+08:00");
  });

  it("非 null 时必须未来时间：过去时刻拒收", () => {
    const past = apiKeyCreateInputSchema.safeParse({
      name: "k",
      expiresAt: "2020-01-01T00:00:00Z",
    });
    expect(past.success).toBe(false);
  });

  it("缺省/畸形 expiresAt 拒收", () => {
    expect(apiKeyCreateInputSchema.safeParse({ name: "k" }).success).toBe(false);
    expect(apiKeyCreateInputSchema.safeParse({ name: "k", expiresAt: "not-a-date" }).success).toBe(
      false,
    );
  });
});

describe("apiKeyListInputSchema", () => {
  it("includeRevoked 缺省 false", () => {
    expect(apiKeyListInputSchema.parse({}).includeRevoked).toBe(false);
    expect(apiKeyListInputSchema.parse({ includeRevoked: true }).includeRevoked).toBe(true);
  });
});

describe("apiKeyListItemSchema", () => {
  const base = {
    id: "k1",
    name: "报表",
    keyPreview: "abcd1234",
    expiresAt: null,
    lastUsedAt: null,
    createdAt: "2026-09-01T00:00:00.000Z",
  };

  it("keyPreview/expiresAt null 照收；status 含读时派生的 expired", () => {
    expect(() => apiKeyListItemSchema.parse({ ...base, status: "active" })).not.toThrow();
    expect(() => apiKeyListItemSchema.parse({ ...base, status: "revoked" })).not.toThrow();
    expect(() => apiKeyListItemSchema.parse({ ...base, status: "expired" })).not.toThrow();
    expect(apiKeyListItemSchema.safeParse({ ...base, status: "disabled" }).success).toBe(false);
  });
});
