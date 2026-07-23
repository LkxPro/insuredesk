import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_PASSWORD } from "../prisma/seed-data";
import { parseEnv } from "../src/env";
import type { PrismaClient } from "../src/generated/prisma/client";
import { buildServer } from "../src/server";
import { type IntegrationHarness, startIntegrationHarness } from "./integration-harness";

/**
 * 自助改密 acceptance tests against a real Postgres, driven over app.inject —
 * the exact doors the browser uses. The interesting behaviors are all
 * session-layer: the changer's own session must survive while every other
 * session dies, and the restrictive point (勾选=禁止) must reject the request
 * while the 管理员 system-role expansion stays immune to it.
 */
describe("auth.changeOwnPassword (Testcontainers)", () => {
  let harness: IntegrationHarness;
  let prisma: PrismaClient;
  let app: FastifyInstance;
  let seeded: IntegrationHarness["seeded"];

  beforeAll(async () => {
    harness = await startIntegrationHarness({ seed: ["rolesAndUsers"] });
    prisma = harness.prisma;
    seeded = harness.seeded;

    app = buildServer(
      parseEnv({
        DATABASE_URL: harness.databaseUrl,
        SESSION_SECRET: "insuredesk-change-own-password-test-secret-01",
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

  const admin = () => harness.callerFor(seeded.users.admin, seeded.roles.admin);

  /** POST /api/auth/login — the real credential door. */
  function login(username: string, password: string) {
    return app.inject({ method: "POST", url: "/api/auth/login", payload: { username, password } });
  }

  /** Log in and return the session token, asserting the login succeeded. */
  async function loginToken(username: string, password: string): Promise<string> {
    const res = await login(username, password);
    expect(res.statusCode).toBe(200);
    return String(res.cookies.find((cookie) => cookie.name === "session")?.value);
  }

  /** GET /trpc/auth.me riding the given session token. */
  function me(token: string) {
    return app.inject({ method: "GET", url: "/trpc/auth.me", cookies: { session: token } });
  }

  /** POST /trpc/auth.changeOwnPassword riding the given session token. */
  function changePassword(token: string, payload: { oldPassword: string; newPassword: string }) {
    return app.inject({
      method: "POST",
      url: "/trpc/auth.changeOwnPassword",
      cookies: { session: token },
      payload,
    });
  }

  let userSeq = 0;
  /** A fresh account created through the real user.create procedure. */
  async function makeUser(overrides: { roleId?: string } = {}) {
    userSeq += 1;
    const username = `pwd-member${userSeq}`;
    const password = "initial-pass-1";
    const created = await admin().user.create({
      username,
      password,
      name: `改密成员${userSeq}`,
      email: null,
      team: null,
      roleId: overrides.roleId ?? seeded.roles.frontline.id,
    });
    return { ...created, username, password };
  }

  it("rotates the credential: other sessions die, the current one survives", async () => {
    const member = await makeUser();
    const current = await loginToken(member.username, member.password);
    const other = await loginToken(member.username, member.password);

    const res = await changePassword(current, {
      oldPassword: member.password,
      newPassword: "rotated-pass-2",
    });
    expect(res.statusCode).toBe(200);

    // 当前会话保持,其他会话立即失效——行被删除而非仅被忽略
    expect((await me(current)).statusCode).toBe(200);
    expect((await me(other)).statusCode).toBe(401);
    const remaining = await prisma.session.findMany({ where: { userId: member.id } });
    expect(remaining.map((session) => session.token)).toEqual([current]);

    // 旧凭据从下一次登录起失效,新凭据接管
    expect((await login(member.username, member.password)).statusCode).toBe(401);
    expect((await login(member.username, "rotated-pass-2")).statusCode).toBe(200);
  });

  it("wrong old password → 400 旧密码不正确, credential and sessions untouched", async () => {
    const member = await makeUser();
    const token = await loginToken(member.username, member.password);

    const res = await changePassword(token, {
      oldPassword: "not-the-password",
      newPassword: "rotated-pass-2",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.data.code).toBe("BAD_REQUEST");
    expect(res.json().error.message).toBe("旧密码不正确");

    expect((await me(token)).statusCode).toBe(200);
    expect((await login(member.username, member.password)).statusCode).toBe(200);
    expect((await login(member.username, "rotated-pass-2")).statusCode).toBe(401);
  });

  it("an account without a passwordHash is refused — no first-time set", async () => {
    const member = await makeUser();
    const token = await loginToken(member.username, member.password);
    await prisma.user.update({ where: { id: member.id }, data: { passwordHash: null } });

    const res = await changePassword(token, {
      oldPassword: member.password,
      newPassword: "rotated-pass-2",
    });
    expect(res.statusCode).toBe(412);
    expect(res.json().error.data.code).toBe("PRECONDITION_FAILED");
    expect(res.json().error.message).toBe("该账号未设置密码，无法修改密码");

    const row = await prisma.user.findUniqueOrThrow({ where: { id: member.id } });
    expect(row.passwordHash).toBeNull();
  });

  it("a role holding the restrictive point → 403, credential untouched", async () => {
    const restricted = await admin().role.create({
      name: "禁止改密组",
      permissions: ["dashboard.view", "user.forbid_change_own_password"],
    });
    const member = await makeUser({ roleId: restricted.id });
    const token = await loginToken(member.username, member.password);

    const res = await changePassword(token, {
      oldPassword: member.password,
      newPassword: "rotated-pass-2",
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.data.code).toBe("FORBIDDEN");
    expect(res.json().error.message).toBe("当前角色禁止修改自己的密码");

    expect((await login(member.username, member.password)).statusCode).toBe(200);
  });

  it("without a session → 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/trpc/auth.changeOwnPassword",
      payload: { oldPassword: "whatever-1", newPassword: "whatever-2" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("管理员 stays immune to the restrictive point (system-role expansion excludes it)", async () => {
    const token = await loginToken("admin", DEMO_PASSWORD);

    const rotate = await changePassword(token, {
      oldPassword: DEMO_PASSWORD,
      newPassword: "admin-rotated-1",
    });
    expect(rotate.statusCode).toBe(200);
    expect((await login("admin", "admin-rotated-1")).statusCode).toBe(200);

    // 换回出厂口令,避免影响同文件后续用例的 admin 登录
    const restore = await changePassword(token, {
      oldPassword: "admin-rotated-1",
      newPassword: DEMO_PASSWORD,
    });
    expect(restore.statusCode).toBe(200);
  });
});
