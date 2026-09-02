import { createHash } from "node:crypto";
import { POSITIVE_PERMISSIONS, permissionSchema } from "@insuredesk/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedExternalUserRole } from "../prisma/seed-data.ts";
import type { PrismaClient, User } from "../src/generated/prisma/client.ts";
import { hashApiKey, validateApiKey } from "../src/services/api-key.service.ts";
import { type IntegrationHarness, startIntegrationHarness } from "./integration-harness.ts";

describe("API key 管理面 × api_key.manage (Testcontainers)", () => {
  let harness: IntegrationHarness;
  let prisma: PrismaClient;
  let seeded: IntegrationHarness["seeded"];

  beforeAll(async () => {
    harness = await startIntegrationHarness({
      seed: ["rolesAndUsers"],
      traceId: "api-key-test",
    });
    prisma = harness.prisma;
    seeded = harness.seeded;
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  });

  let seq = 0;
  const futureExpiry = () => new Date(Date.now() + 86_400_000).toISOString();
  const keyArgs = (overrides: Record<string, unknown> = {}) => ({
    name: `key-${++seq}`,
    expiresAt: futureExpiry(),
    ...overrides,
  });

  async function createInternalUser() {
    seq += 1;
    return prisma.user.create({
      data: {
        username: `key-owner-${seq}`,
        name: `持钥人${seq}`,
        passwordHash: "dummy",
        roleId: seeded.roles.frontline.id,
        active: true,
      },
    });
  }

  const ownerCaller = (user: User) =>
    harness.callerWith(user, seeded.roles.frontline, ["api_key.manage"]);

  describe("权限目录与出厂种子", () => {
    it("api_key.manage / api_key.revoke_all 进权限目录与管理员展开，出厂角色不含这两点", () => {
      expect(permissionSchema.parse("api_key.manage")).toBe("api_key.manage");
      expect(permissionSchema.parse("api_key.revoke_all")).toBe("api_key.revoke_all");
      expect(POSITIVE_PERMISSIONS).toContain("api_key.manage");
      expect(POSITIVE_PERMISSIONS).toContain("api_key.revoke_all");
      for (const role of [seeded.roles.csManager, seeded.roles.frontline, seeded.roles.readOnly]) {
        expect(role.permissions).not.toContain("api_key.manage");
        expect(role.permissions).not.toContain("api_key.revoke_all");
      }
    });

    it("管理员经系统角色展开自动持有 api_key.manage", async () => {
      const admin = harness.callerFor(seeded.users.admin, seeded.roles.admin);
      await expect(admin.apiKey.list()).resolves.toEqual([]);
    });

    it("无 api_key.manage 403；未登录 401", async () => {
      const frontline = harness.callerFor(seeded.users.cs1, seeded.roles.frontline);
      const forbidden = { code: "FORBIDDEN" };
      await expect(frontline.apiKey.list()).rejects.toMatchObject(forbidden);
      await expect(frontline.apiKey.create(keyArgs())).rejects.toMatchObject(forbidden);
      await expect(frontline.apiKey.revoke({ id: "any" })).rejects.toMatchObject(forbidden);

      const anonymous = harness.appRouter.createCaller({
        traceId: "api-key-test",
        user: null,
        sessionToken: null,
      });
      const unauthorized = { code: "UNAUTHORIZED" };
      await expect(anonymous.apiKey.list()).rejects.toMatchObject(unauthorized);
      await expect(anonymous.apiKey.create(keyArgs())).rejects.toMatchObject(unauthorized);
    });
  });

  describe("create / list / revoke", () => {
    it("创建返回一次性明文（sk_ 前缀），库内只存 sha256 + 后 8 位 keyPreview，list 不回哈希", async () => {
      const caller = ownerCaller(seeded.users.cs1);
      const created = await caller.apiKey.create(keyArgs());
      expect(created.key.startsWith("sk_")).toBe(true);

      const row = await prisma.apiKey.findUniqueOrThrow({ where: { id: created.id } });
      expect(row.keyHash).toBe(createHash("sha256").update(created.key, "utf8").digest("hex"));
      expect(row.keyHash).not.toBe(created.key);
      expect(row.keyPreview).toBe(created.key.slice(-8));
      expect(row.userId).toBe(seeded.users.cs1.id);

      const listed = (await caller.apiKey.list()).find((item) => item.id === created.id);
      expect(listed).toMatchObject({
        name: created.name,
        status: "active",
        keyPreview: created.key.slice(-8),
        lastUsedAt: null,
      });
      expect(listed).not.toHaveProperty("key");
      expect(listed).not.toHaveProperty("keyHash");
    });

    it("expiresAt 可空：null 永不过期；过去时刻 BAD_REQUEST", async () => {
      const caller = ownerCaller(seeded.users.cs1);
      const never = await caller.apiKey.create(keyArgs({ expiresAt: null }));
      expect(never.expiresAt).toBeNull();
      const row = await prisma.apiKey.findUniqueOrThrow({ where: { id: never.id } });
      expect(row.expiresAt).toBeNull();
      await expect(validateApiKey(prisma, never.key)).resolves.toMatchObject({ ok: true });

      await expect(
        caller.apiKey.create(keyArgs({ expiresAt: new Date(Date.now() - 1000).toISOString() })),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("过期未吊销的 key 在 list 里派生为 expired", async () => {
      const caller = ownerCaller(seeded.users.cs1);
      const created = await caller.apiKey.create(keyArgs());
      await prisma.apiKey.update({
        where: { id: created.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const listed = (await caller.apiKey.list()).find((item) => item.id === created.id);
      expect(listed?.status).toBe("expired");
    });

    it("list 默认不含已吊销，includeRevoked 后可见；按 createdAt 倒序", async () => {
      const user = await createInternalUser();
      const caller = ownerCaller(user);
      const first = await caller.apiKey.create(keyArgs());
      const second = await caller.apiKey.create(keyArgs());
      await caller.apiKey.revoke({ id: first.id });

      const visible = await caller.apiKey.list();
      expect(visible.map((item) => item.id)).toEqual([second.id]);

      const all = await caller.apiKey.list({ includeRevoked: true });
      expect(all.map((item) => item.id)).toEqual([second.id, first.id]);
      expect(all.find((item) => item.id === first.id)?.status).toBe("revoked");
    });

    it("list 仅见本人 key", async () => {
      const other = await createInternalUser();
      await ownerCaller(seeded.users.cs1).apiKey.create(keyArgs());
      const own = await ownerCaller(other).apiKey.create(keyArgs());

      const mine = await ownerCaller(other).apiKey.list();
      expect(mine.map((item) => item.id)).toEqual([own.id]);
    });

    it("吊销幂等；他人 key 与不存在 id 一样 404", async () => {
      const mine = ownerCaller(seeded.users.cs1);
      const created = await mine.apiKey.create(keyArgs());

      await mine.apiKey.revoke({ id: created.id });
      await mine.apiKey.revoke({ id: created.id });
      const row = await prisma.apiKey.findUniqueOrThrow({ where: { id: created.id } });
      expect(row.status).toBe("revoked");

      const other = await createInternalUser();
      const foreign = await ownerCaller(other).apiKey.create(keyArgs());
      await expect(mine.apiKey.revoke({ id: foreign.id })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      await expect(mine.apiKey.revoke({ id: "missing" })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("每人 10 把上限：第 11 把拒绝，吊销后腾出名额", async () => {
      const user = await createInternalUser();
      const caller = ownerCaller(user);
      for (let i = 0; i < 10; i += 1) {
        await caller.apiKey.create(keyArgs());
      }
      await expect(caller.apiKey.create(keyArgs())).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });

      const victim = await prisma.apiKey.findFirstOrThrow({
        where: { userId: user.id, status: "active" },
      });
      await caller.apiKey.revoke({ id: victim.id });
      await expect(caller.apiKey.create(keyArgs())).resolves.toMatchObject({
        status: "active",
      });
    });

    it("并行 create 不超发：9 把存量下 5 个并发只放行 1 个", async () => {
      const user = await createInternalUser();
      const caller = ownerCaller(user);
      for (let i = 0; i < 9; i += 1) {
        await caller.apiKey.create(keyArgs());
      }
      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () => caller.apiKey.create(keyArgs())),
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await prisma.apiKey.count({ where: { userId: user.id } })).toBe(10);
    });
  });

  describe("revokeAllForUser（api_key.revoke_all 面）", () => {
    it("无 api_key.revoke_all 403（user.edit 不再放行）；持有者吊销目标全部 key 并留审计", async () => {
      const target = await createInternalUser();
      const targetCaller = ownerCaller(target);
      await targetCaller.apiKey.create(keyArgs());
      await targetCaller.apiKey.create(keyArgs());

      const manageOnly = harness.callerWith(seeded.users.manager, seeded.roles.csManager, [
        "api_key.manage",
      ]);
      await expect(manageOnly.apiKey.revokeAllForUser({ userId: target.id })).rejects.toMatchObject(
        {
          code: "FORBIDDEN",
        },
      );

      const userEditOnly = harness.callerWith(seeded.users.manager, seeded.roles.csManager, [
        "user.edit",
      ]);
      await expect(
        userEditOnly.apiKey.revokeAllForUser({ userId: target.id }),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
      });

      const withRevokeAll = harness.callerWith(seeded.users.manager, seeded.roles.csManager, [
        "api_key.revoke_all",
      ]);
      await expect(
        withRevokeAll.apiKey.revokeAllForUser({ userId: target.id }),
      ).resolves.toMatchObject({
        revoked: 2,
      });
      expect(await prisma.apiKey.count({ where: { userId: target.id, status: "active" } })).toBe(0);

      const auditRows = await prisma.apiKeyAuditLog.findMany({
        where: { targetUserId: target.id, action: "revoke_all" },
      });
      expect(auditRows).toHaveLength(2);
      for (const row of auditRows) {
        expect(row.actorId).toBe(seeded.users.manager.id);
        expect(row.keyName).toMatch(/^key-\d+$/);
        expect(row.keyPreview).toHaveLength(8);
      }
    });
  });

  describe("生命周期审计", () => {
    it("并发吊销同一把 key：两次都幂等成功，revoke 审计只记一条", async () => {
      const caller = ownerCaller(seeded.users.cs1);
      const created = await caller.apiKey.create(keyArgs());

      await Promise.all([
        caller.apiKey.revoke({ id: created.id }),
        caller.apiKey.revoke({ id: created.id }),
      ]);

      const row = await prisma.apiKey.findUniqueOrThrow({ where: { id: created.id } });
      expect(row.status).toBe("revoked");
      const revokeRows = await prisma.apiKeyAuditLog.findMany({
        where: { targetKeyId: created.id, action: "revoke" },
      });
      expect(revokeRows).toHaveLength(1);
    });

    it("并发 revokeAllForUser：审计行数等于 key 数（不重复记），返回计数合计为实际翻转数", async () => {
      const target = await createInternalUser();
      const targetCaller = ownerCaller(target);
      await targetCaller.apiKey.create(keyArgs());
      await targetCaller.apiKey.create(keyArgs());
      const withRevokeAll = harness.callerWith(seeded.users.manager, seeded.roles.csManager, [
        "api_key.revoke_all",
      ]);

      const [first, second] = await Promise.all([
        withRevokeAll.apiKey.revokeAllForUser({ userId: target.id }),
        withRevokeAll.apiKey.revokeAllForUser({ userId: target.id }),
      ]);
      expect(first.revoked + second.revoked).toBe(2);
      expect(await prisma.apiKey.count({ where: { userId: target.id, status: "active" } })).toBe(0);

      const auditRows = await prisma.apiKeyAuditLog.findMany({
        where: { targetUserId: target.id, action: "revoke_all" },
      });
      expect(auditRows).toHaveLength(2);
    });

    it("create/revoke 落 api_key_audit_logs（actor/target/快照字段齐），吊销幂等不重记", async () => {
      const caller = ownerCaller(seeded.users.cs1);
      const created = await caller.apiKey.create(keyArgs());

      const createdRows = await prisma.apiKeyAuditLog.findMany({
        where: { targetKeyId: created.id, action: "create" },
      });
      expect(createdRows).toHaveLength(1);
      expect(createdRows[0]).toMatchObject({
        actorId: seeded.users.cs1.id,
        targetUserId: seeded.users.cs1.id,
        keyName: created.name,
        keyPreview: created.key.slice(-8),
      });
      expect(createdRows[0]?.requestId).toBe("api-key-test");

      await caller.apiKey.revoke({ id: created.id });
      await caller.apiKey.revoke({ id: created.id });
      const revokeRows = await prisma.apiKeyAuditLog.findMany({
        where: { targetKeyId: created.id, action: "revoke" },
      });
      expect(revokeRows).toHaveLength(1);
      expect(revokeRows[0]).toMatchObject({
        actorId: seeded.users.cs1.id,
        targetUserId: seeded.users.cs1.id,
        keyPreview: created.key.slice(-8),
      });
    });
  });

  describe("validateApiKey reason 矩阵", () => {
    it("正常 key：ok + 属主身份按登录同口径展开", async () => {
      const caller = ownerCaller(seeded.users.cs1);
      const created = await caller.apiKey.create(keyArgs());

      const result = await validateApiKey(prisma, created.key);
      expect(result).toMatchObject({ ok: true, keyId: created.id });
      if (result.ok) {
        expect(result.user.id).toBe(seeded.users.cs1.id);
        expect(result.user.permissions).toEqual(
          expect.arrayContaining(seeded.roles.frontline.permissions),
        );
        expect(result.user.isExternal).toBe(false);
      }
    });

    it("invalid：库中无此哈希", async () => {
      await expect(validateApiKey(prisma, "sk_not-in-db")).resolves.toEqual({
        ok: false,
        reason: "invalid",
      });
    });

    it("expired：过期未吊销", async () => {
      const token = `sk_expired-${++seq}`;
      await prisma.apiKey.create({
        data: {
          name: "expired",
          keyHash: hashApiKey(token),
          keyPreview: token.slice(-8),
          userId: seeded.users.cs1.id,
          expiresAt: new Date(Date.now() - 1000),
        },
      });
      await expect(validateApiKey(prisma, token)).resolves.toEqual({
        ok: false,
        reason: "expired",
      });
    });

    it("revoked：吊销即失效", async () => {
      const caller = ownerCaller(seeded.users.cs1);
      const created = await caller.apiKey.create(keyArgs());
      await caller.apiKey.revoke({ id: created.id });
      await expect(validateApiKey(prisma, created.key)).resolves.toEqual({
        ok: false,
        reason: "revoked",
      });
    });

    it("user_disabled：属主被禁用", async () => {
      const user = await createInternalUser();
      const created = await ownerCaller(user).apiKey.create(keyArgs());
      await prisma.user.update({ where: { id: user.id }, data: { active: false } });
      await expect(validateApiKey(prisma, created.key)).resolves.toEqual({
        ok: false,
        reason: "user_disabled",
      });
    });

    it("external_role：外部角色持钥判 403 档", async () => {
      const externalRole = await seedExternalUserRole(prisma);
      const external = await prisma.user.create({
        data: {
          username: `external-${++seq}`,
          name: "外部",
          passwordHash: "dummy",
          roleId: externalRole.id,
          active: true,
        },
      });
      const token = `sk_external-${seq}`;
      await prisma.apiKey.create({
        data: {
          name: "external",
          keyHash: hashApiKey(token),
          keyPreview: token.slice(-8),
          userId: external.id,
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      });
      await expect(validateApiKey(prisma, token)).resolves.toEqual({
        ok: false,
        reason: "external_role",
      });
    });

    it("lastUsedAt 60s 节流：同窗只写一次，越过窗口再写", async () => {
      const caller = ownerCaller(seeded.users.cs1);
      const created = await caller.apiKey.create(keyArgs());

      await validateApiKey(prisma, created.key);
      const first = await prisma.apiKey.findUniqueOrThrow({ where: { id: created.id } });
      expect(first.lastUsedAt).not.toBeNull();

      await validateApiKey(prisma, created.key);
      const second = await prisma.apiKey.findUniqueOrThrow({ where: { id: created.id } });
      expect(second.lastUsedAt?.toISOString()).toBe(first.lastUsedAt?.toISOString());

      await prisma.apiKey.update({
        where: { id: created.id },
        data: { lastUsedAt: new Date(Date.now() - 61_000) },
      });
      await validateApiKey(prisma, created.key);
      const third = await prisma.apiKey.findUniqueOrThrow({ where: { id: created.id } });
      expect(third.lastUsedAt?.getTime()).toBeGreaterThan(first.lastUsedAt?.getTime() ?? 0);
    });
  });
});
