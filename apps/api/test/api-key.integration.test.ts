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
    it("api_key.manage 进权限目录与管理员展开，出厂角色不含该点", () => {
      expect(permissionSchema.parse("api_key.manage")).toBe("api_key.manage");
      expect(POSITIVE_PERMISSIONS).toContain("api_key.manage");
      for (const role of [seeded.roles.csManager, seeded.roles.frontline, seeded.roles.readOnly]) {
        expect(role.permissions).not.toContain("api_key.manage");
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
    it("创建返回一次性明文（sk_live_ 前缀），库内只存 sha256，list 不回哈希", async () => {
      const caller = ownerCaller(seeded.users.cs1);
      const created = await caller.apiKey.create(keyArgs());
      expect(created.key.startsWith("sk_live_")).toBe(true);

      const row = await prisma.apiKey.findUniqueOrThrow({ where: { id: created.id } });
      expect(row.keyHash).toBe(createHash("sha256").update(created.key, "utf8").digest("hex"));
      expect(row.keyHash).not.toBe(created.key);
      expect(row.userId).toBe(seeded.users.cs1.id);

      const listed = (await caller.apiKey.list()).find((item) => item.id === created.id);
      expect(listed).toMatchObject({
        name: created.name,
        status: "active",
        lastUsedAt: null,
      });
      expect(listed).not.toHaveProperty("key");
      expect(listed).not.toHaveProperty("keyHash");
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

  describe("revokeAllForUser（user.edit 面）", () => {
    it("无 user.edit 403；持有者吊销目标全部 key", async () => {
      const target = await createInternalUser();
      const targetCaller = ownerCaller(target);
      await targetCaller.apiKey.create(keyArgs());
      await targetCaller.apiKey.create(keyArgs());

      const noEdit = harness.callerWith(seeded.users.manager, seeded.roles.csManager, [
        "api_key.manage",
      ]);
      await expect(noEdit.apiKey.revokeAllForUser({ userId: target.id })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });

      const withEdit = harness.callerWith(seeded.users.manager, seeded.roles.csManager, [
        "user.edit",
      ]);
      await expect(withEdit.apiKey.revokeAllForUser({ userId: target.id })).resolves.toMatchObject({
        revoked: 2,
      });
      expect(await prisma.apiKey.count({ where: { userId: target.id, status: "active" } })).toBe(0);
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
      await expect(validateApiKey(prisma, "sk_live_not-in-db")).resolves.toEqual({
        ok: false,
        reason: "invalid",
      });
    });

    it("expired：过期未吊销", async () => {
      const token = `sk_live_expired-${++seq}`;
      await prisma.apiKey.create({
        data: {
          name: "expired",
          keyHash: hashApiKey(token),
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
      const token = `sk_live_external-${seq}`;
      await prisma.apiKey.create({
        data: {
          name: "external",
          keyHash: hashApiKey(token),
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
