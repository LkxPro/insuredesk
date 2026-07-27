import { type Permission, POSITIVE_PERMISSIONS } from "@insuredesk/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedExternalUserRole } from "../prisma/seed-data";
import type { PrismaClient, Role } from "../src/generated/prisma/client";
import { type IntegrationHarness, startIntegrationHarness } from "./integration-harness";

/**
 * 外部账号开设 against a real Postgres: an 外部角色 account must carry exactly one
 * 外部机构, an internal one must carry none, and the three write doors (新建 /
 * 编辑 / 分配角色) all enforce it. 管理员 is the interesting edge — it expands to
 * every positive point, external ones included, yet is an internal account.
 */
describe("用户管理 × 外部机构 (Testcontainers)", () => {
  let harness: IntegrationHarness;
  let prisma: PrismaClient;
  let seeded: IntegrationHarness["seeded"];
  let externalRole: Role;
  let orgA: string;
  let orgB: string;

  beforeAll(async () => {
    harness = await startIntegrationHarness({ seed: ["rolesAndUsers"], traceId: "user-test" });
    prisma = harness.prisma;
    seeded = harness.seeded;
    externalRole = await seedExternalUserRole(prisma);
    orgA = (await admin().externalOrg.create({ name: "外包客服A" })).id;
    orgB = (await admin().externalOrg.create({ name: "合作伙伴B" })).id;
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  });

  const admin = () => harness.callerFor(seeded.users.admin, seeded.roles.admin);
  const callerWith = (permissions: Permission[]) =>
    harness.callerWith(seeded.users.manager, seeded.roles.csManager, permissions);

  let seq = 0;
  function accountArgs(overrides: Record<string, unknown> = {}) {
    seq += 1;
    return {
      username: `ext-account-${seq}`,
      password: "initial-pass-1",
      name: `外部成员${seq}`,
      email: null,
      team: null,
      roleId: externalRole.id,
      ...overrides,
    };
  }

  const listed = async (id: string) => (await admin().user.list()).find((user) => user.id === id);

  describe("开设外部账号", () => {
    it("外部角色 + 外部机构 creates the account and lists its org", async () => {
      const created = await admin().user.create(accountArgs({ externalOrgId: orgA }));

      expect(await listed(created.id)).toMatchObject({
        roleId: externalRole.id,
        roleName: "外部用户",
        roleExternal: true,
        externalOrgId: orgA,
        externalOrgName: "外包客服A",
        active: true,
      });
    });

    it("外部角色缺机构 → BAD_REQUEST, nothing written", async () => {
      const args = accountArgs();
      await expect(admin().user.create(args)).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "外部角色用户必须选择所属外部机构",
      });
      expect(await prisma.user.findUnique({ where: { username: args.username } })).toBeNull();
    });

    it("内部角色带机构 → BAD_REQUEST, nothing written", async () => {
      const args = accountArgs({ roleId: seeded.roles.frontline.id, externalOrgId: orgA });
      await expect(admin().user.create(args)).rejects.toMatchObject({
        code: "BAD_REQUEST",
        message: "内部角色用户不能设置所属外部机构",
      });
      expect(await prisma.user.findUnique({ where: { username: args.username } })).toBeNull();
    });

    it("管理员带机构被拒 — 系统角色的全量权限展开不使它成为外部角色", async () => {
      await expect(
        admin().user.create(accountArgs({ roleId: seeded.roles.admin.id, externalOrgId: orgA })),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("停用的机构不收新账号 → BAD_REQUEST", async () => {
      const dead = await admin().externalOrg.create({ name: "停用中的机构" });
      await admin().externalOrg.setActive({ id: dead.id, active: false });

      await expect(
        admin().user.create(accountArgs({ externalOrgId: dead.id })),
      ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "所选外部机构已停用" });
    });

    it("未知机构 id → BAD_REQUEST", async () => {
      await expect(
        admin().user.create(accountArgs({ externalOrgId: "no-such-org" })),
      ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "所选外部机构不存在" });
    });

    it("内部账号照旧不带机构", async () => {
      const created = await admin().user.create(
        accountArgs({ roleId: seeded.roles.frontline.id, externalOrgId: null }),
      );
      expect(await listed(created.id)).toMatchObject({
        roleExternal: false,
        externalOrgId: null,
        externalOrgName: null,
      });
    });
  });

  describe("编辑外部账号", () => {
    it("改机构落库,其余字段照旧可改", async () => {
      const created = await admin().user.create(accountArgs({ externalOrgId: orgA }));

      await admin().user.update({
        id: created.id,
        username: `renamed-${seq}`,
        name: "改名后",
        email: null,
        team: null,
        password: "",
        externalOrgId: orgB,
      });

      expect(await listed(created.id)).toMatchObject({
        name: "改名后",
        externalOrgId: orgB,
        externalOrgName: "合作伙伴B",
      });
    });

    it("清空外部账号的机构 → BAD_REQUEST, the old binding survives", async () => {
      const created = await admin().user.create(accountArgs({ externalOrgId: orgA }));

      await expect(
        admin().user.update({
          id: created.id,
          username: `still-${seq}`,
          name: "仍是外部",
          email: null,
          team: null,
          password: "",
          externalOrgId: null,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });

      expect(await listed(created.id)).toMatchObject({ externalOrgId: orgA });
    });

    it("机构停用后,该账号的其他字段照旧可改", async () => {
      const org = await admin().externalOrg.create({ name: "编辑期间被停用" });
      const created = await admin().user.create(accountArgs({ externalOrgId: org.id }));
      await admin().externalOrg.setActive({ id: org.id, active: false });

      await admin().user.update({
        id: created.id,
        username: `frozen-org-${seq}`,
        name: "改个名字",
        email: null,
        team: null,
        password: "",
        externalOrgId: org.id,
      });

      expect(await listed(created.id)).toMatchObject({ name: "改个名字", externalOrgId: org.id });
    });

    it("给内部账号塞机构 → BAD_REQUEST", async () => {
      const created = await admin().user.create(
        accountArgs({ roleId: seeded.roles.frontline.id, externalOrgId: null }),
      );

      await expect(
        admin().user.update({
          id: created.id,
          username: `internal-${seq}`,
          name: "内部成员",
          email: null,
          team: null,
          password: "",
          externalOrgId: orgA,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });

  describe("分配角色 带机构", () => {
    it("内部账号改派为外部角色时必须给机构,一步到位", async () => {
      const created = await admin().user.create(
        accountArgs({ roleId: seeded.roles.frontline.id, externalOrgId: null }),
      );

      await expect(
        admin().user.assignRole({ id: created.id, roleId: externalRole.id, externalOrgId: null }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });

      await admin().user.assignRole({
        id: created.id,
        roleId: externalRole.id,
        externalOrgId: orgB,
      });
      expect(await listed(created.id)).toMatchObject({
        roleExternal: true,
        externalOrgId: orgB,
      });
    });

    it("改派回内部角色清空机构", async () => {
      const created = await admin().user.create(accountArgs({ externalOrgId: orgA }));

      await admin().user.assignRole({ id: created.id, roleId: seeded.roles.frontline.id });
      expect(await listed(created.id)).toMatchObject({
        roleExternal: false,
        externalOrgId: null,
      });
    });
  });

  describe("选择器数据源", () => {
    it("roleOptions marks which roles need an 外部机构", async () => {
      const options = await admin().user.roleOptions();
      expect(options.find((role) => role.id === externalRole.id)?.external).toBe(true);
      expect(options.find((role) => role.id === seeded.roles.frontline.id)?.external).toBe(false);
      // 管理员 holds every positive point at login, yet is internal
      expect(options.find((role) => role.id === seeded.roles.admin.id)?.external).toBe(false);
    });

    it("externalOrgOptions opens to the 用户管理 points, nothing else", async () => {
      const userPoints = ["user.create", "user.edit", "user.assign_role"] as const;
      const minusAll = POSITIVE_PERMISSIONS.filter(
        (permission) => !userPoints.includes(permission as (typeof userPoints)[number]),
      );
      await expect(callerWith(minusAll).user.externalOrgOptions()).rejects.toMatchObject({
        code: "FORBIDDEN",
      });

      for (const permission of userPoints) {
        const options = await callerWith([permission]).user.externalOrgOptions();
        expect(options.map((org) => org.name)).toContain("外包客服A");
      }
    });

    it("停用的机构仍在选项里 — 已绑定的账号要看得见自己的机构", async () => {
      const created = await admin().externalOrg.create({ name: "已停用机构" });
      await admin().externalOrg.setActive({ id: created.id, active: false });

      const options = await admin().user.externalOrgOptions();
      expect(options.find((org) => org.id === created.id)).toMatchObject({ active: false });
    });
  });
});
