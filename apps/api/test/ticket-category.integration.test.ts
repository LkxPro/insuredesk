import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type Permission,
  TICKET_CREATE_FIELD_KEYS,
  type TicketCreateInput,
} from "@insuredesk/shared";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient, Role, User } from "../src/generated/prisma/client";
import type { AuthenticatedUser } from "../src/services/auth.service";

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * TicketCategory catalog smoke tests (issue #93). Full lifecycle coverage now lives
 * in dictionary-catalog.integration.test.ts; this suite only verifies
 * category-specific quirks: factory seed, basic CRUD, and deletion guard.
 */
describe("TicketCategory catalog smoke (Testcontainers)", () => {
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
    await seedData.seedTicketCategories(prisma);
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
      traceId: "category-smoke",
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

  it("seeds the 17 factory categories once", async () => {
    const categories = await manager().ticketCategory.list();
    expect(categories.length).toBe(17);
    expect(categories.map((c) => c.name)).toContain("监管投诉-引导性");
    expect(categories.map((c) => c.name)).toContain("其他");
  });

  it("creates a new category", async () => {
    const created = await manager().ticketCategory.create({
      name: "测试新增类别",
      displayOrder: 90,
    });
    expect(created).toMatchObject({
      name: "测试新增类别",
      displayOrder: 90,
      active: true,
    });
  });

  it("renames a category", async () => {
    const created = await manager().ticketCategory.create({
      name: "待重命名类别",
      displayOrder: 100,
    });
    const updated = await manager().ticketCategory.update({
      id: created.id,
      name: "已重命名类别",
      displayOrder: 100,
    });
    expect(updated.name).toBe("已重命名类别");
  });

  it("disables a category", async () => {
    const created = await manager().ticketCategory.create({
      name: "待停用类别",
      displayOrder: 110,
    });
    await manager().ticketCategory.setActive({ id: created.id, active: false });
    const categories = await manager().ticketCategory.list();
    const disabled = categories.find((c) => c.id === created.id);
    expect(disabled?.active).toBe(false);
  });

  it("rejects deletion of a referenced category", async () => {
    const category = await manager().ticketCategory.create({
      name: "被引用类别",
      displayOrder: 120,
    });
    await manager().ticket.create({
      ...Object.fromEntries(TICKET_CREATE_FIELD_KEYS.map((key) => [key, null])),
      categoryId: category.id,
    } as TicketCreateInput);

    await expect(manager().ticketCategory.delete({ id: category.id })).rejects.toMatchObject({
      code: "CONFLICT",
      message: "该类别已被 1 张工单使用，无法删除，可改为停用",
    });
  });
});
