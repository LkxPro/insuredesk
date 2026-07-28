import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrapSystemData } from "../prisma/seed-data";
import type { PrismaClient } from "../src/generated/prisma/client";
import { type IntegrationHarness, startIntegrationHarness } from "./integration-harness";

/**
 * Production bootstrap (runs on every container start) against a real
 * Postgres. First initialization (empty roles table) creates 管理员 + the
 * three factory roles, the default SLA policies, the four default shift
 * definitions, and one admin account.
 * Re-runs must leave roles exactly as the operator configured them — edited
 * permissions stay edited, deleted factory roles stay deleted — and must
 * never touch an existing user's credentials.
 */
describe("bootstrapSystemData (Testcontainers)", () => {
  let harness: IntegrationHarness;
  let prisma: PrismaClient;

  beforeAll(async () => {
    harness = await startIntegrationHarness();
    prisma = harness.prisma;
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  });

  it("first run creates roles, SLA policies, default shifts, and the admin account", async () => {
    const result = await bootstrapSystemData(prisma, {
      adminUsername: "sysadmin",
      adminPassword: "first-install-pass",
    });

    expect(result.adminCreated).toBe(true);

    const roles = await prisma.role.findMany();
    expect(roles.map((role) => role.name).sort()).toEqual(
      ["一线客服", "只读观察", "外部用户", "客服主管", "管理员"].sort(),
    );
    // 管理员 is the one and only system role
    expect(roles.filter((role) => role.system).map((role) => role.name)).toEqual(["管理员"]);

    const policies = await prisma.slaPolicy.findMany();
    expect(policies).toHaveLength(4);

    expect(
      await prisma.shiftType.findMany({
        orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
        select: { name: true, color: true, segments: true, displayOrder: true },
      }),
    ).toEqual([
      {
        name: "早班",
        color: "#10b981",
        segments: [{ start: "09:00", end: "13:00" }],
        displayOrder: 1,
      },
      {
        name: "晚班",
        color: "#f59e0b",
        segments: [{ start: "15:00", end: "21:00" }],
        displayOrder: 2,
      },
      {
        name: "全班",
        color: "#3b82f6",
        segments: [{ start: "09:00", end: "18:00" }],
        displayOrder: 3,
      },
      { name: "休", color: "#9ca3af", segments: [], displayOrder: 99 },
    ]);

    const categories = await prisma.ticketCategory.findMany({
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
    });
    expect(categories).toHaveLength(17);
    expect(categories[0]).toMatchObject({ name: "监管投诉-引导性", displayOrder: 1, active: true });
    expect(categories[16]).toMatchObject({ name: "其他", displayOrder: 17, active: true });

    // 四渠道播种
    const channels = await prisma.channel.findMany({
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }],
      select: { name: true, active: true, displayOrder: true },
    });
    expect(channels).toEqual([
      { name: "保司", active: true, displayOrder: 1 },
      { name: "经纪", active: true, displayOrder: 2 },
      { name: "支付", active: true, displayOrder: 3 },
      { name: "监管", active: true, displayOrder: 4 },
    ]);

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
    expect(roles.map((role) => role.name).sort()).toEqual([
      "一线客服",
      "外部用户",
      "管理员",
      "运营主管",
    ]);
    const renamed = roles.find((role) => role.name === "运营主管");
    expect(renamed?.permissions).toEqual(["ticket.view"]);
  });

  it("re-running never recreates renamed or deleted default shifts", async () => {
    await prisma.shiftType.update({
      where: { name: "早班" },
      data: { name: "清晨班", color: "#123456" },
    });
    await prisma.shiftType.delete({ where: { name: "晚班" } });

    await bootstrapSystemData(prisma, {
      adminUsername: "sysadmin",
      adminPassword: "first-install-pass",
    });

    expect((await prisma.shiftType.findUniqueOrThrow({ where: { name: "清晨班" } })).color).toBe(
      "#123456",
    );
    expect(await prisma.shiftType.findUnique({ where: { name: "早班" } })).toBeNull();
    expect(await prisma.shiftType.findUnique({ where: { name: "晚班" } })).toBeNull();
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
      "外部用户",
      "管理员",
      "运营主管",
    ]);
  });
});
