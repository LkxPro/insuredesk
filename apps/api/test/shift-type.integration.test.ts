import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Permission } from "@insuredesk/shared";
import type { PrismaClient, Role, User } from "@prisma/client";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthenticatedUser } from "../src/services/auth.service";

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * ShiftType management acceptance tests at the public tRPC seam. These use a
 * real Postgres because the natural-name uniqueness and schedule FK deletion
 * guard are database invariants, while the router supplies the RBAC boundary.
 */
describe("ShiftType management (Testcontainers)", () => {
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
    await seedData.seedShiftTypes(prisma);
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
      roleName: "班次管理员",
      permissions,
      requiredTicketFields: [],
    };
    return appRouter.createCaller({
      traceId: "shift-type-test",
      user: identity,
      sessionToken: null,
    });
  }

  const manager = () =>
    callerWith(seeded.users.manager, ["schedule.manage_shifts"] as Permission[]);
  const unauthorized = () => callerWith(seeded.users.cs1, []);

  it("lists shift definitions by display order and supports an overnight multi-segment shift", async () => {
    const created = await manager().shiftType.create({
      name: "夜间拆分班",
      color: "#7c3aed",
      segments: [
        { start: "18:00", end: "23:30" },
        { start: "00:30", end: "02:00" },
      ],
      displayOrder: 4,
    });

    expect(created).toMatchObject({
      name: "夜间拆分班",
      color: "#7c3aed",
      segments: [
        { start: "18:00", end: "23:30" },
        { start: "00:30", end: "02:00" },
      ],
      displayOrder: 4,
    });

    const names = (await manager().shiftType.list()).map((shift) => shift.name);
    expect(names).toEqual(["早班", "晚班", "全班", "夜间拆分班", "休"]);
  });

  it("updates a shift and rejects duplicate names", async () => {
    const created = await manager().shiftType.create({
      name: "临时班",
      color: "#0f766e",
      segments: [{ start: "10:00", end: "16:00" }],
      displayOrder: 20,
    });

    const updated = await manager().shiftType.update({
      id: created.id,
      name: "临时长班",
      color: "#115e59",
      segments: [{ start: "10:00", end: "18:00" }],
      displayOrder: 21,
    });
    expect(updated).toMatchObject({
      id: created.id,
      name: "临时长班",
      color: "#115e59",
      segments: [{ start: "10:00", end: "18:00" }],
      displayOrder: 21,
    });

    await expect(
      manager().shiftType.create({
        name: "早班",
        color: "#000000",
        segments: [],
        displayOrder: 0,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", message: "班次名称已存在" });
  });

  it("deletes an unused definition and refuses one referenced by a schedule", async () => {
    const unused = await manager().shiftType.create({
      name: "待删除班",
      color: "#64748b",
      segments: [],
      displayOrder: 80,
    });
    await expect(manager().shiftType.delete({ id: unused.id })).resolves.toEqual({ id: unused.id });

    const early = await prisma.shiftType.findUniqueOrThrow({ where: { name: "早班" } });
    await prisma.schedule.create({
      data: { date: "2026-08-01", userId: seeded.users.cs1.id, shiftId: early.id },
    });
    await expect(manager().shiftType.delete({ id: early.id })).rejects.toMatchObject({
      code: "CONFLICT",
      message: "该班次已有排班记录，无法删除",
    });
  });

  it("gates every ShiftType operation with schedule.manage_shifts", async () => {
    await expect(unauthorized().shiftType.list()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      unauthorized().shiftType.create({
        name: "越权班",
        color: "#000000",
        segments: [],
        displayOrder: 0,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      unauthorized().shiftType.update({
        id: "unknown",
        name: "越权班",
        color: "#000000",
        segments: [],
        displayOrder: 0,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(unauthorized().shiftType.delete({ id: "unknown" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
