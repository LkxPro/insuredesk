import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client.ts";
import { writeOpsAlertNotifications } from "../src/services/notification.service.ts";
import { type IntegrationHarness, startIntegrationHarness } from "./integration-harness.ts";

describe("writeOpsAlertNotifications (Testcontainers)", () => {
  let harness: IntegrationHarness;
  let prisma: PrismaClient;

  beforeAll(async () => {
    harness = await startIntegrationHarness({ seed: ["rolesAndUsers"] });
    prisma = harness.prisma;
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  });

  it("定位全部启用的系统角色（管理员）用户落 ops_alert；停用管理员与普通角色不收", async () => {
    const seeded = harness.seeded;
    const inactiveAdmin = await prisma.user.create({
      data: {
        username: "admin-disabled",
        name: "停用管理员",
        passwordHash: "x",
        roleId: seeded.roles.admin.id,
        active: false,
      },
    });

    const now = new Date("2026-08-25T02:00:00.000Z");
    await prisma.$transaction(async (tx) => {
      await writeOpsAlertNotifications(tx, {
        title: "回调投递死信",
        content: "工单 WO100001 的回调 24h 内未投递成功",
        ticketId: null,
        workOrderNumber: "WO100001",
        now,
      });
    });

    const rows = await prisma.appNotification.findMany({ where: { type: "ops_alert" } });
    expect(rows.map((row) => row.targetUserId)).toEqual([seeded.users.admin.id]);
    expect(rows[0]).toMatchObject({
      type: "ops_alert",
      title: "回调投递死信",
      content: "工单 WO100001 的回调 24h 内未投递成功",
      ticketId: null,
      workOrderNumber: "WO100001",
      read: false,
    });
    expect(rows[0]?.createdAt.toISOString()).toBe(now.toISOString());

    const notifiedIds = new Set(rows.map((row) => row.targetUserId));
    expect(notifiedIds.has(inactiveAdmin.id)).toBe(false);
    expect(notifiedIds.has(seeded.users.manager.id)).toBe(false);
    expect(notifiedIds.has(seeded.users.cs1.id)).toBe(false);
  });
});
