import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PRESET_ROLES } from "@insuredesk/shared";
import { PrismaClient } from "@prisma/client";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrapSystemData } from "../prisma/seed-data";

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Production bootstrap (`pnpm db:bootstrap`) against a real Postgres: on an
 * empty database it must create the 4 preset roles, the 4 default SLA
 * policies, and exactly one admin account; re-running must never touch an
 * existing user's credentials — the operator may have changed the password
 * long after first install.
 */
describe("bootstrapSystemData (Testcontainers)", () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17-alpine").start();
    const databaseUrl = container.getConnectionUri();

    execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
      cwd: apiDir,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "pipe",
    });

    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  }, 120_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  it("on an empty database creates preset roles, SLA policies, and the admin", async () => {
    const result = await bootstrapSystemData(prisma, {
      adminUsername: "sysadmin",
      adminPassword: "first-install-pass",
    });

    expect(result.adminCreated).toBe(true);

    const roles = await prisma.role.findMany();
    expect(roles).toHaveLength(4);
    expect(roles.every((role) => role.preset)).toBe(true);

    const policies = await prisma.slaPolicy.findMany();
    expect(policies).toHaveLength(4);

    const admin = await prisma.user.findUnique({
      where: { username: "sysadmin" },
      include: { role: true },
    });
    expect(admin).not.toBeNull();
    expect(admin?.active).toBe(true);
    expect(admin?.role.name).toBe(PRESET_ROLES.ADMIN.name);
    expect(await bcrypt.compare("first-install-pass", admin?.passwordHash ?? "")).toBe(true);
  });

  it("re-running skips the existing admin and never rewrites its password hash", async () => {
    const before = await prisma.user.findUniqueOrThrow({ where: { username: "sysadmin" } });

    const result = await bootstrapSystemData(prisma, {
      adminUsername: "sysadmin",
      adminPassword: "a-different-pass",
    });

    expect(result.adminCreated).toBe(false);

    const after = await prisma.user.findUniqueOrThrow({ where: { username: "sysadmin" } });
    expect(after.passwordHash).toBe(before.passwordHash);
    expect(await prisma.user.count()).toBe(1);
  });
});
