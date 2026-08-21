import { POSITIVE_PERMISSIONS, RESTRICTIVE_PERMISSIONS } from "@insuredesk/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client.ts";
import {
  effectivePermissions,
  hashPassword,
  hasPermission,
  PasswordAuthProvider,
  SessionService,
} from "../src/services/auth.service.ts";
import {
  applyDashboardDataScope,
  applyTicketDataScope,
} from "../src/services/data-scope.service.ts";
import { type IntegrationHarness, startIntegrationHarness } from "./integration-harness.ts";

describe("Authentication and RBAC (Testcontainers)", () => {
  let harness: IntegrationHarness;
  let prisma: PrismaClient;
  let authProvider: PasswordAuthProvider;
  let sessionService: SessionService;

  function expectPresent<T>(value: T | null | undefined): asserts value is T {
    expect(value).toBeTruthy();
  }

  beforeAll(async () => {
    harness = await startIntegrationHarness({ seed: ["rolesAndUsers"] });
    prisma = harness.prisma;
    authProvider = new PasswordAuthProvider(prisma);
    sessionService = new SessionService(prisma, 86400);
  }, 180_000);

  afterAll(async () => {
    await harness?.stop();
  });

  describe("Password Authentication", () => {
    it("authenticates valid credentials", async () => {
      const userId = await authProvider.authenticate({
        username: "admin",
        password: "password123",
      });

      expect(userId).toBeTruthy();
      expect(typeof userId).toBe("string");
    });

    it("rejects invalid username", async () => {
      const userId = await authProvider.authenticate({
        username: "nonexistent",
        password: "password123",
      });

      expect(userId).toBeNull();
    });

    it("rejects invalid password", async () => {
      const userId = await authProvider.authenticate({
        username: "admin",
        password: "wrongpassword",
      });

      expect(userId).toBeNull();
    });

    it("rejects inactive users", async () => {
      const role = await prisma.role.findFirst({ where: { name: "一线客服" } });
      expectPresent(role);
      const passwordHash = await hashPassword("password123");

      await prisma.user.create({
        data: {
          username: "inactive",
          passwordHash,
          name: "Inactive User",
          email: "inactive@test.com",
          roleId: role.id,
          active: false,
        },
      });

      const userId = await authProvider.authenticate({
        username: "inactive",
        password: "password123",
      });

      expect(userId).toBeNull();
    });
  });

  describe("Session Management", () => {
    it("creates and validates sessions", async () => {
      const user = await prisma.user.findUnique({ where: { username: "admin" } });
      expectPresent(user);

      const token = await sessionService.createSession(user.id);
      expect(token).toBeTruthy();
      expect(token.length).toBe(64);

      const authenticatedUser = await sessionService.validateSession(token);
      expectPresent(authenticatedUser);
      expect(authenticatedUser.username).toBe("admin");
      expect(authenticatedUser.roleName).toBe("管理员");
      expect(authenticatedUser.permissions).toContain("ticket.view_all");
    });

    it("rejects expired sessions", async () => {
      const user = await prisma.user.findUnique({ where: { username: "admin" } });
      expectPresent(user);

      const shortSessionService = new SessionService(prisma, 1);
      const token = await shortSessionService.createSession(user.id);

      await new Promise((resolve) => setTimeout(resolve, 1500));

      const authenticatedUser = await sessionService.validateSession(token);
      expect(authenticatedUser).toBeNull();
    });

    it("deletes sessions on logout", async () => {
      const user = await prisma.user.findUnique({ where: { username: "admin" } });
      expectPresent(user);
      const token = await sessionService.createSession(user.id);

      let authenticatedUser = await sessionService.validateSession(token);
      expectPresent(authenticatedUser);

      await sessionService.deleteSession(token);

      authenticatedUser = await sessionService.validateSession(token);
      expect(authenticatedUser).toBeNull();
    });
  });

  describe("RBAC - Permission Resolution", () => {
    it("admin has all positive permissions and no restrictive ones", async () => {
      const user = await prisma.user.findUnique({ where: { username: "admin" } });
      expectPresent(user);

      // 系统角色的权限不读库,会话解析恒为当前代码的全量正向权限点;
      // 限制类权限(勾选=禁止)必须排除,否则 admin 会被自动禁止对应操作
      const token = await sessionService.createSession(user.id);
      const authenticated = await sessionService.validateSession(token);
      expectPresent(authenticated);
      expect([...authenticated.permissions].sort()).toEqual([...POSITIVE_PERMISSIONS].sort());
      for (const restrictive of RESTRICTIVE_PERMISSIONS) {
        expect(authenticated.permissions).not.toContain(restrictive);
      }
    });

    it("effectivePermissions keeps stored restrictive permissions for normal roles", () => {
      const resolved = effectivePermissions({
        system: false,
        permissions: ["dashboard.view", "user.forbid_change_own_password"],
      });
      expect(resolved).toEqual(["dashboard.view", "user.forbid_change_own_password"]);
    });

    it("frontline CS has limited permissions", async () => {
      const user = await prisma.user.findUnique({
        where: { username: "cs1" },
        include: { role: true },
      });
      expectPresent(user);

      expect(user.role.permissions).toHaveLength(3);
      expect(user.role.permissions).toContain("dashboard.view");
      expect(user.role.permissions).toContain("ticket.view");
      expect(user.role.permissions).toContain("ticket.process");

      expect(user.role.permissions).not.toContain("ticket.view_all");
      expect(user.role.permissions).not.toContain("ticket.assign");
      expect(user.role.permissions).not.toContain("user.create");
    });

    it("hasPermission helper works correctly", async () => {
      const admin = await prisma.user.findUnique({ where: { username: "admin" } });
      expectPresent(admin);
      const adminToken = await sessionService.createSession(admin.id);
      const adminUser = await sessionService.validateSession(adminToken);
      expectPresent(adminUser);

      const cs = await prisma.user.findUnique({ where: { username: "cs1" } });
      expectPresent(cs);
      const csToken = await sessionService.createSession(cs.id);
      const csUser = await sessionService.validateSession(csToken);
      expectPresent(csUser);

      expect(hasPermission(adminUser, "ticket.assign")).toBe(true);

      expect(hasPermission(csUser, "ticket.assign")).toBe(false);

      expect(hasPermission(adminUser, "ticket.view")).toBe(true);
      expect(hasPermission(csUser, "ticket.view")).toBe(true);
    });
  });

  describe("Data Scope Helper", () => {
    it("ticket data scope: admin sees all tickets", async () => {
      const admin = await prisma.user.findUnique({ where: { username: "admin" } });
      expectPresent(admin);
      const adminToken = await sessionService.createSession(admin.id);
      const adminUser = await sessionService.validateSession(adminToken);
      expectPresent(adminUser);

      const scope = applyTicketDataScope(adminUser);

      expect(scope).toEqual({});
    });

    it("ticket data scope: frontline CS sees assigned-to-me OR created-by-me tickets", async () => {
      const cs = await prisma.user.findUnique({ where: { username: "cs1" } });
      expectPresent(cs);
      const csToken = await sessionService.createSession(cs.id);
      const csUser = await sessionService.validateSession(csToken);
      expectPresent(csUser);

      const scope = applyTicketDataScope(csUser);

      expect(scope).toEqual({ OR: [{ assigneeId: csUser.id }, { creatorId: csUser.id }] });
    });

    it("ticket data scope: unauthenticated user sees nothing", async () => {
      const scope = applyTicketDataScope(null);

      expect(scope).toHaveProperty("id");
      expect(scope.id).toHaveProperty("equals", "__impossible__");
    });

    it("dashboard data scope: admin sees all data", async () => {
      const admin = await prisma.user.findUnique({ where: { username: "admin" } });
      expectPresent(admin);
      const adminToken = await sessionService.createSession(admin.id);
      const adminUser = await sessionService.validateSession(adminToken);
      expectPresent(adminUser);

      const scope = applyDashboardDataScope(adminUser);

      expect(scope).toEqual({});
    });

    it("dashboard data scope: frontline CS only sees own data", async () => {
      const cs = await prisma.user.findUnique({ where: { username: "cs1" } });
      expectPresent(cs);
      const csToken = await sessionService.createSession(cs.id);
      const csUser = await sessionService.validateSession(csToken);
      expectPresent(csUser);

      const scope = applyDashboardDataScope(csUser);

      expect(scope).toEqual({ assigneeId: csUser.id });
    });
  });
});
