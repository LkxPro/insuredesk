import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrapSystemData } from "../prisma/seed-data";

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Production bootstrap (runs on every container start) against a real
 * Postgres. First initialization (empty roles table) creates 管理员 + the
 * three factory roles, the default SLA policies, and one admin account.
 * Re-runs must leave roles exactly as the operator configured them — edited
 * permissions stay edited, deleted factory roles stay deleted — and must
 * never touch an existing user's credentials.
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

  it("first run creates 管理员 + three factory roles, SLA policies, and the admin account", async () => {
    const result = await bootstrapSystemData(prisma, {
      adminUsername: "sysadmin",
      adminPassword: "first-install-pass",
    });

    expect(result.adminCreated).toBe(true);

    const roles = await prisma.role.findMany();
    expect(roles.map((role) => role.name).sort()).toEqual(
      ["一线客服", "只读观察", "客服主管", "管理员"].sort(),
    );
    // 管理员 is the one and only system role
    expect(roles.filter((role) => role.system).map((role) => role.name)).toEqual(["管理员"]);

    const policies = await prisma.slaPolicy.findMany();
    expect(policies).toHaveLength(4);

    const admin = await prisma.user.findUnique({
      where: { username: "sysadmin" },
      include: { role: true },
    });
    expect(admin).not.toBeNull();
    expect(admin?.active).toBe(true);
    expect(admin?.role.system).toBe(true);
    expect(await bcrypt.compare("first-install-pass", admin?.passwordHash ?? "")).toBe(true);
  });

  it("re-running keeps operator edits: changed permissions stay, deleted factory roles stay deleted", async () => {
    await prisma.role.update({
      where: { name: "客服主管" },
      data: { name: "运营主管", permissions: ["ticket.view"] },
    });
    await prisma.role.delete({ where: { name: "只读观察" } });

    const result = await bootstrapSystemData(prisma, {
      adminUsername: "sysadmin",
      adminPassword: "first-install-pass",
    });
    expect(result.adminCreated).toBe(false);

    const roles = await prisma.role.findMany();
    expect(roles.map((role) => role.name).sort()).toEqual(["一线客服", "管理员", "运营主管"]);
    const renamed = roles.find((role) => role.name === "运营主管");
    expect(renamed?.permissions).toEqual(["ticket.view"]);
  });

  it("re-running never rewrites the existing admin's password hash", async () => {
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

  it("recreates a missing admin account against the surviving system role", async () => {
    await prisma.user.delete({ where: { username: "sysadmin" } });

    const result = await bootstrapSystemData(prisma, {
      adminUsername: "sysadmin",
      adminPassword: "reinstall-pass",
    });

    expect(result.adminCreated).toBe(true);
    const admin = await prisma.user.findUnique({
      where: { username: "sysadmin" },
      include: { role: true },
    });
    expect(admin?.role.name).toBe("管理员");
    expect(admin?.role.system).toBe(true);
    // Recreating the admin still repairs nothing else: roles stay as edited
    expect((await prisma.role.findMany()).map((role) => role.name).sort()).toEqual([
      "一线客服",
      "管理员",
      "运营主管",
    ]);
  });
});
