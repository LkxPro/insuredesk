import bcrypt from "bcryptjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrapSystemData } from "../prisma/seed-data.ts";
import type { PrismaClient } from "../src/generated/prisma/client.ts";
import { type IntegrationHarness, startIntegrationHarness } from "./integration-harness.ts";

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
    expect(roles.filter((role) => role.system).map((role) => role.name)).toEqual(["管理员"]);

    const kinds = await prisma.ticketKind.findMany({ orderBy: { displayOrder: "asc" } });
    expect(kinds.map((kind) => [kind.key, kind.name, kind.active])).toEqual([
      ["complaint", "投诉", true],
      ["refund_exception", "退费异常", true],
    ]);
    const complaintKindId = kinds.find((kind) => kind.key === "complaint")?.id;
    const refundKindId = kinds.find((kind) => kind.key === "refund_exception")?.id;

    const policies = await prisma.slaPolicy.findMany({
      orderBy: { sortOrder: "asc" },
    });
    expect(policies.map((policy) => policy.name)).toEqual([
      "退费异常默认策略",
      "一般投诉",
      "高级投诉",
      "加急投诉",
      "特急投诉",
    ]);
    const refundPolicy = policies[0];
    expect(refundPolicy).toMatchObject({
      sortOrder: 0,
      active: true,
      firstResponseMinutes: 120,
      overdueHours: 48,
      kindId: refundKindId,
    });
    expect(refundPolicy?.reminderRules).toEqual([
      { type: "follow_up_checkpoint", checkpointHours: 36, requiredCount: 1, advanceMinutes: 180 },
    ]);
    for (const [index, policy] of policies.slice(1).entries()) {
      expect(policy.sortOrder).toBe(index + 1);
      expect(policy.active).toBe(true);
      expect(policy.description).toBeTruthy();
      expect(policy.kindId).toBe(complaintKindId);
    }

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
    await prisma.slaPolicy.update({
      where: { name: "一般投诉" },
      data: { name: "常规件", active: false },
    });

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

    const policies = await prisma.slaPolicy.findMany();
    expect(policies).toHaveLength(5);
    const edited = policies.find((policy) => policy.name === "常规件");
    expect(edited).toMatchObject({ active: false });
    // 复位，后续用例读出厂口径
    await prisma.slaPolicy.update({
      where: { name: "常规件" },
      data: { name: "一般投诉", active: true },
    });
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
    expect((await prisma.role.findMany()).map((role) => role.name).sort()).toEqual([
      "一线客服",
      "外部用户",
      "管理员",
      "运营主管",
    ]);
  });

  it("种类行与退费默认策略：重跑幂等、删掉即补插、管理员改名不回写", async () => {
    const options = { adminUsername: "sysadmin", adminPassword: "reinstall-pass" };

    await bootstrapSystemData(prisma, options);
    expect(await prisma.ticketKind.count()).toBe(2);
    expect(await prisma.slaPolicy.count()).toBe(5);

    await prisma.slaPolicy.delete({ where: { name: "退费异常默认策略" } });
    await bootstrapSystemData(prisma, options);
    expect(
      await prisma.slaPolicy.findUnique({ where: { name: "退费异常默认策略" } }),
    ).toMatchObject({ overdueHours: 48, active: true });
    expect(await prisma.slaPolicy.count()).toBe(5);

    await prisma.ticketKind.update({ where: { key: "complaint" }, data: { name: "客户投诉" } });
    await bootstrapSystemData(prisma, options);
    expect((await prisma.ticketKind.findUniqueOrThrow({ where: { key: "complaint" } })).name).toBe(
      "客户投诉",
    );
    expect(await prisma.ticketKind.count()).toBe(2);

    await prisma.slaPolicy.update({
      where: { name: "退费异常默认策略" },
      data: { name: "退款加急线" },
    });
    await bootstrapSystemData(prisma, options);
    expect(await prisma.slaPolicy.findUnique({ where: { name: "退款加急线" } })).not.toBeNull();
    expect(
      await prisma.slaPolicy.findUnique({ where: { name: "退费异常默认策略" } }),
    ).toMatchObject({ overdueHours: 48 });
    expect(await prisma.slaPolicy.count()).toBe(6);
  });
});
