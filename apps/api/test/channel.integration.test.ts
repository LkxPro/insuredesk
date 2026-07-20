import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Permission } from "@insuredesk/shared";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient, Role, User } from "../src/generated/prisma/client";
import type { AuthenticatedUser } from "../src/services/auth.service";

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Channel catalog smoke tests (issue #93). Full lifecycle coverage now lives
 * in dictionary-catalog.integration.test.ts; this suite only verifies
 * channel-specific quirks: factory seed, basic CRUD, and deletion guard.
 */
describe("Channel catalog smoke (Testcontainers)", () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let appRouter: typeof import("../src/routers/index").appRouter;
  let seedData: typeof import("../prisma/seed-data");
  let seeded: {
    roles: { admin: Role; csManager: Role; frontline: Role; readOnly: Role };
    users: { admin: User; manager: User; cs1: User; observer: User };
  };

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17-alpine").start();
    const databaseUrl = container.getConnectionUri();

    execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
      cwd: apiDir,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "pipe",
    });
    process.env.DATABASE_URL = databaseUrl;

    const [{ prisma: appPrisma }, seedModule, routers] = await Promise.all([
      import("../src/db"),
      import("../prisma/seed-data"),
      import("../src/routers/index"),
    ]);
    prisma = appPrisma;
    seedData = seedModule;
    appRouter = routers.appRouter;
    seeded = await seedData.seedFactoryRolesAndDemoUsers(prisma);
    await seedData.seedSlaPolicies(prisma);
    await seedData.seedChannels(prisma);
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  function callerWith(user: User, permissions: Permission[]) {
    const identity: AuthenticatedUser = {
      id: user.id,
      username: user.username,
      name: user.name,
      email: user.email,
      roleId: "role-under-test",
      roleName: "目录管理员",
      permissions,
      requiredTicketFields: [],
    };
    return appRouter.createCaller({
      traceId: "channel-smoke",
      user: identity,
      sessionToken: null,
    });
  }

  const manager = () =>
    callerWith(seeded.users.manager, [
      "dictionary.manage",
      "ticket.view",
      "ticket.view_all",
      "ticket.create",
      "ticket.edit",
      "ticket.delete",
    ] as Permission[]);

  it("seeds the 4 factory channels once and never restores later deletions or edits", async () => {
    const channels = await manager().channel.list();
    expect(channels.map((channel) => channel.name)).toEqual(["保司", "经纪", "支付", "监管"]);

    // Operator deletes one and renames another; a startup re-seed must keep hands off.
    const victim = await prisma.channel.findUniqueOrThrow({ where: { name: "经纪" } });
    await manager().channel.delete({ id: victim.id });
    const renamed = await prisma.channel.findUniqueOrThrow({ where: { name: "支付" } });
    await manager().channel.update({
      id: renamed.id,
      name: "第三方支付",
      displayOrder: renamed.displayOrder,
    });

    await seedData.seedChannels(prisma);
    const after = (await manager().channel.list()).map((channel) => channel.name);
    expect(after).toHaveLength(3);
    expect(after).not.toContain("经纪");
    expect(after).toContain("第三方支付");
  });

  it("creates a new channel", async () => {
    const created = await manager().channel.create({
      name: "测试新增渠道",
      displayOrder: 90,
    });
    expect(created).toMatchObject({
      name: "测试新增渠道",
      displayOrder: 90,
      active: true,
    });
  });

  it("renames a channel", async () => {
    const created = await manager().channel.create({
      name: "待重命名",
      displayOrder: 100,
    });
    const updated = await manager().channel.update({
      id: created.id,
      name: "已重命名",
      displayOrder: 100,
    });
    expect(updated.name).toBe("已重命名");
  });

  it("disables a channel", async () => {
    const created = await manager().channel.create({
      name: "待停用",
      displayOrder: 110,
    });
    await manager().channel.setActive({ id: created.id, active: false });
    const channels = await manager().channel.list();
    const disabled = channels.find((c) => c.id === created.id);
    expect(disabled?.active).toBe(false);
  });

  it("rejects deletion of a referenced channel", async () => {
    const channel = await manager().channel.create({
      name: "被引用渠道",
      displayOrder: 120,
    });
    await manager().ticket.create({
      feedbackTime: null,
      channelId: channel.id,
      project: null,
      brokerageEntity: null,
      paymentChannel: null,
      internalOrderNumber: null,
      policyNumber: null,
      userComplaintChannel: null,
      customerName: null,
      phone: null,
      contactPhone: null,
      customerRequest: null,
      nuclearBodyStatus: null,
      hasContacted: null,
      contactId: null,
      categoryId: null,
      complaintLevel: null,
      priority: null,
    });

    await expect(manager().channel.delete({ id: channel.id })).rejects.toMatchObject({
      code: "CONFLICT",
      message: "该渠道已被 1 张工单使用，无法删除，可改为停用",
    });
  });
});
