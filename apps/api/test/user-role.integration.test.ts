import { ALL_PERMISSIONS, type Permission, POSITIVE_PERMISSIONS } from "@insuredesk/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_PASSWORD } from "../prisma/seed-data";
import { parseEnv } from "../src/env";
import type { PrismaClient, User } from "../src/generated/prisma/client";
import { appRouter } from "../src/routers/index";
import { buildServer } from "../src/server";
import { type AuthenticatedUser, effectivePermissions } from "../src/services/auth.service";
import { type IntegrationHarness, startIntegrationHarness } from "./integration-harness";

/**
 * 用户与角色管理 acceptance tests against a real Postgres: 用户管理 (create /
 * edit / 禁用-启用 / 分配角色), 角色管理 (roles against the 权限点清单, the
 * 管理员-only system-role lock), and the session-layer guarantees — a disabled
 * user can neither log in again nor ride an existing session, and
 * role/permission changes bind from the very next request.
 *
 * Two surfaces on purpose: RBAC 逐项校验 runs through createCaller with
 * surgically-chosen permission sets (impossible to arrange via real roles
 * without drowning in setup), while login/session-lifecycle cases drive the
 * real Fastify app over app.inject — the exact doors the browser uses.
 */
describe("user + role management (Testcontainers)", () => {
  let harness: IntegrationHarness;
  let prisma: PrismaClient;
  let app: FastifyInstance;
  let seeded: IntegrationHarness["seeded"];
  const demoPassword = DEMO_PASSWORD;

  beforeAll(async () => {
    harness = await startIntegrationHarness({ seed: ["rolesAndUsers"] });
    prisma = harness.prisma;
    seeded = harness.seeded;
    const databaseUrl = harness.databaseUrl;

    app = buildServer(
      parseEnv({
        DATABASE_URL: databaseUrl,
        SESSION_SECRET: "insuredesk-user-role-test-secret-0123456789",
        NODE_ENV: "test",
        LOG_LEVEL: "silent",
      }),
    );
    await app.ready();
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await harness?.stop();
  });

  function identityOf(user: User, roleName: string, permissions: Permission[]): AuthenticatedUser {
    return {
      id: user.id,
      username: user.username,
      name: user.name,
      email: user.email,
      team: user.team,
      roleId: "role-under-test",
      roleName,
      permissions,
      requiredTicketFields: [],
    };
  }

  /** Caller with the given user identity and an explicit permission set. */
  function callerWith(user: User, roleName: string, permissions: Permission[]) {
    return appRouter.createCaller({
      traceId: "user-role-test",
      user: identityOf(user, roleName, permissions),
      sessionToken: null,
    });
  }

  const admin = () =>
    callerWith(seeded.users.admin, "管理员", effectivePermissions(seeded.roles.admin));

  /** POST /api/auth/login — the real credential door. */
  function login(username: string, password: string) {
    return app.inject({ method: "POST", url: "/api/auth/login", payload: { username, password } });
  }

  function sessionCookie(res: { cookies: Array<Record<string, unknown>> }) {
    return res.cookies.find((cookie) => cookie.name === "session");
  }

  /** Log in and return the session token, asserting the login succeeded. */
  async function loginToken(username: string, password: string): Promise<string> {
    const res = await login(username, password);
    expect(res.statusCode).toBe(200);
    return String(sessionCookie(res)?.value);
  }

  /** GET /trpc/auth.me riding the given session token. */
  function me(token: string) {
    return app.inject({ method: "GET", url: "/trpc/auth.me", cookies: { session: token } });
  }

  function query(path: string, token: string) {
    return app.inject({ method: "GET", url: `/trpc/${path}`, cookies: { session: token } });
  }

  let userSeq = 0;
  /** A fresh account created through the real user.create procedure. */
  async function makeUser(overrides: { roleId?: string; password?: string } = {}) {
    userSeq += 1;
    const username = `member${userSeq}`;
    const created = await admin().user.create({
      username,
      password: overrides.password ?? "initial-pass-1",
      name: `成员${userSeq}`,
      email: null,
      team: null,
      roleId: overrides.roleId ?? seeded.roles.frontline.id,
    });
    return { ...created, username, password: overrides.password ?? "initial-pass-1" };
  }

  describe("用户管理 CRUD", () => {
    it("creates an account that shows in the list and can log in", async () => {
      const created = await admin().user.create({
        username: "newbie",
        password: "secret-123",
        name: "王新人",
        email: "newbie@insuredesk.local",
        team: "客服一组",
        roleId: seeded.roles.frontline.id,
      });

      const listed = (await admin().user.list()).find((user) => user.id === created.id);
      expect(listed).toMatchObject({
        username: "newbie",
        name: "王新人",
        email: "newbie@insuredesk.local",
        team: "客服一组",
        active: true,
        roleId: seeded.roles.frontline.id,
        roleName: "一线客服",
        roleSystem: false,
      });

      expect((await login("newbie", "secret-123")).statusCode).toBe(200);
      // The stored credential is a hash, never the plaintext
      const row = await prisma.user.findUniqueOrThrow({ where: { id: created.id } });
      expect(row.passwordHash).not.toContain("secret-123");
    });

    it("rejects duplicate username/email and unknown roles", async () => {
      await expect(
        admin().user.create({
          username: "admin", // seeded
          password: "secret-123",
          name: "重名",
          email: null,
          team: null,
          roleId: seeded.roles.frontline.id,
        }),
      ).rejects.toMatchObject({ code: "CONFLICT", message: "用户名已存在" });

      await expect(
        admin().user.create({
          username: "email-clash",
          password: "secret-123",
          name: "撞邮箱",
          email: "admin@insuredesk.local", // seeded admin's email
          team: null,
          roleId: seeded.roles.frontline.id,
        }),
      ).rejects.toMatchObject({ code: "CONFLICT", message: "邮箱已被其他用户使用" });

      await expect(
        admin().user.create({
          username: "role-less",
          password: "secret-123",
          name: "无角色",
          email: null,
          team: null,
          roleId: "no-such-role",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "所选角色不存在" });
    });

    it("edits basic info; an empty password keeps the old credential, a new one replaces it", async () => {
      const member = await makeUser();

      await admin().user.update({
        id: member.id,
        name: "改名后",
        email: "renamed@insuredesk.local",
        team: "客服二组",
        password: null,
      });

      const listed = (await admin().user.list()).find((user) => user.id === member.id);
      expect(listed).toMatchObject({
        name: "改名后",
        email: "renamed@insuredesk.local",
        team: "客服二组",
      });
      // No password in the payload → the original still logs in
      expect((await login(member.username, member.password)).statusCode).toBe(200);

      await admin().user.update({
        id: member.id,
        name: "改名后",
        email: "renamed@insuredesk.local",
        team: "客服二组",
        password: "rotated-456",
      });
      expect((await login(member.username, member.password)).statusCode).toBe(401);
      expect((await login(member.username, "rotated-456")).statusCode).toBe(200);
    });

    it("a password reset kills the target's live sessions; a no-password edit leaves them alone", async () => {
      const member = await makeUser();
      const tokens = [
        await loginToken(member.username, member.password),
        await loginToken(member.username, member.password),
      ];

      // 仅改基础字段:两个会话都继续有效
      await admin().user.update({
        id: member.id,
        name: "改资料",
        email: null,
        team: null,
        password: null,
      });
      for (const token of tokens) {
        expect((await me(token)).statusCode).toBe(200);
      }

      // 重置密码:全部会话立即失效,行被删除而非仅被忽略
      await admin().user.update({
        id: member.id,
        name: "改资料",
        email: null,
        team: null,
        password: "rotated-789",
      });
      for (const token of tokens) {
        expect((await me(token)).statusCode).toBe(401);
      }
      expect(await prisma.session.count({ where: { userId: member.id } })).toBe(0);

      // 新凭据重新登录不受影响
      expect((await login(member.username, "rotated-789")).statusCode).toBe(200);
    });

    it("update/setActive/assignRole on unknown users → NOT_FOUND", async () => {
      await expect(
        admin().user.update({
          id: "no-such-user",
          name: "无人",
          email: null,
          team: null,
          password: null,
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        admin().user.setActive({ id: "no-such-user", active: false }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        admin().user.assignRole({ id: "no-such-user", roleId: seeded.roles.frontline.id }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  describe("禁用/启用 (acceptance: 禁用用户不可再登录，已有会话的下一次请求被拒)", () => {
    it("disabling blocks new logins AND kills the live session; re-enabling restores login", async () => {
      const member = await makeUser();
      const token = await loginToken(member.username, member.password);
      expect((await me(token)).statusCode).toBe(200);

      await admin().user.setActive({ id: member.id, active: false });

      // New login refused outright
      expect((await login(member.username, member.password)).statusCode).toBe(401);
      // The pre-existing session is rejected on its very next request
      expect((await me(token)).statusCode).toBe(401);
      // ...and its rows are gone, not merely ignored
      expect(await prisma.session.count({ where: { userId: member.id } })).toBe(0);

      await admin().user.setActive({ id: member.id, active: true });
      expect((await login(member.username, member.password)).statusCode).toBe(200);
    });

    it("refuses to disable your own account", async () => {
      await expect(
        admin().user.setActive({ id: seeded.users.admin.id, active: false }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "不能禁用自己的账号" });
    });
  });

  describe("分配角色 + 角色权限变更即时生效 (acceptance: 下次请求按新权限判定)", () => {
    it("a role reassignment binds on the target's next request, same session", async () => {
      const member = await makeUser(); // 一线客服: no schedule.manage_shifts
      const token = await loginToken(member.username, member.password);

      const before = await query("shiftType.list", token);
      expect(before.statusCode).toBe(403);

      const shiftMaintainer = await admin().role.create({
        name: "班次维护员",
        permissions: ["schedule.manage_shifts"],
      });
      await admin().user.assignRole({ id: member.id, roleId: shiftMaintainer.id });

      const identity = await me(token);
      expect(identity.json().result.data.roleName).toBe("班次维护员");
      const after = await query("shiftType.list", token);
      expect(after.statusCode).toBe(200);
    });

    it("granting and revoking a permission point flips the guard for live sessions", async () => {
      const role = await admin().role.create({ name: "权限流转组", permissions: ["ticket.view"] });
      const member = await makeUser({ roleId: role.id });
      const token = await loginToken(member.username, member.password);

      const denied = await query("shiftType.list", token);
      expect(denied.statusCode).toBe(403);

      await admin().role.updatePermissions({
        id: role.id,
        permissions: ["ticket.view", "schedule.manage_shifts"],
      });
      const granted = await query("shiftType.list", token);
      expect(granted.statusCode).toBe(200);

      await admin().role.updatePermissions({ id: role.id, permissions: ["ticket.view"] });
      const revoked = await query("shiftType.list", token);
      expect(revoked.statusCode).toBe(403);
    });
  });

  describe("角色管理 CRUD", () => {
    it("creates a custom role from the 权限点清单, lists it with holder counts", async () => {
      const created = await admin().role.create({
        name: "质检专员",
        permissions: ["ticket.view", "ticket.view_all", "dashboard.view"],
      });

      const listed = (await admin().role.list()).find((role) => role.id === created.id);
      expect(listed).toMatchObject({
        name: "质检专员",
        system: false,
        userCount: 0,
        permissions: ["ticket.view", "ticket.view_all", "dashboard.view"],
        requiredTicketFields: [],
      });

      // 管理员 is the one and only system role; the factory roles are ordinary
      const list = await admin().role.list();
      expect(list.filter((role) => role.system).map((role) => role.name)).toEqual(["管理员"]);
      expect(list.map((role) => role.name)).toEqual(
        expect.arrayContaining(["一线客服", "只读观察", "客服主管"]),
      );
    });

    it("rejects duplicate names and unknown permission points", async () => {
      await expect(admin().role.create({ name: "管理员", permissions: [] })).rejects.toMatchObject({
        code: "CONFLICT",
        message: "角色名称已存在",
      });

      await expect(
        admin().role.create({
          name: "越权组",
          // biome-ignore lint/suspicious/noExplicitAny: deliberately malformed input
          permissions: ["ticket.self_destruct" as any],
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("renames a custom role and collapses duplicate permission ticks", async () => {
      const role = await admin().role.create({ name: "临时组", permissions: [] });

      await admin().role.rename({ id: role.id, name: "长期组" });
      await expect(admin().role.rename({ id: role.id, name: "管理员" })).rejects.toMatchObject({
        code: "CONFLICT",
      });

      await admin().role.updatePermissions({
        id: role.id,
        permissions: ["ticket.view", "ticket.view", "ticket.view"],
      });
      const listed = (await admin().role.list()).find((entry) => entry.id === role.id);
      expect(listed).toMatchObject({ name: "长期组", permissions: ["ticket.view"] });
    });

    it("a role with holders refuses deletion until they are reassigned", async () => {
      const role = await admin().role.create({ name: "待裁撤组", permissions: ["ticket.view"] });
      const member = await makeUser({ roleId: role.id });

      await expect(admin().role.delete({ id: role.id })).rejects.toMatchObject({
        code: "CONFLICT",
        message: expect.stringContaining("仍有 1 个用户"),
      });

      await admin().user.assignRole({ id: member.id, roleId: seeded.roles.frontline.id });
      await admin().role.delete({ id: role.id });
      expect((await admin().role.list()).find((entry) => entry.id === role.id)).toBeUndefined();

      await expect(admin().role.delete({ id: role.id })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  describe("系统角色锁 (acceptance: 管理员全锁,出厂角色与手建角色无差别)", () => {
    it("管理员 refuses rename, permission edits, and deletion", async () => {
      const role = seeded.roles.admin;
      await expect(admin().role.delete({ id: role.id })).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: expect.stringContaining("系统角色"),
      });
      await expect(admin().role.rename({ id: role.id, name: "超级管理员" })).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      await expect(
        admin().role.updatePermissions({ id: role.id, permissions: [] }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

      // Untouched by the attempts above
      const row = await prisma.role.findUniqueOrThrow({ where: { name: "管理员" } });
      expect(row.permissions).toEqual(seeded.roles.admin.permissions);
    });

    it("factory roles rename and re-permission like any hand-made role", async () => {
      const role = seeded.roles.csManager;

      await admin().role.rename({ id: role.id, name: "客服组长" });
      await admin().role.updatePermissions({
        id: role.id,
        permissions: [...(role.permissions as Permission[]), "sla.view"],
      });

      const listed = (await admin().role.list()).find((entry) => entry.id === role.id);
      expect(listed).toMatchObject({ name: "客服组长", system: false });
      expect(listed?.permissions).toContain("sla.view");

      // Put the fixture back for the RBAC cases below
      await admin().role.rename({ id: role.id, name: role.name });
      await admin().role.updatePermissions({
        id: role.id,
        permissions: role.permissions as Permission[],
      });
    });

    it("an unused factory role deletes for good", async () => {
      await admin().user.assignRole({
        id: seeded.users.observer.id,
        roleId: seeded.roles.frontline.id,
      });

      await admin().role.delete({ id: seeded.roles.readOnly.id });

      const list = await admin().role.list();
      expect(list.find((entry) => entry.id === seeded.roles.readOnly.id)).toBeUndefined();
    });
  });

  describe("RBAC 逐项校验 (acceptance: 每个操作只认自己的权限点)", () => {
    /**
     * Each case runs twice: holding every permission EXCEPT the required one
     * (a full keyring minus the right key must still be FORBIDDEN), and
     * holding ONLY the required one (the guard opens; the call then hits a
     * deliberate non-FORBIDDEN domain error so no state is written).
     */
    const cases: Array<{
      route: string;
      permission: Permission;
      run: (caller: ReturnType<typeof callerWith>) => Promise<unknown>;
      passedGuardCode: string | null; // null = succeeds outright
    }> = [
      {
        route: "user.list",
        permission: "user.view",
        run: (caller) => caller.user.list(),
        passedGuardCode: null,
      },
      {
        route: "user.create",
        permission: "user.create",
        run: (caller) =>
          caller.user.create({
            username: "rbac-probe",
            password: "secret-123",
            name: "探针",
            email: null,
            team: null,
            roleId: "no-such-role",
          }),
        passedGuardCode: "BAD_REQUEST",
      },
      {
        route: "user.update",
        permission: "user.edit",
        run: (caller) =>
          caller.user.update({
            id: "no-such-user",
            name: "探针",
            email: null,
            team: null,
            password: null,
          }),
        passedGuardCode: "NOT_FOUND",
      },
      {
        route: "user.setActive",
        permission: "user.delete",
        run: (caller) => caller.user.setActive({ id: "no-such-user", active: false }),
        passedGuardCode: "NOT_FOUND",
      },
      {
        route: "user.assignRole",
        permission: "user.assign_role",
        run: (caller) => caller.user.assignRole({ id: "no-such-user", roleId: "no-such-role" }),
        passedGuardCode: "BAD_REQUEST",
      },
      {
        route: "role.list",
        permission: "role.view",
        run: (caller) => caller.role.list(),
        passedGuardCode: null,
      },
      {
        route: "role.create",
        permission: "role.create",
        run: (caller) => caller.role.create({ name: "管理员", permissions: [] }),
        passedGuardCode: "CONFLICT",
      },
      {
        route: "role.rename",
        permission: "role.edit",
        run: (caller) => caller.role.rename({ id: "no-such-role", name: "探针" }),
        passedGuardCode: "NOT_FOUND",
      },
      {
        route: "role.updatePermissions",
        permission: "role.edit_permission",
        run: (caller) => caller.role.updatePermissions({ id: "no-such-role", permissions: [] }),
        passedGuardCode: "NOT_FOUND",
      },
      {
        route: "role.delete",
        permission: "role.delete",
        run: (caller) => caller.role.delete({ id: "no-such-role" }),
        passedGuardCode: "NOT_FOUND",
      },
    ];

    it.each(cases)("$route requires exactly $permission", async (testCase) => {
      const allButRequired = ALL_PERMISSIONS.filter(
        (permission) => permission !== testCase.permission,
      );
      await expect(
        testCase.run(callerWith(seeded.users.manager, "缺一把钥匙", allButRequired)),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      const onlyRequired = callerWith(seeded.users.manager, "只有一把钥匙", [testCase.permission]);
      if (testCase.passedGuardCode === null) {
        await expect(testCase.run(onlyRequired)).resolves.toBeDefined();
      } else {
        await expect(testCase.run(onlyRequired)).rejects.toMatchObject({
          code: testCase.passedGuardCode,
        });
      }
    });

    it("user.roleOptions opens to user.create OR user.assign_role, nothing else", async () => {
      const minusBoth = ALL_PERMISSIONS.filter(
        (permission) => permission !== "user.create" && permission !== "user.assign_role",
      );
      await expect(
        callerWith(seeded.users.manager, "两把都缺", minusBoth).user.roleOptions(),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      for (const permission of ["user.create", "user.assign_role"] as const) {
        const options = await callerWith(seeded.users.manager, "单钥匙", [
          permission,
        ]).user.roleOptions();
        expect(options.length).toBeGreaterThanOrEqual(4);
        // Picker payload stays lean — the permission matrix needs role.view
        expect(options[0]).not.toHaveProperty("permissions");
      }
    });
  });

  describe("管理员动态全量权限 (acceptance: 权限不读库,恒为当前代码的全量正向权限点,排除限制类)", () => {
    it("清空管理员角色库中的权限数组后,登录仍拥有全部正向权限", async () => {
      await prisma.role.update({
        where: { id: seeded.roles.admin.id },
        data: { permissions: [] },
      });

      const token = await loginToken("admin", demoPassword);
      const identity = (await me(token)).json().result.data;
      expect([...identity.permissions].sort()).toEqual([...POSITIVE_PERMISSIONS].sort());

      // 后端守卫与前端菜单同源(auth.me),这里再验一次真实守卫端点
      const guarded = await query("shiftType.list", token);
      expect(guarded.statusCode).toBe(200);
    });

    it("角色页对管理员显示全量正向权限,而非库中快照", async () => {
      await prisma.role.update({
        where: { id: seeded.roles.admin.id },
        data: { permissions: [] },
      });

      const listed = (await admin().role.list()).find((role) => role.system);
      expect(listed?.permissions).toEqual([...POSITIVE_PERMISSIONS]);
    });
  });

  describe("最后管理员不变量 (acceptance: 始终至少一个启用状态的管理员用户)", () => {
    /** A non-admin operator holding exactly the points these mutations need. */
    const operator = () =>
      callerWith(seeded.users.manager, "运维操作员", ["user.delete", "user.assign_role"]);

    it("禁用最后一个启用的管理员被拒绝,提示明确", async () => {
      await expect(
        operator().user.setActive({ id: seeded.users.admin.id, active: false }),
      ).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: "系统必须至少保留一名启用的管理员",
      });

      // 拒绝即回滚:账号仍处于启用状态
      const row = await prisma.user.findUniqueOrThrow({ where: { id: seeded.users.admin.id } });
      expect(row.active).toBe(true);
    });

    it("把最后一个启用管理员的角色改派为其他角色被拒绝", async () => {
      // 管理员改派自己的角色本身是被允许的委托 — 拦下它的只能是不变量
      await expect(
        admin().user.assignRole({ id: seeded.users.admin.id, roleId: seeded.roles.frontline.id }),
      ).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
        message: "系统必须至少保留一名启用的管理员",
      });

      const row = await prisma.user.findUniqueOrThrow({ where: { id: seeded.users.admin.id } });
      expect(row.roleId).toBe(seeded.roles.admin.id);
    });

    it("存在第二个启用管理员时,禁用/改派正常放行;禁用状态的管理员不计数", async () => {
      const backup = await makeUser({ roleId: seeded.roles.admin.id });

      // 第二个管理员被禁用时不顶数,原管理员仍是"最后一个"
      await operator().user.setActive({ id: backup.id, active: false });
      await expect(
        operator().user.setActive({ id: seeded.users.admin.id, active: false }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

      // 启用后放行
      await operator().user.setActive({ id: backup.id, active: true });
      const disabled = await operator().user.setActive({
        id: seeded.users.admin.id,
        active: false,
      });
      expect(disabled.active).toBe(false);

      // 此刻 backup 是最后一个启用管理员,双向保护立即换防
      await expect(
        operator().user.setActive({ id: backup.id, active: false }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      await expect(
        admin().user.assignRole({ id: backup.id, roleId: seeded.roles.frontline.id }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

      // 改派禁用中的管理员不减少启用管理员数,不受不变量约束
      await admin().user.assignRole({
        id: seeded.users.admin.id,
        roleId: seeded.roles.frontline.id,
      });

      // 恢复现场:原管理员归位,backup 退回普通角色
      await admin().user.assignRole({ id: seeded.users.admin.id, roleId: seeded.roles.admin.id });
      await operator().user.setActive({ id: seeded.users.admin.id, active: true });
      await admin().user.assignRole({ id: backup.id, roleId: seeded.roles.frontline.id });
    });

    it("并发禁用仅剩的两个启用管理员,恰好放行一个", async () => {
      const backup = await makeUser({ roleId: seeded.roles.admin.id });

      // 两个事务各写不同的行,只有对不变量的串行化清点能拦住后到者
      const results = await Promise.allSettled([
        operator().user.setActive({ id: seeded.users.admin.id, active: false }),
        operator().user.setActive({ id: backup.id, active: false }),
      ]);

      expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
      const enabledAdmins = await prisma.user.count({
        where: { active: true, role: { system: true } },
      });
      expect(enabledAdmins).toBe(1);

      // 恢复现场
      await prisma.user.update({ where: { id: seeded.users.admin.id }, data: { active: true } });
      await prisma.user.update({
        where: { id: backup.id },
        data: { active: true, roleId: seeded.roles.frontline.id },
      });
    });
  });
});
