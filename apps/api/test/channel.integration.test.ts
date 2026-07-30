import {
  type Permission,
  TICKET_CREATE_FIELD_KEYS,
  type TicketCreateInput,
} from "@insuredesk/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as seedData from "../prisma/seed-data";
import type { PrismaClient, User } from "../src/generated/prisma/client";
import { appRouter } from "../src/routers/index";
import type { AuthenticatedUser } from "../src/services/auth.service";
import { type IntegrationHarness, startIntegrationHarness } from "./integration-harness";

/**
 * Channel catalog smoke tests (issue #93). Full lifecycle coverage now lives
 * in dictionary-catalog.integration.test.ts; this suite only verifies
 * channel-specific quirks: factory seed, basic CRUD, and deletion guard.
 */
describe("Channel catalog smoke (Testcontainers)", () => {
  let harness: IntegrationHarness;
  let prisma: PrismaClient;
  let seeded: IntegrationHarness["seeded"];

  beforeAll(async () => {
    harness = await startIntegrationHarness({
      seed: ["rolesAndUsers", "slaPolicies", "channels"],
    });
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
      roleName: "目录管理员",
      permissions,
      requiredTicketFields: [],
      isExternal: false,
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
      ...Object.fromEntries(TICKET_CREATE_FIELD_KEYS.map((key) => [key, null])),
      channelId: channel.id,
    } as TicketCreateInput);

    await expect(manager().channel.delete({ id: channel.id })).rejects.toMatchObject({
      code: "CONFLICT",
      message: "该渠道已被 1 张工单使用，无法删除，可改为停用",
    });
  });

  it("rejects deletion when an external account's prefill references the channel, naming the account", async () => {
    const externalRole = await seedData.seedExternalUserRole(prisma);
    const channel = await manager().channel.create({
      name: "被预填引用渠道",
      displayOrder: 130,
    });
    const account = await prisma.user.create({
      data: {
        username: "prefill-ref-account",
        name: "预填账号甲",
        passwordHash: "dummy",
        roleId: externalRole.id,
        active: true,
        prefillChannelId: channel.id,
      },
    });

    await expect(manager().channel.delete({ id: channel.id })).rejects.toMatchObject({
      code: "CONFLICT",
      message: "该渠道被外部账号 「预填账号甲」 的预填引用，无法删除，可改为停用",
    });

    // 禁用账号依旧算引用 — 预填绑定不因启停消失
    await prisma.user.update({ where: { id: account.id }, data: { active: false } });
    await expect(manager().channel.delete({ id: channel.id })).rejects.toMatchObject({
      code: "CONFLICT",
    });

    // 解绑后即可物理删除
    await prisma.user.update({ where: { id: account.id }, data: { prefillChannelId: null } });
    await manager().channel.delete({ id: channel.id });
    expect(await prisma.channel.findUnique({ where: { id: channel.id } })).toBeNull();
  });
});
