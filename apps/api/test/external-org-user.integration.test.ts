import { type Permission, USER_PERMISSIONS } from "@insuredesk/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedExternalUserRole } from "../prisma/seed-data";
import type { PrismaClient, Role } from "../src/generated/prisma/client";
import { appRouter } from "../src/routers/index";
import { PasswordAuthProvider, SessionService } from "../src/services/auth.service";
import { type IntegrationHarness, startIntegrationHarness } from "./integration-harness";

/**
 * 机构账号管理 against a real Postgres: every account operation on the org
 * detail page answers to the single external_org.manage point (no user.*
 * needed, and user.* alone opens nothing), and each door is fenced to
 * 外部账号 so the point never reaches internal accounts. 建号不选角色 — the sole
 * 外部角色 is looked up server-side.
 */
describe("机构账号管理 × external_org.manage (Testcontainers)", () => {
  let harness: IntegrationHarness;
  let prisma: PrismaClient;
  let seeded: IntegrationHarness["seeded"];
  let externalRole: Role;
  let orgA: string;
  let orgB: string;

  beforeAll(async () => {
    harness = await startIntegrationHarness({ seed: ["rolesAndUsers"], traceId: "org-user-test" });
    prisma = harness.prisma;
    seeded = harness.seeded;
    externalRole = await seedExternalUserRole(prisma);
    orgA = (await manager().externalOrg.create({ name: "外包客服A" })).id;
    orgB = (await manager().externalOrg.create({ name: "合作伙伴B" })).id;
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  });

  const callerWith = (permissions: Permission[]) =>
    harness.callerWith(seeded.users.manager, seeded.roles.csManager, permissions);
  // 只持 external_org.manage,一个 user.* 点都没有 — the issue's core claim.
  const manager = () => callerWith(["external_org.manage"]);

  let seq = 0;
  function accountArgs(overrides: Record<string, unknown> = {}) {
    seq += 1;
    return {
      orgId: orgA,
      username: `org-account-${seq}`,
      password: "initial-pass-1",
      name: `机构成员${seq}`,
      email: null,
      ...overrides,
    };
  }

  function updateArgs(id: string, overrides: Record<string, unknown> = {}) {
    seq += 1;
    return {
      id,
      username: `org-account-upd-${seq}`,
      name: `改名成员${seq}`,
      email: null,
      password: "",
      externalOrgId: orgA,
      ...overrides,
    };
  }

  async function createInternalUser() {
    seq += 1;
    return prisma.user.create({
      data: {
        username: `internal-${seq}`,
        name: `内部成员${seq}`,
        passwordHash: "dummy",
        roleId: seeded.roles.frontline.id,
        active: true,
      },
    });
  }

  async function seedSession(userId: string) {
    return prisma.session.create({
      data: {
        token: `session-${userId}-${++seq}`,
        userId,
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
  }

  const sessionCount = (userId: string) => prisma.session.count({ where: { userId } });

  describe("权限执法", () => {
    it("external_org.manage 独点走完账号全生命周期", async () => {
      const created = await manager().externalOrg.createUser(accountArgs());

      let rows = await manager().externalOrg.listUsers({ orgId: orgA });
      expect(rows.find((row) => row.id === created.id)).toMatchObject({ active: true });

      await manager().externalOrg.updateUser(updateArgs(created.id, { externalOrgId: orgB }));
      await manager().externalOrg.setUserActive({ id: created.id, active: false });
      await manager().externalOrg.setUserActive({ id: created.id, active: true });

      rows = await manager().externalOrg.listUsers({ orgId: orgB });
      expect(rows.find((row) => row.id === created.id)).toMatchObject({ active: true });
    });

    it("全套 user.* 点也开不了任何一扇门", async () => {
      const userAdmin = callerWith([...USER_PERMISSIONS]);
      const forbidden = { code: "FORBIDDEN" };

      await expect(userAdmin.externalOrg.listUsers({ orgId: orgA })).rejects.toMatchObject(
        forbidden,
      );
      await expect(userAdmin.externalOrg.createUser(accountArgs())).rejects.toMatchObject(
        forbidden,
      );
      await expect(userAdmin.externalOrg.updateUser(updateArgs("any"))).rejects.toMatchObject(
        forbidden,
      );
      await expect(
        userAdmin.externalOrg.setUserActive({ id: "any", active: false }),
      ).rejects.toMatchObject(forbidden);
    });
  });

  describe("新建机构账号", () => {
    it("锁定所给机构,自动挂唯一外部角色,团队恒空", async () => {
      const created = await manager().externalOrg.createUser(accountArgs());

      const row = await prisma.user.findUniqueOrThrow({ where: { id: created.id } });
      expect(row).toMatchObject({ externalOrgId: orgA, roleId: externalRole.id, team: null });
    });

    it("外部角色不止一个 → PRECONDITION_FAILED, nothing written", async () => {
      const extra = await prisma.role.create({
        data: { name: "外部只读", permissions: ["ticket.process_external"] },
      });
      const args = accountArgs();
      try {
        await expect(manager().externalOrg.createUser(args)).rejects.toMatchObject({
          code: "PRECONDITION_FAILED",
          message: "外部角色应恰好有 1 个，当前 2 个，无法创建机构账号",
        });
        expect(await prisma.user.findUnique({ where: { username: args.username } })).toBeNull();
      } finally {
        await prisma.role.delete({ where: { id: extra.id } });
      }
    });

    it("外部角色为零 → PRECONDITION_FAILED", async () => {
      const kept = externalRole.permissions;
      await prisma.role.update({ where: { id: externalRole.id }, data: { permissions: [] } });
      try {
        await expect(manager().externalOrg.createUser(accountArgs())).rejects.toMatchObject({
          code: "PRECONDITION_FAILED",
          message: "外部角色应恰好有 1 个，当前 0 个，无法创建机构账号",
        });
      } finally {
        await prisma.role.update({
          where: { id: externalRole.id },
          data: { permissions: kept },
        });
      }
    });

    it("停用机构不收新账号", async () => {
      const dead = await manager().externalOrg.create({ name: "停用中的机构" });
      await manager().externalOrg.setActive({ id: dead.id, active: false });

      await expect(
        manager().externalOrg.createUser(accountArgs({ orgId: dead.id })),
      ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "所选外部机构已停用" });
    });

    it("重复用户名 → CONFLICT", async () => {
      const args = accountArgs();
      await manager().externalOrg.createUser(args);
      await expect(
        manager().externalOrg.createUser(accountArgs({ username: args.username })),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });
  });

  describe("账号表", () => {
    it("只列本机构账号", async () => {
      const org = (await manager().externalOrg.create({ name: "隔离清单机构" })).id;
      const mine = await manager().externalOrg.createUser(accountArgs({ orgId: org }));
      await manager().externalOrg.createUser(accountArgs({ orgId: orgA }));

      const rows = await manager().externalOrg.listUsers({ orgId: org });
      expect(rows.map((row) => row.id)).toEqual([mine.id]);
    });

    it("未知机构 → NOT_FOUND", async () => {
      await expect(manager().externalOrg.listUsers({ orgId: "no-such-org" })).rejects.toMatchObject(
        { code: "NOT_FOUND", message: "外部机构不存在" },
      );
    });
  });

  describe("编辑机构账号", () => {
    it("迁移到其他启用机构", async () => {
      const created = await manager().externalOrg.createUser(accountArgs());

      await manager().externalOrg.updateUser(updateArgs(created.id, { externalOrgId: orgB }));

      const row = await prisma.user.findUniqueOrThrow({ where: { id: created.id } });
      expect(row.externalOrgId).toBe(orgB);
    });

    it("停用机构不可作为新迁入目标,保持原值可以", async () => {
      const frozen = (await manager().externalOrg.create({ name: "冻结迁入机构" })).id;
      const created = await manager().externalOrg.createUser(accountArgs({ orgId: frozen }));
      const outsider = await manager().externalOrg.createUser(accountArgs({ orgId: orgA }));
      await manager().externalOrg.setActive({ id: frozen, active: false });

      // 已绑定停用机构的账号照旧可改其他字段
      await manager().externalOrg.updateUser(updateArgs(created.id, { externalOrgId: frozen }));
      // 别的账号不能迁入
      await expect(
        manager().externalOrg.updateUser(updateArgs(outsider.id, { externalOrgId: frozen })),
      ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "所选外部机构已停用" });
    });

    it("内部账号不是这扇门的对象", async () => {
      const internal = await createInternalUser();
      await expect(manager().externalOrg.updateUser(updateArgs(internal.id))).rejects.toMatchObject(
        { code: "BAD_REQUEST", message: "该用户不是外部机构账号" },
      );
    });

    it("重置密码即刻踢掉在线会话", async () => {
      const created = await manager().externalOrg.createUser(accountArgs());
      const bystander = await manager().externalOrg.createUser(accountArgs());
      await seedSession(created.id);
      await seedSession(bystander.id);

      await manager().externalOrg.updateUser(
        updateArgs(created.id, { password: "rotated-pass-1" }),
      );

      expect(await sessionCount(created.id)).toBe(0);
      expect(await sessionCount(bystander.id)).toBe(1);
    });
  });

  describe("禁用/启用", () => {
    it("禁用即刻踢掉在线会话,可再启用", async () => {
      const created = await manager().externalOrg.createUser(accountArgs());
      await seedSession(created.id);

      await manager().externalOrg.setUserActive({ id: created.id, active: false });
      expect(await sessionCount(created.id)).toBe(0);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: created.id } })).active).toBe(
        false,
      );

      await manager().externalOrg.setUserActive({ id: created.id, active: true });
      expect((await prisma.user.findUniqueOrThrow({ where: { id: created.id } })).active).toBe(
        true,
      );
    });

    it("内部账号不是这扇门的对象", async () => {
      const internal = await createInternalUser();
      await expect(
        manager().externalOrg.setUserActive({ id: internal.id, active: false }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "该用户不是外部机构账号" });
    });
  });

  describe("建出来的账号自带外部能力", () => {
    it("按初始密码登录,提交外部工单并留言", async () => {
      const args = accountArgs();
      await manager().externalOrg.createUser(args);

      const userId = await new PasswordAuthProvider(prisma).authenticate({
        username: args.username,
        password: args.password,
      });
      expect(userId).not.toBeNull();

      const sessions = new SessionService(prisma, 3600);
      const identity = await sessions.validateSession(await sessions.createSession(userId ?? ""));
      // 权限走登录展开,而非测试自选的权限集 — 这正是"建号即可用"的验收点
      const asAccount = appRouter.createCaller({
        traceId: "org-user-test",
        user: identity,
        sessionToken: null,
      });

      const ticket = await asAccount.externalTicket.submit({ submissionText: "机构侧反馈一条" });
      await asAccount.externalTicket.addNote({ ticketId: ticket.id, content: "补充说明" });

      const detail = await asAccount.externalTicket.detail({ ticketId: ticket.id });
      expect(detail.ticket.workOrderNumber).toBe(ticket.workOrderNumber);
      expect(detail.processLogs.some((log) => log.remark === "补充说明")).toBe(true);

      const row = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
      expect(row.externalOrgId).toBe(orgA);
    });
  });
});
