import type { Permission } from "@insuredesk/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { User } from "../src/generated/prisma/client";
import { appRouter } from "../src/routers/index";
import type { AuthenticatedUser } from "../src/services/auth.service";
import { type IntegrationHarness, startIntegrationHarness } from "./integration-harness";

describe("ExternalOrg management (Testcontainers)", () => {
  let harness: IntegrationHarness;
  let seeded: IntegrationHarness["seeded"];

  beforeAll(async () => {
    harness = await startIntegrationHarness({ seed: ["rolesAndUsers", "channels"] });
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
      roleName: "测试角色",
      permissions,
      requiredTicketFields: [],
      externalOrgId: null,
    };
    return appRouter.createCaller({
      traceId: "external-org-test",
      user: identity,
      sessionToken: null,
    });
  }

  const manager = () => callerWith(seeded.users.manager, ["external_org.manage"]);

  it("lists external orgs (empty initially)", async () => {
    const orgs = await manager().externalOrg.list();
    expect(orgs).toEqual([]);
  });

  it("creates an external org with name only", async () => {
    const result = await manager().externalOrg.create({ name: "测试机构A" });
    expect(result).toHaveProperty("id");
    expect(typeof result.id).toBe("string");

    const orgs = await manager().externalOrg.list();
    expect(orgs).toHaveLength(1);
    expect(orgs[0]).toMatchObject({
      name: "测试机构A",
      channelId: null,
      channelName: null,
      visibleTicketFields: null,
      userCount: 0,
      active: true,
    });
  });

  it("creates an org with channel and visible fields", async () => {
    const channels = await harness.prisma.channel.findMany();
    const channelId = channels[0]?.id;
    expect(channelId).toBeDefined();

    const result = await manager().externalOrg.create({
      name: "测试机构B",
      channelId,
      visibleTicketFields: ["feedbackTime", "project", "customerRequest"],
    });
    expect(result).toHaveProperty("id");

    const orgs = await manager().externalOrg.list();
    const orgB = orgs.find((o) => o.name === "测试机构B");
    expect(orgB).toMatchObject({
      name: "测试机构B",
      channelId,
      visibleTicketFields: ["feedbackTime", "project", "customerRequest"],
      userCount: 0,
      active: true,
    });
    expect(orgB?.channelName).toBeTruthy();
  });

  it("rejects duplicate org name", async () => {
    await manager().externalOrg.create({ name: "重复名称机构" });
    await expect(manager().externalOrg.create({ name: "重复名称机构" })).rejects.toThrow(
      "机构名称已存在",
    );
  });

  it("rejects sensitive field in visible fields", async () => {
    await expect(
      manager().externalOrg.create({
        name: "敏感字段测试机构",
        visibleTicketFields: ["project", "phone"],
      }),
    ).rejects.toThrow("phone");
  });

  it("rejects invalid field name in visible fields", async () => {
    await expect(
      manager().externalOrg.create({
        name: "非法字段测试机构",
        visibleTicketFields: ["project", "fakeField"],
      }),
    ).rejects.toThrow("fakeField");
  });

  it("updates org name", async () => {
    const created = await manager().externalOrg.create({ name: "待更新机构" });
    await manager().externalOrg.update({ id: created.id, name: "已更新机构" });

    const orgs = await manager().externalOrg.list();
    const updated = orgs.find((o) => o.id === created.id);
    expect(updated?.name).toBe("已更新机构");
  });

  it("updates org channel and visible fields", async () => {
    const created = await manager().externalOrg.create({ name: "待更新配置机构" });
    const channels = await harness.prisma.channel.findMany();
    const channelId = channels[0]?.id;

    await manager().externalOrg.update({
      id: created.id,
      channelId,
      visibleTicketFields: ["feedbackTime", "project", "customerRequest"],
    });

    const orgs = await manager().externalOrg.list();
    const updated = orgs.find((o) => o.id === created.id);
    expect(updated).toMatchObject({
      channelId,
      visibleTicketFields: ["feedbackTime", "project", "customerRequest"],
    });
  });

  it("clears channel and visible fields with null", async () => {
    const channels = await harness.prisma.channel.findMany();
    const channelId = channels[0]?.id;

    const created = await manager().externalOrg.create({
      name: "待清空配置机构",
      channelId,
      visibleTicketFields: ["project"],
    });

    await manager().externalOrg.update({
      id: created.id,
      channelId: null,
      visibleTicketFields: null,
    });

    const orgs = await manager().externalOrg.list();
    const updated = orgs.find((o) => o.id === created.id);
    expect(updated).toMatchObject({
      channelId: null,
      visibleTicketFields: null,
    });
  });

  it("gets a single org with its visibleTicketFields whitelist", async () => {
    const channels = await harness.prisma.channel.findMany();
    const channelId = channels[0]?.id;

    const created = await manager().externalOrg.create({
      name: "详情读取机构",
      channelId,
      visibleTicketFields: ["feedbackTime", "project"],
    });

    const org = await manager().externalOrg.get({ id: created.id });
    expect(org).toMatchObject({
      id: created.id,
      name: "详情读取机构",
      channelId,
      visibleTicketFields: ["feedbackTime", "project"],
      userCount: 0,
      active: true,
    });
    expect(org.channelName).toBeTruthy();
  });

  it("gets null visibleTicketFields when the org uses system default", async () => {
    const created = await manager().externalOrg.create({ name: "默认白名单机构" });

    const org = await manager().externalOrg.get({ id: created.id });
    expect(org.visibleTicketFields).toBeNull();
  });

  it("returns 404 for non-existent org on get", async () => {
    await expect(manager().externalOrg.get({ id: "non-existent-id" })).rejects.toThrow(
      "外部机构不存在",
    );
  });

  it("rename-only update keeps the whitelist untouched", async () => {
    const created = await manager().externalOrg.create({
      name: "改名前机构",
      visibleTicketFields: ["feedbackTime", "project", "customerRequest"],
    });

    await manager().externalOrg.update({ id: created.id, name: "改名后机构" });

    const org = await manager().externalOrg.get({ id: created.id });
    expect(org.name).toBe("改名后机构");
    expect(org.visibleTicketFields).toEqual(["feedbackTime", "project", "customerRequest"]);
  });

  it("disables and re-enables an org", async () => {
    const created = await manager().externalOrg.create({ name: "待停用机构" });

    await manager().externalOrg.setActive({ id: created.id, active: false });
    let orgs = await manager().externalOrg.list();
    let org = orgs.find((o) => o.id === created.id);
    expect(org?.active).toBe(false);

    await manager().externalOrg.setActive({ id: created.id, active: true });
    orgs = await manager().externalOrg.list();
    org = orgs.find((o) => o.id === created.id);
    expect(org?.active).toBe(true);
  });

  it("rejects update with duplicate name", async () => {
    await manager().externalOrg.create({ name: "机构X" });
    const orgY = await manager().externalOrg.create({ name: "机构Y" });

    await expect(manager().externalOrg.update({ id: orgY.id, name: "机构X" })).rejects.toThrow(
      "机构名称已存在",
    );
  });

  it("rejects update with sensitive field", async () => {
    const created = await manager().externalOrg.create({ name: "敏感字段更新测试" });

    await expect(
      manager().externalOrg.update({
        id: created.id,
        visibleTicketFields: ["project", "policyNumbers"],
      }),
    ).rejects.toThrow("policyNumbers");
  });

  it("returns 404 for non-existent org on update", async () => {
    await expect(
      manager().externalOrg.update({ id: "non-existent-id", name: "新名称" }),
    ).rejects.toThrow("外部机构不存在");
  });

  it("returns 404 for non-existent org on setActive", async () => {
    await expect(
      manager().externalOrg.setActive({ id: "non-existent-id", active: false }),
    ).rejects.toThrow("外部机构不存在");
  });

  it("counts users correctly", async () => {
    const org = await manager().externalOrg.create({ name: "用户计数测试机构" });

    let externalRole = await harness.prisma.role.findFirst({
      where: { permissions: { has: "ticket.create_external" } },
    });

    if (!externalRole) {
      externalRole = await harness.prisma.role.create({
        data: {
          name: "外部用户",
          permissions: ["ticket.create_external", "ticket.process_external"],
        },
      });
    }

    await harness.prisma.user.create({
      data: {
        username: "external-user-1",
        name: "外部用户1",
        passwordHash: "dummy",
        roleId: externalRole.id,
        externalOrgId: org.id,
        active: true,
      },
    });

    await harness.prisma.user.create({
      data: {
        username: "external-user-2",
        name: "外部用户2",
        passwordHash: "dummy",
        roleId: externalRole.id,
        externalOrgId: org.id,
        active: true,
      },
    });

    const orgs = await manager().externalOrg.list();
    const withUsers = orgs.find((o) => o.id === org.id);
    expect(withUsers?.userCount).toBe(2);
  });
});
