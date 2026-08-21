import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedExternalUserRole } from "../prisma/seed-data.ts";
import type { PrismaClient, Role } from "../src/generated/prisma/client.ts";
import { type IntegrationHarness, startIntegrationHarness } from "./integration-harness.ts";

/**
 * 用户管理 × 外部账号 against a real Postgres: 用户管理 is an 内部账号-only surface.
 * The list hides 外部账号, the role picker hides 外部角色, and all four write
 * doors refuse an 外部账号 as target or an 外部角色 as payload — an account's
 * 内外性质 is fixed at birth, so no door here crosses the line.
 */
describe("用户管理 × 外部账号 (Testcontainers)", () => {
  let harness: IntegrationHarness;
  let prisma: PrismaClient;
  let seeded: IntegrationHarness["seeded"];
  let externalRole: Role;

  beforeAll(async () => {
    harness = await startIntegrationHarness({ seed: ["rolesAndUsers"], traceId: "user-test" });
    prisma = harness.prisma;
    seeded = harness.seeded;
    externalRole = await seedExternalUserRole(prisma);
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  });

  const admin = () => harness.callerFor(seeded.users.admin, seeded.roles.admin);

  let seq = 0;
  function internalArgs(overrides: Record<string, unknown> = {}) {
    seq += 1;
    return {
      username: `internal-account-${seq}`,
      password: "initial-pass-1",
      name: `内部成员${seq}`,
      email: null,
      team: null,
      roleId: seeded.roles.frontline.id,
      ...overrides,
    };
  }

  /** An 外部账号 created through its own door — 外部账号管理. */
  async function createExternalAccount() {
    seq += 1;
    return admin().externalAccount.create({
      username: `ext-account-${seq}`,
      password: "initial-pass-1",
      name: `外部成员${seq}`,
      email: null,
    });
  }

  const listed = async (id: string) => (await admin().user.list()).find((user) => user.id === id);

  describe("列表只含内部账号", () => {
    it("外部账号不在 user.list 里,内部账号照旧在", async () => {
      const external = await createExternalAccount();
      const internal = await admin().user.create(internalArgs());

      expect(await listed(external.id)).toBeUndefined();
      expect(await listed(internal.id)).toMatchObject({
        roleId: seeded.roles.frontline.id,
        active: true,
      });
    });

    it("禁用的外部账号同样不出现 — 过滤看的是角色判定,不是启用状态", async () => {
      const external = await createExternalAccount();
      await admin().externalAccount.setActive({ id: external.id, active: false });

      expect(await listed(external.id)).toBeUndefined();
    });
  });

  describe("新增用户只发内部角色", () => {
    it("外部角色 → BAD_REQUEST, nothing written", async () => {
      const args = internalArgs({ roleId: externalRole.id });
      await expect(admin().user.create(args)).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "只能选择内部角色",
      });
      expect(await prisma.user.findUnique({ where: { username: args.username } })).toBeNull();
    });

    it("管理员角色照旧可发 — 系统角色的全量权限展开不使它成为外部角色", async () => {
      const created = await admin().user.create(internalArgs({ roleId: seeded.roles.admin.id }));
      expect(await listed(created.id)).toMatchObject({ roleSystem: true });
    });

    it("内部账号预填恒空", async () => {
      const created = await admin().user.create(internalArgs());
      const row = await prisma.user.findUniqueOrThrow({ where: { id: created.id } });
      expect(row).toMatchObject({
        prefillChannelId: null,
        prefillProject: null,
        prefillBrokerageEntity: null,
        prefillPaymentChannel: null,
        prefillUserFeedbackChannelId: null,
        prefillFeedbackReceiveChannelId: null,
      });
    });
  });

  describe("外部账号不是这些门的对象", () => {
    it("编辑 → BAD_REQUEST, 原值不动", async () => {
      const external = await createExternalAccount();
      const before = await prisma.user.findUniqueOrThrow({ where: { id: external.id } });

      await expect(
        admin().user.update({
          id: external.id,
          username: `hijacked-${++seq}`,
          name: "改名企图",
          email: null,
          team: null,
          password: "",
        }),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "外部账号请在外部账号管理页管理",
      });

      expect(await prisma.user.findUniqueOrThrow({ where: { id: external.id } })).toMatchObject({
        username: before.username,
        name: before.name,
      });
    });

    it("禁用 → BAD_REQUEST, 仍是启用状态", async () => {
      const external = await createExternalAccount();

      await expect(
        admin().user.setActive({ id: external.id, active: false }),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "外部账号请在外部账号管理页管理",
      });

      expect((await prisma.user.findUniqueOrThrow({ where: { id: external.id } })).active).toBe(
        true,
      );
    });

    it("分配角色 → BAD_REQUEST, 角色不动", async () => {
      const external = await createExternalAccount();

      await expect(
        admin().user.assignRole({ id: external.id, roleId: seeded.roles.frontline.id }),
      ).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "外部账号请在外部账号管理页管理",
      });

      expect(await prisma.user.findUniqueOrThrow({ where: { id: external.id } })).toMatchObject({
        roleId: externalRole.id,
      });
    });
  });

  describe("分配角色只在内部角色间互换", () => {
    it("把内部账号改派为外部角色 → BAD_REQUEST", async () => {
      const created = await admin().user.create(internalArgs());

      await expect(
        admin().user.assignRole({ id: created.id, roleId: externalRole.id }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "只能选择内部角色" });

      expect(await prisma.user.findUniqueOrThrow({ where: { id: created.id } })).toMatchObject({
        roleId: seeded.roles.frontline.id,
      });
    });

    it("内部角色之间互换照旧放行", async () => {
      const created = await admin().user.create(internalArgs());

      await admin().user.assignRole({ id: created.id, roleId: seeded.roles.csManager.id });
      expect(await listed(created.id)).toMatchObject({ roleId: seeded.roles.csManager.id });
    });
  });

  describe("角色下拉", () => {
    it("roleOptions 不列外部角色", async () => {
      const options = await admin().user.roleOptions();
      const ids = options.map((role) => role.id);
      expect(ids).not.toContain(externalRole.id);
      expect(ids).toContain(seeded.roles.frontline.id);
      // 管理员 holds every positive point at login, yet is internal
      expect(ids).toContain(seeded.roles.admin.id);
    });
  });
});
