import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PrismaClient } from "@prisma/client";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The high-value integration test: spin up a real Postgres, run `migrate deploy`
 * against it, then drive the app's own Prisma client. Proves the migrate
 * pipeline, connectivity, and the client wiring end-to-end — the things that
 * mock/SQLite substitutes cannot faithfully exercise.
 */
describe("postgres connectivity + migration", () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16-alpine").start();
    const databaseUrl = container.getConnectionUri();

    // Apply migrations to the fresh container via the real Prisma CLI.
    execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
      cwd: apiDir,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "inherit",
    });

    // Import the app's canonical client only after DATABASE_URL points at the
    // container, so we exercise the real db.ts wiring rather than a bespoke client.
    process.env.DATABASE_URL = databaseUrl;
    const { prisma: appPrisma } = await import("../src/db");
    prisma = appPrisma;
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  it("connects to the real Postgres", async () => {
    const rows = await prisma.$queryRaw<Array<{ ok: number }>>`SELECT 1 AS ok`;
    expect(rows[0]?.ok).toBe(1);
  });

  it("records the initial migration as applied", async () => {
    const applied = await prisma.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL
    `;

    expect(applied.length).toBeGreaterThanOrEqual(1);
    expect(applied.some((row) => row.migration_name.endsWith("init"))).toBe(true);
  });
});
