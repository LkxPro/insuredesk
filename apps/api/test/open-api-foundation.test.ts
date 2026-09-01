import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import { openApiErrorBodySchema } from "@insuredesk/shared";
import { PrismaPg } from "@prisma/adapter-pg";
import type { FastifyInstance } from "fastify";
import { pino } from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_PASSWORD, seedExternalUserRole } from "../prisma/seed-data.ts";
import { apiDb } from "../src/db.ts";
import { parseEnv } from "../src/env.ts";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { mapOpenApiError } from "../src/routes/open-api/app.ts";
import { buildLoggerOptions, buildServer } from "../src/server.ts";
import { hashApiKey } from "../src/services/api-key.service.ts";
import { type IntegrationHarness, startIntegrationHarness } from "./integration-harness.ts";

describe("开放 API /api/v1 基础设施 (Testcontainers)", () => {
  let harness: IntegrationHarness;
  let prisma: PrismaClient;
  let seeded: IntegrationHarness["seeded"];
  let app: FastifyInstance;
  let appDisabled: FastifyInstance;

  beforeAll(async () => {
    harness = await startIntegrationHarness({ seed: ["rolesAndUsers"] });
    prisma = harness.prisma;
    seeded = harness.seeded;

    const baseEnv = {
      DATABASE_URL: harness.databaseUrl,
      SESSION_SECRET: "insuredesk-open-api-test-secret-0123456789",
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
    };
    app = buildServer(parseEnv({ ...baseEnv, OPEN_API_ENABLED: "true" }));
    appDisabled = buildServer(parseEnv({ ...baseEnv, OPEN_API_ENABLED: "false" }));
    await Promise.all([app.ready(), appDisabled.ready()]);
  }, 180_000);

  afterAll(async () => {
    await Promise.all([app?.close(), appDisabled?.close()]);
    await harness?.stop();
  });

  let seq = 0;
  async function issueKey(userId: string, overrides: Record<string, unknown> = {}) {
    const token = `sk_live_test-${randomUUID()}`;
    const row = await prisma.apiKey.create({
      data: {
        name: `open-api-test-${++seq}`,
        keyHash: hashApiKey(token),
        userId,
        expiresAt: new Date(Date.now() + 86_400_000),
        ...overrides,
      },
    });
    return { token, keyId: row.id };
  }

  function getMe(
    target: FastifyInstance,
    options: {
      token?: string;
      cookie?: string;
      headers?: Record<string, string>;
      remoteAddress?: string;
    } = {},
  ) {
    return target.inject({
      method: "GET",
      url: "/api/v1/me",
      headers: {
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
        ...options.headers,
      },
      ...(options.cookie ? { cookies: { session: options.cookie } } : {}),
      ...(options.remoteAddress ? { remoteAddress: options.remoteAddress } : {}),
    });
  }

  async function adminSessionCookie(): Promise<string> {
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "admin", password: DEMO_PASSWORD },
    });
    return String(login.cookies.find((cookie) => cookie.name === "session")?.value);
  }

  describe("OPEN_API_ENABLED 开关", () => {
    it("关闭时整面 404：公开端点、数据端点（带有效 key）一并 404", async () => {
      const { token } = await issueKey(seeded.users.admin.id);

      const discovery = await appDisabled.inject({ method: "GET", url: "/api/v1" });
      expect(discovery.statusCode).toBe(404);

      const me = await getMe(appDisabled, { token });
      expect(me.statusCode).toBe(404);

      const spec = await appDisabled.inject({ method: "GET", url: "/api/v1/openapi.json" });
      expect(spec.statusCode).toBe(404);
    });

    it("重开恢复：同库重挂后面恢复，key 与审计数据原样保留", async () => {
      const { token, keyId } = await issueKey(seeded.users.cs1.id);
      const first = await getMe(app, { token });
      expect(first.statusCode).toBe(200);
      const auditBefore = await prisma.apiAccessLog.count({ where: { keyId } });
      expect(auditBefore).toBeGreaterThan(0);

      const whileDisabled = await getMe(appDisabled, { token });
      expect(whileDisabled.statusCode).toBe(404);

      expect(await prisma.apiKey.findUnique({ where: { id: keyId } })).not.toBeNull();
      expect(await prisma.apiAccessLog.count({ where: { keyId } })).toBe(auditBefore);

      const reopened = await getMe(app, { token });
      expect(reopened.statusCode).toBe(200);
    });
  });

  describe("bearer hook 双向隔离", () => {
    it("API key 对 tRPC 无效", async () => {
      const { token } = await issueKey(seeded.users.admin.id);
      const res = await app.inject({
        method: "GET",
        url: "/trpc/auth.me",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(401);
    });

    it("API key 对既有 plain route 无效", async () => {
      const { token } = await issueKey(seeded.users.admin.id);
      const res = await app.inject({
        method: "GET",
        url: "/api/tickets/export",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(401);
    });

    it("cookie session 身份在 /api/v1 数据端点不被消费", async () => {
      const cookie = await adminSessionCookie();
      const res = await getMe(app, { cookie });
      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: { code: "unauthorized" } });
    });

    it("公开 allowlist：GET /api/v1 无认证 200；/api/v1/openapi.json 携无效 bearer 也不被认证拦截", async () => {
      const discovery = await app.inject({ method: "GET", url: "/api/v1" });
      expect(discovery.statusCode).toBe(200);
      expect(discovery.headers["cache-control"]).toBe("no-store");

      const spec = await app.inject({
        method: "GET",
        url: "/api/v1/openapi.json",
        headers: { authorization: "Bearer sk_live_garbage" },
      });
      expect(spec.statusCode).toBe(404);
      expect(spec.headers["cache-control"]).toBe("no-store");

      const unknown = await app.inject({ method: "GET", url: "/api/v1/nope" });
      expect(unknown.statusCode).toBe(401);
      expect(unknown.headers["cache-control"]).toBe("no-store");
    });
  });

  describe("401/403 映射与错误信封", () => {
    it("无/畸形 Authorization → 401 unauthorized 信封", async () => {
      const missing = await getMe(app);
      expect(missing.statusCode).toBe(401);
      expect(() => openApiErrorBodySchema.parse(missing.json())).not.toThrow();
      expect(missing.json().error.code).toBe("unauthorized");
      expect(missing.headers["cache-control"]).toBe("no-store");

      const wrongScheme = await app.inject({
        method: "GET",
        url: "/api/v1/me",
        headers: { authorization: "Token abc" },
      });
      expect(wrongScheme.statusCode).toBe(401);
    });

    it("库中无此 key / 已吊销 / 已过期 → 401", async () => {
      expect((await getMe(app, { token: "sk_live_not-in-db" })).statusCode).toBe(401);

      const revoked = await issueKey(seeded.users.cs1.id, { status: "revoked" });
      expect((await getMe(app, { token: revoked.token })).statusCode).toBe(401);

      const expired = await issueKey(seeded.users.cs1.id, {
        expiresAt: new Date(Date.now() - 1000),
      });
      expect((await getMe(app, { token: expired.token })).statusCode).toBe(401);
    });

    it("external_role key → 403 forbidden 信封", async () => {
      const externalRole = await seedExternalUserRole(prisma);
      const external = await prisma.user.create({
        data: {
          username: `open-api-external-${++seq}`,
          name: "外部",
          passwordHash: "dummy",
          roleId: externalRole.id,
          active: true,
        },
      });
      const { token } = await issueKey(external.id);
      const res = await getMe(app, { token });
      expect(res.statusCode).toBe(403);
      expect(() => openApiErrorBodySchema.parse(res.json())).not.toThrow();
      expect(res.json().error.code).toBe("forbidden");
    });
  });

  describe("GET /api/v1 发现文档与 GET /api/v1/me 纵切面", () => {
    it("发现文档公开，声明 openapi/meta/docs/auth", async () => {
      const res = await app.inject({ method: "GET", url: "/api/v1" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.openapi).toBe("/api/v1/openapi.json");
      expect(body.meta).toBe("/api/v1/meta");
      expect(body.docs).toBe("/docs/analytics");
      expect(body.auth).toMatchObject({ scheme: "bearer", header: "Authorization" });
    });

    it("me 自省：管理员 key → dataScope all，字段穿过认证/审计全栈", async () => {
      const { token, keyId } = await issueKey(seeded.users.admin.id);
      const res = await getMe(app, { token, headers: { "x-request-id": "open-api-me-admin" } });
      expect(res.statusCode).toBe(200);
      expect(res.headers["cache-control"]).toBe("no-store");
      const body = res.json();
      expect(body.user).toMatchObject({ id: seeded.users.admin.id, username: "admin" });
      expect(body.role.name).toBe("管理员");
      expect(body.permissions).toContain("ticket.view_all");
      expect(body.dataScope).toBe("all");

      const audit = await prisma.apiAccessLog.findFirstOrThrow({
        where: { keyId, requestId: "open-api-me-admin" },
      });
      expect(audit).toMatchObject({
        userId: seeded.users.admin.id,
        endpoint: "GET /api/v1/me",
        statusCode: 200,
        rowCount: 1,
      });
      expect(audit.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("me 自省：一线客服 key → dataScope own", async () => {
      const { token } = await issueKey(seeded.users.cs1.id);
      const res = await getMe(app, { token });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.user.username).toBe("cs1");
      expect(body.dataScope).toBe("own");
      expect(body.permissions).not.toContain("ticket.view_all");
    });
  });

  describe("限流", () => {
    it("单 key 20 连发后第 21 次 429 rate_limited + Retry-After，429 落审计", async () => {
      const { token, keyId } = await issueKey(seeded.users.cs1.id);
      for (let i = 0; i < 20; i += 1) {
        const res = await getMe(app, { token });
        expect(res.statusCode).toBe(200);
      }
      const limited = await getMe(app, { token });
      expect(limited.statusCode).toBe(429);
      expect(limited.json()).toMatchObject({ error: { code: "rate_limited" } });
      expect(Number(limited.headers["retry-after"])).toBeGreaterThanOrEqual(1);
      expect(limited.headers["cache-control"]).toBe("no-store");

      const audit = await prisma.apiAccessLog.findFirst({
        where: { keyId, statusCode: 429, endpoint: "GET /api/v1/me" },
      });
      expect(audit).not.toBeNull();
    });

    it("公开端点不限流：25 次发现文档全 200", async () => {
      for (let i = 0; i < 25; i += 1) {
        const res = await app.inject({ method: "GET", url: "/api/v1" });
        expect(res.statusCode).toBe(200);
      }
    });
  });

  describe("apiDb 并发闸与慢查询闸", () => {
    it("apiDb 会话 statement_timeout 落为 15s", async () => {
      const rows =
        await apiDb.$queryRawUnsafe<{ statement_timeout: string }[]>("SHOW statement_timeout");
      expect(rows[0]?.statement_timeout).toBe("15s");
    });

    it("池占满取连接超时 → 503 concurrency_limit 信封并落审计", async () => {
      const { token, keyId } = await issueKey(seeded.users.cs1.id);
      const sleepers = Array.from({ length: 4 }, () =>
        apiDb.$queryRawUnsafe("SELECT pg_sleep(3)").catch(() => {}),
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      try {
        const res = await getMe(app, { token });
        expect(res.statusCode).toBe(503);
        expect(res.json()).toMatchObject({ error: { code: "concurrency_limit" } });

        const audit = await prisma.apiAccessLog.findFirst({
          where: { keyId, statusCode: 503 },
        });
        expect(audit).not.toBeNull();
      } finally {
        await Promise.all(sleepers);
      }
    });

    it("真实 PG statement 超时（57014）映射 504 query_timeout", async () => {
      const slow = new PrismaClient({
        adapter: new PrismaPg({
          connectionString: harness.databaseUrl,
          options: "-c timezone=UTC -c statement_timeout=500",
        }),
      });
      try {
        const error = await slow.$queryRawUnsafe("SELECT pg_sleep(1)").catch((e: unknown) => e);
        expect(mapOpenApiError(error)).toMatchObject({ statusCode: 504, code: "query_timeout" });
      } finally {
        await slow.$disconnect();
      }
    });

    it("真实 pg 取连接超时映射 503 concurrency_limit", async () => {
      const tiny = new PrismaClient({
        adapter: new PrismaPg({
          connectionString: harness.databaseUrl,
          max: 1,
          connectionTimeoutMillis: 300,
          options: "-c timezone=UTC",
        }),
      });
      try {
        const holder = tiny.$queryRawUnsafe("SELECT pg_sleep(2)").catch(() => {});
        await new Promise((resolve) => setTimeout(resolve, 200));
        const error = await tiny.$queryRawUnsafe("SELECT 1").catch((e: unknown) => e);
        expect(mapOpenApiError(error)).toMatchObject({
          statusCode: 503,
          code: "concurrency_limit",
        });
        await holder;
      } finally {
        await tiny.$disconnect();
      }
    });

    it("未识别的错误映射 500 internal_error", () => {
      expect(mapOpenApiError(new Error("boom"))).toMatchObject({
        statusCode: 500,
        code: "internal_error",
      });
    });
  });

  describe("审计矩阵", () => {
    it("403 external_role 落库字段完整", async () => {
      const externalRole = await seedExternalUserRole(prisma);
      const external = await prisma.user.create({
        data: {
          username: `open-api-external-audit-${++seq}`,
          name: "外部",
          passwordHash: "dummy",
          roleId: externalRole.id,
          active: true,
        },
      });
      const { token, keyId } = await issueKey(external.id);
      const res = await getMe(app, { token, headers: { "x-request-id": "open-api-403-audit" } });
      expect(res.statusCode).toBe(403);

      const audit = await prisma.apiAccessLog.findFirstOrThrow({
        where: { keyId, requestId: "open-api-403-audit" },
      });
      expect(audit).toMatchObject({
        userId: external.id,
        endpoint: "GET /api/v1/me",
        statusCode: 403,
        rowCount: 0,
      });
    });

    it("401 仅 pino：无效 key 不落审计", async () => {
      const before = await prisma.apiAccessLog.count();
      const res = await getMe(app, { token: "sk_live_pino-only" });
      expect(res.statusCode).toBe(401);
      expect(await prisma.apiAccessLog.count()).toBe(before);
    });

    it("审计 IP 取 trustProxy:1 语义：伪造的左侧 XFF 段不入库，无 XFF 取对端地址", async () => {
      const { token, keyId } = await issueKey(seeded.users.cs1.id);

      await getMe(app, {
        token,
        remoteAddress: "10.0.0.9",
        headers: { "x-forwarded-for": "9.9.9.9, 5.5.5.5", "x-request-id": "open-api-xff" },
      });
      const forged = await prisma.apiAccessLog.findFirstOrThrow({
        where: { keyId, requestId: "open-api-xff" },
      });
      expect(forged.ip).toBe("5.5.5.5");

      await getMe(app, {
        token,
        remoteAddress: "10.0.0.9",
        headers: { "x-request-id": "open-api-direct" },
      });
      const direct = await prisma.apiAccessLog.findFirstOrThrow({
        where: { keyId, requestId: "open-api-direct" },
      });
      expect(direct.ip).toBe("10.0.0.9");
    });
  });

  describe("日志脱敏", () => {
    it("Authorization 不进请求日志；同一 logger 配置下 headers 被序列化时 token 被 redact", async () => {
      let captured = "";
      const stream = new Writable({
        write(chunk, _encoding, callback) {
          captured += chunk.toString();
          callback();
        },
      });
      const env = parseEnv({
        DATABASE_URL: harness.databaseUrl,
        SESSION_SECRET: "insuredesk-open-api-test-secret-0123456789",
        NODE_ENV: "test",
        LOG_LEVEL: "info",
        OPEN_API_ENABLED: "true",
      });
      const logged = buildServer(env, { loggerStream: stream });
      await logged.ready();
      try {
        const { token } = await issueKey(seeded.users.cs1.id);
        const res = await getMe(logged, { token });
        expect(res.statusCode).toBe(200);
        expect(captured).not.toContain(token);
      } finally {
        await logged.close();
      }

      // Fastify 的 req 序列化器本就不带 headers；redact 是兜底，故用同一套
      // logger 配置驱动裸 pino 直验。
      let redactProbe = "";
      const probeStream = new Writable({
        write(chunk, _encoding, callback) {
          redactProbe += chunk.toString();
          callback();
        },
      });
      const probeLogger = pino(buildLoggerOptions(env), probeStream);
      probeLogger.info({ req: { headers: { authorization: "Bearer sk_live_probe-token" } } });
      expect(redactProbe).not.toContain("sk_live_probe-token");
      expect(redactProbe).toContain("[Redacted]");
    });
  });
});
