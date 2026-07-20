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
 * ticketCategory.filterOptions acceptance tests. The procedure completes the
 * 渠道/完结状态 symmetry: the whole catalog rides along with the active flag
 * so filtering by a disabled category still reaches its 存量工单.
 */
describe("TicketCategory filter options (Testcontainers)", () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let appRouter: typeof import("../src/routers/index").appRouter;
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

    const [{ prisma: appPrisma }, seedData, routers] = await Promise.all([
      import("../src/db"),
      import("../prisma/seed-data"),
      import("../src/routers/index"),
    ]);
    prisma = appPrisma;
    appRouter = routers.appRouter;
    seeded = await seedData.seedFactoryRolesAndDemoUsers(prisma);
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
      traceId: "ticket-category-filter-options-test",
      user: identity,
      sessionToken: null,
    });
  }

  const manager = () => callerWith(seeded.users.manager, ["dictionary.manage"] as Permission[]);
  const frontline = () => callerWith(seeded.users.cs1, ["ticket.view"] as Permission[]);

  it("returns the whole catalog with active flags — 停用 rows included, in display order", async () => {
    const kept = await manager().ticketCategory.create({ name: "筛选保留", displayOrder: 301 });
    const disabled = await manager().ticketCategory.create({ name: "筛选停用", displayOrder: 302 });
    await manager().ticketCategory.setActive({ id: disabled.id, active: false });

    const filterOptions = await frontline().ticketCategory.filterOptions();
    const tail = filterOptions.slice(-2);
    expect(tail).toEqual([
      { id: kept.id, name: "筛选保留", active: true },
      { id: disabled.id, name: "筛选停用", active: false },
    ]);

    const optionNames = (await frontline().ticketCategory.options()).map((o) => o.name);
    expect(optionNames).toContain("筛选保留");
    expect(optionNames).not.toContain("筛选停用");
  });
});
