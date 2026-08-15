import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type IntegrationHarness, startIntegrationHarness } from "./integration-harness.ts";

/**
 * Acceptance tests for the integration harness itself, in real-migrations
 * mode: one call must yield a real Postgres with `migrate deploy` actually
 * executed and the app's canonical Prisma client wired to it. Proves the
 * migrate pipeline, connectivity, and the client wiring end-to-end — the
 * things that mock/SQLite substitutes cannot faithfully exercise.
 */
describe("integration harness: postgres connectivity + migration", () => {
  let harness: IntegrationHarness;

  beforeAll(async () => {
    harness = await startIntegrationHarness({ mode: "real-migrations" });
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  });

  it("connects to the real Postgres", async () => {
    const rows = await harness.prisma.$queryRaw<Array<{ ok: number }>>`SELECT 1 AS ok`;
    expect(rows[0]?.ok).toBe(1);
  });

  it("records the initial migration as applied", async () => {
    const applied = await harness.prisma.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL
    `;

    expect(applied.length).toBeGreaterThanOrEqual(1);
    expect(applied.some((row) => row.migration_name.endsWith("init"))).toBe(true);
  });

  it("拒绝访问未声明的 seed 集", () => {
    expect(() => harness.seeded).toThrowError(/seed/);
    expect(() => harness.channelId("保司")).toThrowError(/seed/);
  });

  it("固定 clock 按注入时刻走", () => {
    const at = new Date("2026-01-01T00:00:00.000Z");
    expect(harness.depsAt(at).clock.now()).toEqual(at);
  });

  it("拒绝同进程再起一个 harness——应用 Prisma 客户端是进程级单例", async () => {
    await expect(startIntegrationHarness()).rejects.toThrowError(/同一进程/);
  });
});
