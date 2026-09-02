import { describe, expect, it } from "vitest";
import {
  decodeCursor,
  encodeCursor,
  OPEN_API_ERROR_CODES,
  type OpenApiErrorCode,
  openApiErrorBody,
  openApiErrorBodySchema,
} from "./common.ts";

describe("openApiErrorBody", () => {
  it("产出 {error:{code,message}} 信封并过契约 schema", () => {
    const body = openApiErrorBody("unauthorized", "bad key");
    expect(body).toEqual({ error: { code: "unauthorized", message: "bad key" } });
    expect(() => openApiErrorBodySchema.parse(body)).not.toThrow();
  });

  it("码表冻结：每个映射状态码的 code 都在册", () => {
    expect(OPEN_API_ERROR_CODES).toEqual([
      "invalid_params",
      "invalid_cursor",
      "unauthorized",
      "forbidden",
      "not_found",
      "rate_limited",
      "concurrency_limit",
      "query_timeout",
      "internal_error",
    ]);
  });

  it("信封 schema 拒收册外 code", () => {
    const foreign = { error: { code: "not_in_table", message: "x" } };
    expect(openApiErrorBodySchema.safeParse(foreign).success).toBe(false);
    const valid: OpenApiErrorCode = "query_timeout";
    expect(openApiErrorBodySchema.safeParse({ error: { code: valid, message: "x" } }).success).toBe(
      true,
    );
  });
});

describe("cursor 编解码", () => {
  it("对象往返无损，产出 URL 安全字符", () => {
    const payload = { id: "cmxyz", at: "2026-09-02T00:00:00.000Z", n: 42 };
    const cursor = encodeCursor(payload);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(cursor)).toEqual(payload);
  });

  it("非 ASCII 载荷（多字节 UTF-8）往返无损", () => {
    const payload = { name: "张三·退费异常·🔶" };
    expect(decodeCursor(encodeCursor(payload))).toEqual(payload);
  });

  it("非 base64url 字符、坏 JSON、截断输入一律 null", () => {
    expect(decodeCursor("")).toBeNull();
    expect(decodeCursor("not a cursor!!")).toBeNull();
    expect(decodeCursor("aGVsbG8")).toBeNull();
    expect(decodeCursor(encodeCursor({ a: 1 }).slice(0, 3))).toBeNull();
  });
});
