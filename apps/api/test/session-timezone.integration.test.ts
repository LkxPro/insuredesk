import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { type IntegrationHarness, startIntegrationHarness } from "./integration-harness.ts";

describe("会话时区契约 (Testcontainers)", () => {
  let harness: IntegrationHarness;

  beforeAll(async () => {
    harness = await startIntegrationHarness({ mode: "real-migrations" });
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  });

  it("app 连接会话时区为 UTC（db.ts 连接级 options）", async () => {
    const rows = await harness.prisma.$queryRawUnsafe<{ tz: string }[]>(
      "SELECT current_setting('timezone') AS tz",
    );
    expect(rows[0]?.tz).toBe("UTC");
  });

  it("库级默认时区为 UTC（无 options 的裸连接）", async () => {
    const bare = new PrismaClient({ adapter: new PrismaPg(harness.databaseUrl) });
    try {
      const rows = await bare.$queryRawUnsafe<{ tz: string }[]>(
        "SELECT current_setting('timezone') AS tz",
      );
      expect(rows[0]?.tz).toBe("UTC");
    } finally {
      await bare.$disconnect();
    }
  });

  it("timestamptz 参数化往返无偏移", async () => {
    const instant = new Date("2026-08-26T03:55:36.123Z");
    const rows = await harness.prisma.$queryRaw<{ v: Date }[]>`
      SELECT ${instant}::timestamptz AS v
    `;
    expect(rows[0]?.v.toISOString()).toBe(instant.toISOString());
  });
});
