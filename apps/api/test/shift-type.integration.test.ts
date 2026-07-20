import type { Permission } from "@insuredesk/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient, User } from "../src/generated/prisma/client";
import { appRouter } from "../src/routers/index";
import type { AuthenticatedUser } from "../src/services/auth.service";
import { type IntegrationHarness, startIntegrationHarness } from "./integration-harness";

/**
 * ShiftType management acceptance tests at the public tRPC seam. These use a
 * real Postgres because the natural-name uniqueness and schedule FK deletion
 * guard are database invariants, while the router supplies the RBAC boundary.
 */
describe("ShiftType management (Testcontainers)", () => {
  let harness: IntegrationHarness;
  let prisma: PrismaClient;
  let seeded: IntegrationHarness["seeded"];

  beforeAll(async () => {
    harness = await startIntegrationHarness({ seed: ["rolesAndUsers", "shiftTypes"] });
    prisma = harness.prisma;
    seeded = harness.seeded;
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  });

  function callerWith(user: User, permissions: Permission[]) {
    const identity: AuthenticatedUser = {
      id: user.id,
      username: user.username,
      name: user.name,
      email: user.email,
      team: user.team,
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
