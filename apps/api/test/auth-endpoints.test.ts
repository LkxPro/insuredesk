import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PrismaClient } from "@prisma/client";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_PASSWORD } from "../prisma/seed-data";

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Endpoint-level auth tests: drive the real Fastify app (buildServer) over
 * app.inject against a Testcontainers Postgres, exactly the surface the web
 * frontend consumes.
 *
 * From the acceptance criteria (#2, #18):
 * - Password login → httpOnly session cookie; logout clears it
 * - `me` query returns identity + resolved permission-point set
 * - Guarded probe rejects the frontline user (admin vs 一线客服 differ)
 */

describe("Auth HTTP endpoints (Testcontainers)", () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;
  let app: FastifyInstance;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:17-alpine").start();
    const databaseUrl = container.getConnectionUri();

    // Apply migrations via the real Prisma CLI, then point the app's canonical
    // client at the container before importing any app module (same pattern as
    // db.integration.test.ts).
    execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
      cwd: apiDir,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "pipe",
    });
    process.env.DATABASE_URL = databaseUrl;

    const [{ prisma: appPrisma }, { seedFactoryRolesAndDemoUsers }, { parseEnv }, { buildServer }] =
      await Promise.all([
        import("../src/db"),
        import("../prisma/seed-data"),
        import("../src/env"),
        import("../src/server"),
      ]);
    prisma = appPrisma;
    await seedFactoryRolesAndDemoUsers(prisma);

    const env = parseEnv({
      DATABASE_URL: databaseUrl,
      SESSION_SECRET: "insuredesk-endpoint-test-secret-0123456789",
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
    });
    app = buildServer(env);
    await app.ready();
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
    await container?.stop();
  });

  /** POST /api/auth/login as the given demo user. */
  function login(username: string, password: string) {
    return app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username, password },
    });
  }

  /** Extract the parsed `session` cookie from a response, if set. */
  function sessionCookie(res: { cookies: Array<Record<string, unknown>> }) {
    return res.cookies.find((cookie) => cookie.name === "session");
  }

  describe("POST /api/auth/login", () => {
    it("valid credentials → 200, httpOnly session cookie, identity payload", async () => {
      const res = await login("admin", DEMO_PASSWORD);

      expect(res.statusCode).toBe(200);

      const cookie = sessionCookie(res);
      expect(cookie).toBeDefined();
      expect(cookie?.httpOnly).toBe(true);
      expect(cookie?.path).toBe("/");
      expect(String(cookie?.value).length).toBe(64); // 32 random bytes, hex

      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.user.username).toBe("admin");
      expect(body.user.roleName).toBe("管理员");
      expect(body.user.permissions).toContain("ticket.view_all");
    });

    it("wrong password → 401 and no session cookie", async () => {
      const res = await login("admin", "wrong-password");

      expect(res.statusCode).toBe(401);
      expect(sessionCookie(res)).toBeUndefined();
      expect(res.json().error).toBeTruthy();
    });

    it("malformed request bodies → 400, never a crash", async () => {
      // No body at all (req.body is undefined)
      const noBody = await app.inject({ method: "POST", url: "/api/auth/login" });
      expect(noBody.statusCode).toBe(400);

      // Fields present but not strings
      const wrongTypes = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { username: 123, password: { $ne: null } },
      });
      expect(wrongTypes.statusCode).toBe(400);

      // Fields missing
      const missingFields = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { username: "admin" },
      });
      expect(missingFields.statusCode).toBe(400);
    });
  });

  describe("tRPC auth.me", () => {
    it("without a session cookie → UNAUTHORIZED", async () => {
      const res = await app.inject({ method: "GET", url: "/trpc/auth.me" });

      expect(res.statusCode).toBe(401);
      expect(res.json().error.data.code).toBe("UNAUTHORIZED");
    });

    it("admin vs 一线客服 identities and permission sets differ", async () => {
      const adminToken = String(sessionCookie(await login("admin", DEMO_PASSWORD))?.value);
      const csToken = String(sessionCookie(await login("cs1", DEMO_PASSWORD))?.value);

      const adminMe = await app.inject({
        method: "GET",
        url: "/trpc/auth.me",
        cookies: { session: adminToken },
      });
      const csMe = await app.inject({
        method: "GET",
        url: "/trpc/auth.me",
        cookies: { session: csToken },
      });

      expect(adminMe.statusCode).toBe(200);
      expect(csMe.statusCode).toBe(200);

      const admin = adminMe.json().result.data;
      const cs = csMe.json().result.data;

      expect(admin.username).toBe("admin");
      expect(admin.roleName).toBe("管理员");
      expect(admin.permissions).toContain("ticket.assign");

      expect(cs.username).toBe("cs1");
      expect(cs.roleName).toBe("一线客服");
      expect(cs.permissions).toEqual(
        expect.arrayContaining(["dashboard.view", "ticket.view", "ticket.process"]),
      );
      expect(cs.permissions).not.toContain("ticket.view_all");
      expect(cs.permissions).not.toContain("ticket.assign");
    });

    it("a stale session cookie is cleared on the response", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/trpc/auth.me",
        cookies: { session: "0".repeat(64) },
      });

      expect(res.statusCode).toBe(401);
      const cleared = sessionCookie(res);
      expect(cleared).toBeDefined();
      expect(cleared?.value).toBe("");
    });
  });

  describe("POST /api/auth/logout", () => {
    it("clears the cookie, deletes the session, and me stops working", async () => {
      const token = String(sessionCookie(await login("manager", DEMO_PASSWORD))?.value);

      // Session works before logout
      const meBefore = await app.inject({
        method: "GET",
        url: "/trpc/auth.me",
        cookies: { session: token },
      });
      expect(meBefore.statusCode).toBe(200);

      const logout = await app.inject({
        method: "POST",
        url: "/api/auth/logout",
        cookies: { session: token },
      });
      expect(logout.statusCode).toBe(200);
      expect(sessionCookie(logout)?.value).toBe("");

      // Session row is gone from the store...
      const session = await prisma.session.findUnique({ where: { token } });
      expect(session).toBeNull();

      // ...so replaying the old cookie no longer authenticates
      const meAfter = await app.inject({
        method: "GET",
        url: "/trpc/auth.me",
        cookies: { session: token },
      });
      expect(meAfter.statusCode).toBe(401);
    });
  });

  describe("tRPC demo.assignProbe (requirePermission guard)", () => {
    it("admin passes the ticket.assign guard", async () => {
      const token = String(sessionCookie(await login("admin", DEMO_PASSWORD))?.value);

      const res = await app.inject({
        method: "GET",
        url: "/trpc/demo.assignProbe",
        cookies: { session: token },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().result.data.permission).toBe("ticket.assign");
    });

    it("frontline user (一线客服) is rejected with FORBIDDEN", async () => {
      const token = String(sessionCookie(await login("cs1", DEMO_PASSWORD))?.value);

      const res = await app.inject({
        method: "GET",
        url: "/trpc/demo.assignProbe",
        cookies: { session: token },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error.data.code).toBe("FORBIDDEN");
    });
  });
});
