import { describe, expect, it } from "vitest";
import { openApiProcessLogsInputSchema } from "./process-logs.ts";
import { openApiTicketsInputSchema } from "./tickets.ts";

describe("开放 API query 输入 strict", () => {
  it("tickets：未知参数拒收（拼错的 updatedsince 不静默切全量）", () => {
    const lower = openApiTicketsInputSchema.safeParse({ updatedsince: "2026-08-01T00:00:00Z" });
    expect(lower.success).toBe(false);
    const unknown = openApiTicketsInputSchema.safeParse({ nope: "1" });
    expect(unknown.success).toBe(false);
  });

  it("tickets：已知参数照收，limit 缺省 200", () => {
    const parsed = openApiTicketsInputSchema.parse({ updatedSince: "2026-08-01T00:00:00Z" });
    expect(parsed.limit).toBe(200);
    expect(parsed.updatedSince).toBe("2026-08-01T00:00:00Z");
  });

  it("process-logs：未知参数拒收；旧参数名 since 已废", () => {
    const legacy = openApiProcessLogsInputSchema.safeParse({ since: "2026-08-01T00:00:00Z" });
    expect(legacy.success).toBe(false);
    const lower = openApiProcessLogsInputSchema.safeParse({ updatedsince: "2026-08-01T00:00:00Z" });
    expect(lower.success).toBe(false);
  });

  it("process-logs：updatedSince 照收", () => {
    const parsed = openApiProcessLogsInputSchema.parse({
      updatedSince: "2026-08-01T00:00:00Z",
    });
    expect(parsed.updatedSince).toBe("2026-08-01T00:00:00Z");
  });
});
